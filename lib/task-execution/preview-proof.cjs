'use strict';
// Server-only composition seam. No route, schedule, notification sender or flag
// is installed by importing this module. Call only from a reviewed transport.
const {randomUUID}=require('node:crypto');
const {createLedger,digest}=require('./ledger.cjs');
const {createStorage}=require('./storage.cjs');
const {createDispatchStorage}=require('./dispatch-rest-storage.cjs');
const {createTriggers}=require('./triggers.cjs');
const {createNotificationOutbox}=require('./notification-outbox.cjs');
const {createWorker}=require('./worker.cjs');
const {createDispatcher}=require('./dispatcher.cjs');
const BRANCH='work/hosted-preparation-proof-20261113';
const fail=code=>{throw Object.assign(Error(code),{code});};
function createPreviewProof({env=process.env,owner,fetchImpl=fetch,now=Date.now}){
 // Owner comes from trusted server configuration, never a trigger or client.
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==BRANCH||env.JAMES_HOSTED_PROOF_ENABLED!=='true')fail('PROOF_DISABLED');
 if(typeof owner!=='string'||!owner.trim()||owner.length>320)fail('OWNER_REQUIRED');
 const proofId=env.JAMES_HOSTED_PROOF_ID;
 const start=Number(env.JAMES_HOSTED_PROOF_START_AT),end=Number(env.JAMES_HOSTED_PROOF_END_AT);
 if(!/^[a-zA-Z0-9_-]{1,60}$/.test(proofId||'')||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<=0||end<=start||end-start>30*60*1000)fail('INVALID_PROOF_WINDOW');
 // A fresh, server-derived pilot scope cannot admit existing account tasks.
 owner='hosted-proof:'+digest({owner,proofId});
 const checkWindow=()=>{const at=now();if(!Number.isSafeInteger(at)||at<start||at>=end)fail('PROOF_WINDOW_CLOSED');};
 const rest={url:env.KV_REST_API_URL,token:env.KV_REST_API_TOKEN,fetchImpl};
 const ledger=createLedger({...createStorage(rest),now});
 const triggers=createTriggers({...createDispatchStorage({...rest,kind:'dispatch'}),now});
 const outbox=createNotificationOutbox({...createDispatchStorage({...rest,kind:'notifications'}),now});
 const budget={maxAttempts:4,maxSteps:5,maxDurationMs:60000,maxCostMicros:0};
 const registration=(suffix,kind,input)=>({id:proofId+'-'+suffix,version:1,at:start,timeZone:'America/Los_Angeles',enabled:true,command:{kind,objective:kind==='agenda_fixture'?'Fictional proof agenda':'Fictional proof follow-up',input,budget,requiresApproval:false}});
 const registrations=[registration('agenda','agenda_fixture',{events:[{title:'Fictional planning call',time:'09:00'}]}),registration('followup','followup_fixture',{})];
 const adapter=async({task,checkpoint})=>{
  if(task.kind==='followup_fixture'&&task.input.customer!=='Alex Example')fail('MISSING_INPUT');
  await checkpoint({step:'fictional-preparation'});
  return {outcome:'prepared',artifact:task.kind==='agenda_fixture'?{title:'Fictional agenda',text:'09:00 — Fictional planning call'}:{title:'Fictional follow-up',text:'Draft for Alex Example. No message sent.'}};
 };
 const worker=createWorker({ledger,workerId:'preview-proof-'+randomUUID(),leaseMs:30000,adapters:{agenda_fixture:adapter,followup_fixture:adapter}});
 const dispatcher=createDispatcher({ledger,triggers,outbox,worker,now,maxPerTick:2,maxTickMs:15000,leaseMs:30000});
 async function register(){checkWindow();for(const r of registrations)await triggers.register(owner,r);}
 async function tick(){checkWindow();await register();return dispatcher.tick(owner);}
 async function resumeFollowup(){
  checkWindow();const occurrence=(await triggers.snapshot(owner)).records.find(r=>r.id===proofId+'-followup');
  if(!occurrence||occurrence.revoked)fail('NOT_RESUMABLE');
  const task=(await ledger.snapshot(owner)).tasks.find(t=>t.id===occurrence.taskId);
  if(!task||task.status!=='blocked')fail('NOT_RESUMABLE');
  return ledger.execute(owner,{type:'resume',taskId:task.id,operationId:proofId+'-resume-followup',expectedRevision:task.revision,input:{customer:'Alex Example'}});
 }
 // Stop remains available after the execution window expires. Evidence stays.
 async function stop(){
  const records=(await triggers.snapshot(owner)).records;
  const results=[];
  for(const r of registrations)if(records.some(item=>item.id===r.id))results.push(await dispatcher.cancel(owner,r.id));
  return results;
 }
 async function status(){return {tasks:(await ledger.snapshot(owner)).tasks,occurrences:(await triggers.snapshot(owner)).records,notifications:(await outbox.snapshot(owner)).records};}
 return {register,tick,resumeFollowup,stop,status};
}
module.exports={createPreviewProof,BRANCH};
