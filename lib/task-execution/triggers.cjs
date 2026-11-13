'use strict';
const {randomUUID}=require('node:crypto');
const {createLedger,digest}=require('./ledger.cjs');
const {createDocumentStore,plain,id,integer,fail}=require('./dispatch-store.cjs');
const auditId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const states=new Set(['scheduled','disabled','claimed','retry','blocked','completed','cancelled','failed']);
const keys=['id','version','at','timeZone','enabled','command'];
function createTriggers({read,compareAndSwap,now=Date.now}){
 const clock=()=>{const at=now();if(!integer(at))fail('INVALID_CLOCK');return at;};
 const recordKeys=['id','version','occurrenceId','registrationDigest','initialEnabled','commandDigest','at','timeZone','enabled','revoked','state','command','taskId','operationId','attempts','retryAt','fence','lease','notificationId','cancellationPending','updatedAt'].sort().join('|');
 const validRecord=r=>{
  if(!plain(r)||Object.keys(r).sort().join('|')!==recordKeys||!id(r.id)||!integer(r.version,1)||r.occurrenceId!==r.id+':'+r.version||!integer(r.at)||typeof r.timeZone!=='string'||typeof r.initialEnabled!=='boolean'||typeof r.enabled!=='boolean'||typeof r.revoked!=='boolean'||typeof r.cancellationPending!=='boolean'||!states.has(r.state)||!plain(r.command)||!id(r.taskId)||!id(r.operationId)||!integer(r.attempts,0,10)||!integer(r.retryAt)||!integer(r.fence)||!integer(r.updatedAt)||(r.notificationId!==null&&!id(r.notificationId)))return false;
  const c=r.command,hash=digest({id:r.id,version:r.version});
  if(Object.keys(c).sort().join('|')!=='budget|expectedRevision|input|kind|objective|operationId|requiresApproval|taskId|type'||c.type!=='create'||c.expectedRevision!==0||c.taskId!==r.taskId||c.operationId!==r.operationId||r.taskId!=='scheduled-'+hash||r.operationId!=='trigger-'+hash||!['agenda_fixture','followup_fixture'].includes(c.kind)||c.requiresApproval!==false||!plain(c.input)||typeof c.objective!=='string'||!c.objective.trim()||c.objective.length>2000||!plain(c.budget)||Object.keys(c.budget).sort().join('|')!=='maxAttempts|maxCostMicros|maxDurationMs|maxSteps'||!integer(c.budget.maxAttempts,1,10)||!integer(c.budget.maxSteps,1,100)||!integer(c.budget.maxDurationMs,1000,3600000)||c.budget.maxCostMicros!==0||Buffer.byteLength(JSON.stringify(c))>16384)return false;
  if(r.commandDigest!==digest(c)||r.registrationDigest!==digest({id:r.id,version:r.version,at:r.at,timeZone:r.timeZone,enabled:r.initialEnabled,command:{kind:c.kind,objective:c.objective,input:c.input,budget:c.budget,requiresApproval:c.requiresApproval}}))return false;
  try{new Intl.DateTimeFormat('en-US',{timeZone:r.timeZone});}catch{return false;}
  if((r.state==='claimed')!==(r.lease!==null))return false;
  if(r.lease!==null&&(!plain(r.lease)||Object.keys(r.lease).sort().join('|')!=='expiresAt|fence|token'||!id(r.lease.token)||r.lease.fence!==r.fence||!integer(r.lease.expiresAt)))return false;
  if(r.revoked&&(r.enabled||r.state!=='cancelled'))return false;
  return true;
 };
 const store=createDocumentStore({read,compareAndSwap,kind:'dispatch',validate:d=>Object.keys(d).sort().join('|')==='audit|records|revision|schemaVersion'&&new Set(d.records.map(r=>r.occurrenceId)).size===d.records.length&&d.records.every(validRecord)&&new Set(d.audit.map(a=>a.eventId)).size===d.audit.length&&d.audit.every(a=>plain(a)&&Object.keys(a).sort().join('|')==='at|eventId|id|type|version'&&auditId(a.eventId)&&id(a.id)&&integer(a.version,1)&&integer(a.at)&&['registered','revoked','retry','blocked','completed','failed','resumed'].includes(a.type))});
 async function register(owner,registration){
  if(!plain(registration)||Object.keys(registration).sort().join('|')!==keys.sort().join('|')||!id(registration.id)||!integer(registration.version,1)||!integer(registration.at)||typeof registration.timeZone!=='string'||typeof registration.enabled!=='boolean'||!plain(registration.command))fail('INVALID_REGISTRATION');
  try{new Intl.DateTimeFormat('en-US',{timeZone:registration.timeZone}).format(0);}catch{fail('INVALID_TIMEZONE');}
  const c=registration.command;
  if(Object.keys(c).sort().join('|')!=='budget|input|kind|objective|requiresApproval'||!['agenda_fixture','followup_fixture'].includes(c.kind)||c.requiresApproval!==false||c.budget?.maxCostMicros!==0)fail('PREPARATION_ONLY');
  const hash=digest({id:registration.id,version:registration.version}),command={type:'create',taskId:'scheduled-'+hash,operationId:'trigger-'+hash,expectedRevision:0,...structuredClone(c)};
  await createLedger({read:async()=>null,compareAndSwap:async()=>true,now:clock}).execute(owner,command);
  const registrationDigest=digest(registration),at=clock();
  return store.mutate(owner,d=>{
   const previous=d.records.filter(r=>r.id===registration.id);
   const same=previous.find(r=>r.version===registration.version);
   if(same){if(same.registrationDigest!==registrationDigest)fail('REGISTRATION_REUSED');return {replayed:true,occurrence:same};}
   if(previous.some(r=>r.revoked))fail('REGISTRATION_REVOKED');
   if(previous.some(r=>r.version>=registration.version))fail('STALE_VERSION');
   if(previous.some(r=>r.attempts>0))fail('VERSION_CHANGE_REQUIRES_NEW_ID');
   for(const old of previous){old.enabled=false;old.state='cancelled';old.lease=null;old.fence++;old.updatedAt=at;}
   const occurrence={id:registration.id,version:registration.version,occurrenceId:registration.id+':'+registration.version,registrationDigest,initialEnabled:registration.enabled,commandDigest:digest(command),at:registration.at,timeZone:registration.timeZone,enabled:registration.enabled,revoked:false,state:registration.enabled?'scheduled':'disabled',command,taskId:command.taskId,operationId:command.operationId,attempts:0,retryAt:registration.at,fence:0,lease:null,notificationId:null,cancellationPending:false,updatedAt:at};
   d.records.push(occurrence);d.audit.push({eventId:randomUUID(),type:'registered',id:registration.id,version:registration.version,at});return {replayed:false,occurrence};
  });
 }
 async function revoke(owner,registrationId){if(!id(registrationId))fail('INVALID_REGISTRATION');const at=clock();return store.mutate(owner,d=>{const records=d.records.filter(r=>r.id===registrationId);if(!records.length)fail('NOT_FOUND');for(const r of records){if(r.revoked)continue;r.cancellationPending=true;r.enabled=false;r.revoked=true;r.state='cancelled';r.lease=null;r.fence++;r.updatedAt=at;d.audit.push({eventId:randomUUID(),type:'revoked',id:r.id,version:r.version,at});}return records;});}
 async function claim(owner,occurrenceId,{leaseMs,maxAttempts,reconcileOnly=false}){
  if(typeof occurrenceId!=='string'||!integer(leaseMs,500,30000)||!integer(maxAttempts,1,10)||typeof reconcileOnly!=='boolean')fail('INVALID_DISPATCH_OPTIONS');const at=clock();
  return store.mutate(owner,d=>{const r=d.records.find(r=>r.occurrenceId===occurrenceId);if(!r||!r.enabled||r.revoked||r.at>at||r.retryAt>at||!['scheduled','retry','claimed',...(reconcileOnly?['failed']:[])].includes(r.state)||r.lease?.expiresAt>at)return null;
   if(r.attempts>=maxAttempts&&!reconcileOnly){r.state='failed';r.lease=null;r.updatedAt=at;return null;}
   if(!reconcileOnly)r.attempts++;r.fence++;r.state='claimed';r.lease={token:randomUUID(),fence:r.fence,expiresAt:at+leaseMs};r.updatedAt=at;return r;
  });
 }
 async function current(owner,claim){const r=(await store.snapshot(owner)).records.find(r=>r.occurrenceId===claim.occurrenceId);return !!r&&r.state==='claimed'&&r.enabled&&!r.revoked&&r.lease?.token===claim.lease.token&&r.fence===claim.fence&&r.lease.expiresAt>clock();}
 async function finish(owner,claim,state,{retryAt=0,permanent=false}={}){
  if(!['retry','blocked','completed','failed'].includes(state)||!integer(retryAt)||typeof permanent!=='boolean'||permanent&&state!=='failed')fail('INVALID_DISPATCH_STATE');const at=clock();
  return store.mutate(owner,d=>{const r=d.records.find(r=>r.occurrenceId===claim.occurrenceId);if(!r||r.state!=='claimed'||r.revoked||r.lease?.token!==claim.lease.token||r.fence!==claim.fence||r.lease.expiresAt<=at)return {status:'superseded'};
   r.state=state;if(permanent)r.enabled=false;r.lease=null;r.retryAt=retryAt;r.updatedAt=at;d.audit.push({eventId:randomUUID(),type:state,id:r.id,version:r.version,at});return {status:state,occurrence:r};
  });
 }
 async function requeue(owner,occurrenceId){const at=clock();return store.mutate(owner,d=>{const r=d.records.find(r=>r.occurrenceId===occurrenceId);if(!r||r.state!=='blocked'||r.revoked||!r.enabled)return false;r.state='retry';r.retryAt=at;r.updatedAt=at;d.audit.push({eventId:randomUUID(),type:'resumed',id:r.id,version:r.version,at});return true;});}
 async function settleCancellation(owner,occurrenceId){return store.mutate(owner,d=>{const r=d.records.find(r=>r.occurrenceId===occurrenceId);if(!r||!r.revoked)return false;r.cancellationPending=false;return true;});}
 return {register,revoke,snapshot:store.snapshot,claim,current,finish,requeue,settleCancellation};
}
module.exports={createTriggers};
