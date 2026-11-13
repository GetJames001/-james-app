'use strict';
const {randomUUID}=require('node:crypto');
const {digest}=require('./ledger.cjs');
const {createDocumentStore,plain,id,integer,fail}=require('./dispatch-store.cjs');
const auditId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const states=new Set(['queued','sending','unknown','delivered','failed','cancelled']);
const message=r=>({id:r.id,taskId:r.taskId,inputVersion:r.inputVersion,summary:r.summary});
function createNotificationOutbox({read,compareAndSwap,now=Date.now,maxAttempts=3,retryDelayMs=1000,leaseMs=3000,timeoutMs=1000}){
 if(!integer(maxAttempts,1,10)||!integer(retryDelayMs,1,3600000)||!integer(leaseMs,500,30000)||!integer(timeoutMs,1,30000))fail('INVALID_NOTIFICATION_OPTIONS');
 const clock=()=>{const at=now();if(!integer(at))fail('INVALID_CLOCK');return at;};
 const recordKeys='attempts|digest|fence|id|inputVersion|lease|receiptDigest|retryAt|state|summary|taskId|updatedAt';
 const store=createDocumentStore({read,compareAndSwap,kind:'notifications',initial:()=>({records:[],audit:[],suppressed:[]}),validate:d=>Object.keys(d).sort().join('|')==='audit|records|revision|schemaVersion|suppressed'&&Array.isArray(d.suppressed)&&d.suppressed.length<=50&&d.suppressed.every(id)&&new Set(d.suppressed).size===d.suppressed.length&&new Set(d.records.map(r=>r.id)).size===d.records.length&&d.records.every(r=>plain(r)&&Object.keys(r).sort().join('|')===recordKeys&&id(r.id)&&id(r.taskId)&&integer(r.inputVersion,1)&&typeof r.summary==='string'&&r.summary.length>0&&r.summary.length<=1000&&r.digest===digest(message(r))&&states.has(r.state)&&integer(r.attempts,0,10)&&integer(r.retryAt)&&integer(r.fence)&&integer(r.updatedAt)&&((r.state==='delivered')?typeof r.receiptDigest==='string'&&/^[a-f0-9]{64}$/.test(r.receiptDigest)&&r.attempts>0&&r.fence>0:r.receiptDigest===null)&&(!['sending','unknown','failed'].includes(r.state)||r.attempts>0&&r.fence>0)&&((r.state==='sending')===(r.lease!==null))&&(r.lease===null||plain(r.lease)&&Object.keys(r.lease).sort().join('|')==='expiresAt|fence|token'&&id(r.lease.token)&&r.lease.fence===r.fence&&integer(r.lease.expiresAt))&&(!d.suppressed.includes(r.taskId)||['cancelled','delivered','unknown','failed'].includes(r.state)))&&new Set(d.audit.map(a=>a.eventId)).size===d.audit.length&&d.audit.every(a=>plain(a)&&Object.keys(a).sort().join('|')==='at|eventId|id|state'&&auditId(a.eventId)&&id(a.id)&&states.has(a.state)&&integer(a.at))});
 async function enqueue(owner,input){
  if(!plain(input)||Object.keys(input).sort().join('|')!=='id|inputVersion|summary|taskId'||!id(input.id)||!id(input.taskId)||!integer(input.inputVersion,1)||typeof input.summary!=='string'||!input.summary.trim()||input.summary.length>1000)fail('INVALID_NOTIFICATION');
  const at=clock(),hash=digest(input);return store.mutate(owner,d=>{if(d.suppressed.includes(input.taskId))return {status:'suppressed'};const prior=d.records.find(r=>r.id===input.id);if(prior){if(prior.digest!==hash)fail('NOTIFICATION_ID_REUSED');return {status:prior.state,replayed:true};}
   d.records.push({...structuredClone(input),digest:hash,state:'queued',attempts:0,retryAt:at,fence:0,lease:null,receiptDigest:null,updatedAt:at});d.audit.push({eventId:randomUUID(),id:input.id,state:'queued',at});return {status:'queued',replayed:false};
  });
 }
 async function suppressTask(owner,taskId){if(!id(taskId))fail('INVALID_NOTIFICATION');const at=clock();return store.mutate(owner,d=>{if(!d.suppressed.includes(taskId))d.suppressed.push(taskId);for(const r of d.records.filter(r=>r.taskId===taskId)){if(['cancelled','delivered','failed'].includes(r.state))continue;r.state=['sending','unknown'].includes(r.state)?'unknown':'cancelled';r.lease=null;r.fence++;r.updatedAt=at;d.audit.push({eventId:randomUUID(),id:r.id,state:'cancelled',at});}return {status:'suppressed'};});}
 async function claim(owner,notificationId){const at=clock();return store.mutate(owner,d=>{const r=d.records.find(r=>r.id===notificationId);if(!r||d.suppressed.includes(r.taskId)||!['queued','unknown','sending'].includes(r.state)||r.retryAt>at||r.lease?.expiresAt>at||r.attempts>=maxAttempts)return null;
  const reconcile=r.state!=='queued';r.state='sending';r.attempts++;r.fence++;r.lease={token:randomUUID(),fence:r.fence,expiresAt:at+leaseMs};r.updatedAt=at;return {record:r,reconcile};
 });}
 async function finish(owner,claim,state,receiptId){const at=clock();return store.mutate(owner,d=>{const r=d.records.find(r=>r.id===claim.id);if(!r||r.state!=='sending'||r.fence!==claim.fence||r.lease?.token!==claim.lease.token||r.lease.expiresAt<=at||d.suppressed.includes(r.taskId))return {status:'superseded'};
  r.state=state;r.lease=null;r.retryAt=at+retryDelayMs;r.updatedAt=at;r.receiptDigest=state==='delivered'&&receiptId?digest(receiptId):null;if(state==='queued'&&r.attempts>=maxAttempts)r.state='failed';d.audit.push({eventId:randomUUID(),id:r.id,state:r.state,at});return {status:r.state,id:r.id};
 });}
 async function deliver(owner,ports,max=2){
  if(!ports||typeof ports.send!=='function'||typeof ports.reconcile!=='function'||!integer(max,1,10))fail('NOTIFIER_REQUIRED');
  await store.mutate(owner,d=>{const at=clock();for(const r of d.records){if(r.state==='sending'&&r.lease.expiresAt<=at){r.state='unknown';r.lease=null;r.updatedAt=at;d.audit.push({eventId:randomUUID(),id:r.id,state:'unknown',at});}}return null;});
  const records=(await store.snapshot(owner)).records.filter(r=>['queued','sending','unknown'].includes(r.state)&&r.retryAt<=clock()&&(!r.lease||r.lease.expiresAt<=clock())&&r.attempts<maxAttempts).slice(0,max);
  return Promise.all(records.map(async item=>{const claimed=await claim(owner,item.id);if(!claimed)return {status:'not_claimed'};const r=claimed.record,controller=new AbortController();let timer;
   try{
    const invoke=()=>claimed.reconcile?ports.reconcile(r.id,{signal:controller.signal}):ports.send(message(r),{signal:controller.signal});
    const result=await Promise.race([Promise.resolve().then(invoke),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('TIMEOUT'));},timeoutMs);})]);
    if(!plain(result)||Object.keys(result).some(k=>!['status','receiptId'].includes(k))||!['delivered','not_delivered','unknown'].includes(result.status)||(result.receiptId!==undefined&&(typeof result.receiptId!=='string'||!result.receiptId.trim()||result.receiptId.length>200))||(result.status==='delivered'&&typeof result.receiptId!=='string'))return finish(owner,r,'unknown');
    return finish(owner,r,result.status==='delivered'?'delivered':result.status==='not_delivered'?'queued':'unknown',result.receiptId);
   }catch{return finish(owner,r,'unknown');}finally{clearTimeout(timer);}
  }));
 }
 return {enqueue,suppressTask,snapshot:store.snapshot,deliver};
}
module.exports={createNotificationOutbox};
