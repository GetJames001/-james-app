'use strict';
// Metadata validation is NOT authentication. This service is reachable by the
// scheduler only through the private schedule/v1beta function, never a public
// gateway route. Deployment-level private invocation must also be verified.
const {randomUUID}=require('node:crypto');
const {digest}=require('./ledger.cjs');
const {createPreviewProof,SCHEDULE_BRANCH}=require('./preview-proof.cjs');
const {CAS}=require('../customer-activity/storage.cjs');
const {boundedJson}=require('../attention/storage-response.cjs');
const PROJECT='prj_SeUz2jQJ2KqxZFMALQsKloLicijw';
const NAME='james-fictional-proof',EXPRESSION='*/15 * * * *',INTERVAL=900000;
const MAX_REQUESTS=180,DEADLINE_MS=10000,LEASE_MS=20000;
const fail=code=>{throw Object.assign(Error(code),{code});};
const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const keys=(o,want)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===want;

function configuration(env,owner){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==SCHEDULE_BRANCH||env.VERCEL_PROJECT_ID!==PROJECT||env.JAMES_HOSTED_PROOF_ENABLED!=='true'||env.JAMES_HOSTED_SCHEDULE_ENABLED!=='true'||!/^([a-f0-9]{40})$/.test(env.JAMES_HOSTED_PROOF_APPROVED_HEAD||'')||env.JAMES_HOSTED_PROOF_APPROVED_HEAD!==env.VERCEL_GIT_COMMIT_SHA)fail('PROOF_DISABLED');
 if(typeof owner!=='string'||!owner.trim()||owner.length>320)fail('OWNER_UNAVAILABLE');
 const proofId=env.JAMES_HOSTED_PROOF_ID,scheduleId=env.JAMES_HOSTED_PROOF_SCHEDULE_ID;
 const start=Number(env.JAMES_HOSTED_PROOF_START_AT),end=Number(env.JAMES_HOSTED_PROOF_END_AT);
 const first=Math.ceil(start/INTERVAL)*INTERVAL;
 if(!/^[a-zA-Z0-9_-]{1,60}$/.test(proofId||'')||!safeId(scheduleId)||!integer(start)||start===0||!integer(end)||end<=start||end-start>1800000||first+INTERVAL+60000>=end)fail('INVALID_PROOF_CONFIGURATION');
 const scope=digest({owner,proofId});
 return {proofId,start,end,first,scheduleId,key:'james:task-proof-control:v1:'+scope,binding:digest({scope,start,end,first,scheduleId,head:env.VERCEL_GIT_COMMIT_SHA})};
}

function boundedTransport(fetchImpl){
 const controller=new AbortController();let requests=0;
 const timer=setTimeout(()=>controller.abort(),DEADLINE_MS);timer.unref?.();
 return {
  async fetch(url,options){
   if(controller.signal.aborted||requests>=MAX_REQUESTS)fail('PROOF_TRANSPORT_LIMIT');
   requests++;
   return fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.any([controller.signal,...(options.signal?[options.signal]:[])])});
  },
  close(){clearTimeout(timer);controller.abort();},
  count:()=>requests
 };
}

function createControl({config,env,fetchImpl,now}){
 const initial=()=>({schemaVersion:1,revision:0,binding:config.binding,armed:false,stopped:false,slots:[]});
 function decode(raw){
  if(raw===null)return initial();
  try{
   if(typeof raw!=='string'||Buffer.byteLength(raw)>32768)throw Error();
   const d=JSON.parse(raw);
   if(!keys(d,'armed|binding|revision|schemaVersion|slots|stopped')||d.schemaVersion!==1||d.binding!==config.binding||!integer(d.revision)||typeof d.armed!=='boolean'||typeof d.stopped!=='boolean'||d.stopped&&d.armed||!Array.isArray(d.slots)||d.slots.length>2||new Set(d.slots.map(s=>s.at)).size!==d.slots.length)throw Error();
   for(const s of d.slots)if(!keys(s,'at|attempts|executionDigest|expiresAt|outcome|token')||![config.first,config.first+INTERVAL].includes(s.at)||!Number.isInteger(s.attempts)||s.attempts<1||s.attempts>2||!hash(s.executionDigest)||!integer(s.expiresAt)||!safeId(s.token)||!['running','checked','interrupted'].includes(s.outcome))throw Error();
   return d;
  }catch{fail('PROOF_CONTROL_UNAVAILABLE');}
 }
 async function command(parts){
  if(typeof env.KV_REST_API_URL!=='string'||!env.KV_REST_API_URL.startsWith('https://')||typeof env.KV_REST_API_TOKEN!=='string'||!env.KV_REST_API_TOKEN)fail('PROOF_CONTROL_UNAVAILABLE');
  try{
   const response=await fetchImpl(env.KV_REST_API_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),headers:{Authorization:'Bearer '+env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(parts)});
   if(!response.ok)throw Error();const body=await boundedJson(response);
   if(!body||typeof body!=='object'||Array.isArray(body)||body.error||!Object.hasOwn(body,'result'))throw Error();return body.result;
  }catch{fail('PROOF_CONTROL_UNAVAILABLE');}
 }
 const snapshot=async()=>decode(await command(['GET',config.key]));
 async function mutate(fn){
  for(let retry=0;retry<5;retry++){
   const raw=await command(['GET',config.key]),d=decode(raw),before=JSON.stringify(d),result=fn(d);
   if(JSON.stringify(d)===before)return result;
   if(d.revision===Number.MAX_SAFE_INTEGER)fail('PROOF_CONTROL_UNAVAILABLE');d.revision++;
   const next=JSON.stringify(d);decode(next);
   const written=await command(['EVAL',CAS,1,config.key,raw===null?'absent':'present',raw||'',next]);
   if(written===1)return result;if(written!==0)fail('PROOF_CONTROL_UNAVAILABLE');
  }fail('PROOF_CONTROL_UNAVAILABLE');
 }
 return {snapshot,mutate,async claim(at,executionDigest){
  return mutate(d=>{
   if(d.stopped||!d.armed)return {status:'not_armed'};
   if(d.slots.some(s=>s.executionDigest===executionDigest&&s.at!==at))return {status:'duplicate_or_busy'};
   let slot=d.slots.find(s=>s.at===at);
   if(slot&&(slot.executionDigest!==executionDigest||slot.outcome==='checked'||slot.expiresAt>now()||slot.attempts>=2))return {status:'duplicate_or_busy'};
   if(!slot){slot={at,executionDigest,attempts:0,expiresAt:0,token:'pending',outcome:'running'};d.slots.push(slot);}
   slot.attempts++;slot.token=randomUUID();slot.expiresAt=now()+LEASE_MS;slot.outcome='running';
   return {status:'admitted',at,token:slot.token};
  });
 },async finish(claim,outcome){return mutate(d=>{
  const s=d.slots.find(s=>s.at===claim.at);
  if(!s||s.token!==claim.token||d.stopped||s.expiresAt<=now())return false;
  s.outcome=outcome;s.expiresAt=0;return true;
 });}};
}

const publicControl=d=>({armed:d.armed,stopped:d.stopped,runs:d.slots.map(({at,attempts,executionDigest,outcome})=>({scheduledAt:at,attempts,executionDigest,outcome}))});
function createScheduleProof({env=process.env,owner,fetchImpl=fetch,now=Date.now}){
 const config=configuration(env,owner);
 const inWindow=()=>{const at=now();if(!integer(at)||at<config.start||at>=config.end)fail('PROOF_WINDOW_CLOSED');};
 function metadataSlot(metadata){
  const at=metadata?.scheduledAt instanceof Date?metadata.scheduledAt.getTime():NaN;
  if(metadata?.name!==NAME||metadata.namespace!=='default'||metadata.source!=='static'||metadata.expression!==EXPRESSION||metadata.scheduleId!==config.scheduleId||!safeId(metadata.executionId)||![config.first,config.first+INTERVAL].includes(at)||now()<at||now()-at>120000)fail('INVALID_SCHEDULE_EVENT');
  inWindow();return at;
 }
 async function operation(fn,{working=false}={}){
  const transport=boundedTransport(fetchImpl),control=createControl({config,env,fetchImpl:transport.fetch,now});
  // The deadline bounds every storage request and streamed response. It does not
  // claim to terminate arbitrary adapters; this proof has only fictional adapters.
  const proof=createPreviewProof({env,owner,fetchImpl:(url,options)=>{if(working)inWindow();return transport.fetch(url,options);},now});
  try{return await fn({control,proof,transport});}finally{transport.close();}
 }
 return {
  async arm(){inWindow();return operation(async({control,proof})=>{
   if((await control.snapshot()).stopped)fail('PROOF_STOPPED');
   await proof.register();await control.mutate(d=>{if(d.stopped)fail('PROOF_STOPPED');d.armed=true;});
   return {status:'armed'};
  },{working:true});},
  async stop(){return operation(async({control,proof})=>{
   // Persist the stop before attempting cancellation. A storage outage during
   // cancellation cannot re-arm the worker; retry stop to finish reconciliation.
   await control.mutate(d=>{d.stopped=true;d.armed=false;});
   const results=await proof.stop();
   return {status:results.some(r=>r.status==='reconcile_required')?'reconcile_required':'stopped',schedulerDisabled:false};
  });},
  async resume(){inWindow();return operation(async({control,proof})=>{
   const d=await control.snapshot();if(d.stopped||!d.armed)fail('PROOF_STOPPED');
   await proof.resumeFollowup();return {status:'resumed'};
  },{working:true});},
  async status(){return operation(async({control,proof})=>{
   const d=await control.snapshot(),s=await proof.status();
   return {...publicControl(d),window:{start:config.start,end:config.end},tasks:s.tasks.map(t=>({id:t.id,kind:t.kind,status:t.status,outcome:t.result?.outcome||null,updatedAt:t.updatedAt,blockedReason:t.blockedReason})),notifications:s.notifications.map(n=>({id:n.id,state:n.state,hasReceipt:!!n.receiptDigest})),schedulerDisabled:false};
  });},
  async run(metadata){const at=metadataSlot(metadata);return operation(async({control,proof,transport})=>{
   const claim=await control.claim(at,digest(metadata.executionId));if(claim.status!=='admitted')return claim;
   try{
    inWindow();await proof.tick();
    const recorded=await control.finish(claim,'checked');
    return {status:recorded?'checked':'superseded',requests:transport.count()};
   }catch{
    try{await control.finish(claim,'interrupted');}catch{}
    fail('PROOF_RUN_UNAVAILABLE');
   }
  },{working:true});}
 };
}
module.exports={createScheduleProof,configuration,NAME,EXPRESSION,PROJECT,MAX_REQUESTS,DEADLINE_MS,createControl,boundedTransport};
