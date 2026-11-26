'use strict';
const {createHash,randomBytes}=require('node:crypto');
const {validateCandidate}=require('./mail-trip.cjs');
const CAS=`
 local old=redis.call('GET',KEYS[1])
 if (old or '')~=ARGV[1] then return 0 end
 redis.call('SET',KEYS[1],ARGV[2])
 return 1
`;
const hash=value=>createHash('sha256').update(value).digest('hex');
const fault=code=>Object.assign(Error(code),{code});
function payloadFor(stage,value){
 if(stage==='fetch'){
  if(!value||!['gmail','microsoft'].includes(value.provider)||typeof value.messageId!=='string'||!value.messageId||value.messageId.length>2048||!/^[A-Za-z0-9_:+/=-]+$/.test(value.messageId))throw fault('INVALID_TRAVEL_JOB');
  if(Object.keys(value).some(key=>!['provider','messageId'].includes(key)))throw fault('INVALID_TRAVEL_JOB');
  return {provider:value.provider,messageId:value.messageId};
 }
 validateCandidate(value);
 if(Object.keys(value).some(key=>!['id','at','values'].includes(key)))throw fault('INVALID_TRAVEL_JOB');
 return {id:value.id,at:value.at,values:Object.fromEntries(Object.entries(value.values).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,Array.isArray(v)?[...v]:v]))};
}
function createQueue({command,environment,now=Date.now,maxEntries=100,maxAttempts=5,leaseMs=120000,maxBytes=256*1024}={}){
 if(typeof command!=='function'||!['preview','production'].includes(environment)||!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>1000||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>20||!Number.isSafeInteger(leaseMs)||leaseMs<1000||leaseMs>600000||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>1024*1024)throw fault('INVALID_TRAVEL_QUEUE');
 function keyFor(owner,stage){
  if(typeof owner!=='string'||!owner.trim()||owner.length>500||!['fetch','upsert'].includes(stage))throw fault('INVALID_TRAVEL_QUEUE_SCOPE');
  return 'james:travel-pending:v1:'+environment+':'+hash(owner)+':'+stage;
 }
 function time(){const n=now();if(!Number.isSafeInteger(n)||n<0)throw fault('INVALID_TRAVEL_QUEUE_TIME');return n;}
 function decode(raw){
  if(raw===null)return {version:1,jobs:[]};
  if(typeof raw!=='string'||Buffer.byteLength(raw)>maxBytes)throw fault('CORRUPT_TRAVEL_QUEUE');
  let state;try{state=JSON.parse(raw);}catch{throw fault('CORRUPT_TRAVEL_QUEUE');}
  if(state?.version!==1||!Array.isArray(state.jobs)||state.jobs.length>maxEntries)throw fault('CORRUPT_TRAVEL_QUEUE');
  for(const j of state.jobs)if(!j||!/^[a-f0-9]{64}$/.test(j.id)||!['pending','running','blocked','done'].includes(j.status)||!Number.isSafeInteger(j.attempts)||j.attempts<0||!Number.isSafeInteger(j.nextAt)||j.nextAt<0||!Number.isSafeInteger(j.updatedAt)||j.updatedAt<0)throw fault('CORRUPT_TRAVEL_QUEUE');
  if(new Set(state.jobs.map(j=>j.id)).size!==state.jobs.length)throw fault('CORRUPT_TRAVEL_QUEUE');
  for(const j of state.jobs){
   if(j.status==='running'&&(!Number.isSafeInteger(j.leaseUntil)||j.leaseUntil<0||!/^([a-f0-9]{32})$/.test(j.token)))throw fault('CORRUPT_TRAVEL_QUEUE');
   if(j.status!=='done'&&(!j.payload||typeof j.payload!=='object'))throw fault('CORRUPT_TRAVEL_QUEUE');
   if(j.status==='done'&&j.payload!==undefined)throw fault('CORRUPT_TRAVEL_QUEUE');
  }
  return state;
 }
 async function mutate(owner,stage,change){
  const key=keyFor(owner,stage);
  for(let attempt=0;attempt<8;attempt++){
   const raw=await command(['GET',key]),state=decode(raw),result=change(state,time());
   if(result?.noChange)return result.value;
   const next=JSON.stringify(state);if(Buffer.byteLength(next)>maxBytes)throw fault('TRAVEL_QUEUE_CAPACITY');
   const committed=await command(['EVAL',CAS,1,key,raw||'',next]);
   if(committed===1)return result?.value;
   if(committed!==0)throw fault('TRAVEL_QUEUE_COMMIT_UNKNOWN');
  }
  throw fault('TRAVEL_QUEUE_CHANGED_RETRY');
 }
 async function enqueue(owner,stage,items){
  keyFor(owner,stage);
  if(!Array.isArray(items)||items.length>maxEntries)throw fault('TRAVEL_QUEUE_CAPACITY');
  const jobs=items.map(item=>{const payload=payloadFor(stage,item);return {id:hash(JSON.stringify([stage,payload])),payload};});
  return mutate(owner,stage,(state,at)=>{
   const ids=new Set(state.jobs.map(j=>j.id)),added=[];
   for(const j of jobs)if(!ids.has(j.id)){ids.add(j.id);added.push({...j,status:'pending',attempts:0,nextAt:at,updatedAt:at});}
   if(!added.length)return {noChange:true,value:{enqueued:0,ids:jobs.map(j=>j.id)}};
   // Only completed tombstones may be evicted. Pending/blocked work never expires.
   let excess=state.jobs.length+added.length-maxEntries;
   if(excess>0){const removable=state.jobs.filter(j=>j.status==='done').sort((a,b)=>a.updatedAt-b.updatedAt).slice(0,excess);if(removable.length<excess)throw fault('TRAVEL_QUEUE_CAPACITY');const drop=new Set(removable.map(j=>j.id));state.jobs=state.jobs.filter(j=>!drop.has(j.id));}
   state.jobs.push(...added);return {value:{enqueued:added.length,ids:jobs.map(j=>j.id)}};
  });
 }
 async function claim(owner,stage){
  const token=randomBytes(16).toString('hex');
  return mutate(owner,stage,(state,at)=>{
   let changed=false;
   for(const job of state.jobs)if(job.status==='running'&&job.leaseUntil<=at){job.status=job.attempts>=maxAttempts?'blocked':'pending';job.nextAt=at;job.updatedAt=at;delete job.leaseUntil;delete job.token;job.lastFailure='LEASE_EXPIRED';changed=true;}
   const job=state.jobs.find(j=>j.status==='pending'&&j.nextAt<=at);
   if(!job)return changed?{value:null}:{noChange:true,value:null};
   if(job.attempts>=maxAttempts){job.status='blocked';job.updatedAt=at;return {value:null};}
   payloadFor(stage,job.payload);
   job.status='running';job.attempts++;job.updatedAt=at;job.leaseUntil=at+leaseMs;job.token=token;
   return {value:{id:job.id,token,payload:job.payload}};
  });
 }
 async function finish(owner,stage,claimed,success){
  return mutate(owner,stage,(state,at)=>{
   const job=state.jobs.find(j=>j.id===claimed.id);
   if(!job||job.status!=='running'||job.token!==claimed.token)return {noChange:true,value:false};
   if(success){job.status='done';delete job.payload;delete job.lastFailure;job.nextAt=0;}
   else{job.status=job.attempts>=maxAttempts?'blocked':'pending';job.nextAt=at+Math.min(3600000,1000*2**(job.attempts-1));job.lastFailure='PROCESSING_FAILED';}
   job.updatedAt=at;delete job.token;delete job.leaseUntil;return {value:true};
  });
 }
 async function drain(owner,stage,run,{limit=10}={}){
  if(typeof run!=='function'||!Number.isInteger(limit)||limit<1||limit>100)throw fault('INVALID_TRAVEL_QUEUE_RUN');
  const counts={completed:0,failed:0};
  for(let n=0;n<limit;n++){
   const job=await claim(owner,stage);if(!job)break;
   let succeeded=false;try{await run(job.payload);succeeded=true;}catch{}
   // If ack storage fails, leave the durable lease for retry. The consumer MUST
   // be idempotent because a successful upsert followed by failed ack repeats.
   if(!await finish(owner,stage,job,succeeded))throw fault('TRAVEL_QUEUE_LEASE_LOST');
   counts[succeeded?'completed':'failed']++;
  }
  return counts;
 }
 async function retry(owner,stage,id){
  if(!/^[a-f0-9]{64}$/.test(id))throw fault('INVALID_TRAVEL_JOB');
  return mutate(owner,stage,(state,at)=>{const job=state.jobs.find(j=>j.id===id&&j.status==='blocked');if(!job)return {noChange:true,value:false};job.status='pending';job.attempts=0;job.nextAt=at;job.updatedAt=at;delete job.lastFailure;return {value:true};});
 }
 async function status(owner,stage){const state=decode(await command(['GET',keyFor(owner,stage)]));const counts={pending:0,running:0,blocked:0,done:0};for(const job of state.jobs)counts[job.status]++;return counts;}
 return {enqueue,drain,retry,status};
}
module.exports={createQueue,CAS};
