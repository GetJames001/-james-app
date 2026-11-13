'use strict';
// Domain core only. The caller supplies an authenticated owner and an atomic
// store. No routes, credentials, provider calls or background service live here.
const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&Object.getPrototypeOf(value)===Object.prototype;
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
function fail(code){throw Object.assign(new Error(code),{code});}
function canonical(value,depth=0){
 if(depth>20)fail('INVALID_INPUT');
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value)&&value.length<=1000)return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 if(plain(value)&&Object.keys(value).length<=128&&Object.keys(value).every(k=>!['__proto__','constructor','prototype'].includes(k)))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
 fail('INVALID_INPUT');
}
function data(value){const raw=canonical(value);if(Buffer.byteLength(raw)>16384)fail('INPUT_TOO_LARGE');return JSON.parse(raw);}
const digest=value=>hash(canonical(value));
function scopedKey(owner){if(typeof owner!=='string'||!owner.trim()||owner.length>320)fail('OWNER_REQUIRED');return 'james:task-execution:v1:'+hash(owner);}
const states=new Set(['queued','running','blocked','paused','waiting_for_approval','cancelled','completed','failed']);
const commands={
 create:['kind','objective','input','budget','requiresApproval'],
 claim:['workerId','leaseMs'],checkpoint:['workerId','fence','checkpoint'],
 complete:['workerId','fence','result'],block:['workerId','fence','reason'],
 reserve:['workerId','fence','costMicros'],resume:['input'],pause:[],cancel:[],
 approve:['planDigest','expiresAt']
};
const workerCommands=new Set(['checkpoint','complete','block','reserve']);
function validateCommand(command){
 if(!plain(command)||!Object.hasOwn(commands,command.type)||!id(command.operationId)||!id(command.taskId)||!integer(command.expectedRevision,0,Number.MAX_SAFE_INTEGER))fail('INVALID_COMMAND');
 const allowed=['type','operationId','taskId','expectedRevision',...commands[command.type]];
 if(Object.keys(command).some(k=>!allowed.includes(k)))fail('INVALID_COMMAND');
 if(command.type==='create'){
  if(command.expectedRevision!==0||!id(command.kind)||typeof command.objective!=='string'||!command.objective.trim()||command.objective.length>2000||!plain(command.input)||!plain(command.budget)||typeof command.requiresApproval!=='boolean')fail('INVALID_COMMAND');
  const b=command.budget;
  if(Object.keys(b).sort().join('|')!=='maxAttempts|maxCostMicros|maxDurationMs|maxSteps'||!integer(b.maxAttempts,1,10)||!integer(b.maxSteps,1,100)||!integer(b.maxCostMicros,0,100000000)||!integer(b.maxDurationMs,1000,3600000))fail('INVALID_BUDGET');
  data(command.input);
 }
 if(command.type==='claim'&&(!id(command.workerId)||!integer(command.leaseMs,500,30000)))fail('INVALID_COMMAND');
 if(workerCommands.has(command.type)&&(!id(command.workerId)||!integer(command.fence,1,Number.MAX_SAFE_INTEGER)))fail('INVALID_COMMAND');
 if(command.type==='checkpoint'&&(!plain(command.checkpoint)||!id(command.checkpoint.step)))fail('INVALID_COMMAND');
 if(command.type==='complete'&&(!plain(command.result)||command.result.outcome!=='prepared'))fail('PREPARATION_ONLY');
 if(command.type==='block'&&!['missing_input','source_unavailable','approval_required'].includes(command.reason))fail('INVALID_COMMAND');
 if(command.type==='reserve'&&!integer(command.costMicros,0,100000000))fail('INVALID_BUDGET');
 if(command.type==='resume'&&!plain(command.input))fail('INVALID_INPUT');
 if(command.type==='approve'&&(typeof command.planDigest!=='string'||!/^[a-f0-9]{64}$/.test(command.planDigest)||!Number.isSafeInteger(command.expiresAt)))fail('INVALID_COMMAND');
 data(command);
}
function validTask(t){
 if(!plain(t)||!id(t.id)||!id(t.kind)||typeof t.objective!=='string'||!t.objective.trim()||t.objective.length>2000||!states.has(t.status)||!integer(t.revision,1,Number.MAX_SAFE_INTEGER)||!integer(t.inputVersion,1,Number.MAX_SAFE_INTEGER)||!integer(t.fence,0,Number.MAX_SAFE_INTEGER)||!plain(t.input)||!Array.isArray(t.checkpoints)||t.checkpoints.length>100||typeof t.requiresApproval!=='boolean'||!integer(t.createdAt,0,Number.MAX_SAFE_INTEGER)||!integer(t.updatedAt,0,Number.MAX_SAFE_INTEGER))return false;
 const b=t.budget;
 if(!plain(b)||!integer(b.maxAttempts,1,10)||!integer(b.maxSteps,1,100)||!integer(b.maxCostMicros,0,100000000)||!integer(b.maxDurationMs,1000,3600000)||!integer(b.attempts,0,b.maxAttempts)||!integer(b.steps,0,b.maxSteps)||!integer(b.usedMs,0,Number.MAX_SAFE_INTEGER)||!integer(b.reservedCostMicros,0,b.maxCostMicros))return false;
 if(t.planDigest!==plan(t)||t.checkpoints.some(c=>!plain(c)||!id(c.step)||!integer(c.inputVersion,1,t.inputVersion)))return false;
 if(t.approval!==null&&(!plain(t.approval)||t.approval.planDigest!==t.planDigest||!Number.isSafeInteger(t.approval.expiresAt)))return false;
 if(t.lease!==null&&(!plain(t.lease)||!id(t.lease.workerId)||t.lease.fence!==t.fence||!integer(t.lease.leaseMs,500,30000)||!Number.isSafeInteger(t.lease.startedAt)||!Number.isSafeInteger(t.lease.expiresAt)||t.lease.expiresAt-t.lease.startedAt!==t.lease.leaseMs))return false;
 if((t.status==='running')!==(t.lease!==null)||t.result!==null&&(!plain(t.result)||t.result.outcome!=='prepared'))return false;
 return true;
}
function decode(raw){
 if(raw===null)return {schemaVersion:1,revision:0,tasks:[],receipts:[],audit:[]};
 try{
  if(typeof raw!=='string'||Buffer.byteLength(raw)>2*1024*1024)throw Error();
  const d=JSON.parse(raw);
  if(!plain(d)||d.schemaVersion!==1||!integer(d.revision,0,Number.MAX_SAFE_INTEGER)||!Array.isArray(d.tasks)||d.tasks.length>50||!Array.isArray(d.receipts)||d.receipts.length>500||!Array.isArray(d.audit)||d.audit.length>1000)throw Error();
  if(d.tasks.some(t=>!validTask(t)))throw Error();
  if(new Set(d.tasks.map(t=>t.id)).size!==d.tasks.length||d.receipts.some(r=>!id(r.operationId)||typeof r.digest!=='string'||!/^[a-f0-9]{64}$/.test(r.digest)||!plain(r.result)||!validTask(r.result.task))||new Set(d.receipts.map(r=>r.operationId)).size!==d.receipts.length)throw Error();
  if(d.audit.some(e=>!plain(e)||!id(e.operationId)||!id(e.taskId)||!Object.hasOwn(commands,e.type)||!states.has(e.status)||!Number.isSafeInteger(e.at)))throw Error();
  return d;
 }catch{fail('CORRUPT_LEDGER');}
}
function plan(task){return digest({kind:task.kind,inputVersion:task.inputVersion,input:task.input});}
function activeTime(task,now){return task.lease?Math.max(0,Math.min(now,task.lease.expiresAt)-task.lease.startedAt):0;}
function release(task,now){task.budget.usedMs+=activeTime(task,now);task.lease=null;}
function checkLease(task,command,now){
 if(task.status!=='running'||!task.lease||task.lease.workerId!==command.workerId||task.lease.fence!==command.fence||task.fence!==command.fence||task.lease.expiresAt<=now)fail('STALE_LEASE');
 if(task.budget.usedMs+activeTime(task,now)>=task.budget.maxDurationMs)fail('BUDGET_EXHAUSTED');
 if(task.requiresApproval&&(!task.approval||task.approval.planDigest!==task.planDigest||task.approval.expiresAt<=now))fail('APPROVAL_REQUIRED');
}
function transition(task,command,now){
 const next=structuredClone(task);
 if(next.revision===Number.MAX_SAFE_INTEGER||next.fence===Number.MAX_SAFE_INTEGER||next.inputVersion===Number.MAX_SAFE_INTEGER)fail('COUNTER_EXHAUSTED');
 if(workerCommands.has(command.type))checkLease(next,command,now);
 if(['cancel','pause','resume','approve'].includes(command.type)&&['cancelled','completed','failed'].includes(next.status))fail('TERMINAL_TASK');
 switch(command.type){
  case 'claim':{
   if(!['queued','running'].includes(next.status))fail('NOT_RUNNABLE');
   if(next.lease&&next.lease.expiresAt>now)fail('LEASE_BUSY');
   if(next.requiresApproval&&(!next.approval||next.approval.planDigest!==next.planDigest||next.approval.expiresAt<=now))fail('APPROVAL_REQUIRED');
   release(next,now);
   if(next.budget.attempts>=next.budget.maxAttempts||next.budget.usedMs>=next.budget.maxDurationMs)fail('BUDGET_EXHAUSTED');
   next.budget.attempts++;next.fence++;
   next.lease={workerId:command.workerId,fence:next.fence,startedAt:now,expiresAt:now+command.leaseMs,leaseMs:command.leaseMs};next.status='running';break;
  }
  case 'checkpoint':
   if(next.budget.steps>=next.budget.maxSteps)fail('BUDGET_EXHAUSTED');
   next.budget.steps++;next.checkpoints.push({...data(command.checkpoint),inputVersion:next.inputVersion});
   next.checkpoint=data(command.checkpoint);
   next.budget.usedMs+=activeTime(next,now);next.lease.startedAt=now;next.lease.expiresAt=now+next.lease.leaseMs;break;
  case 'reserve':
   if(next.budget.reservedCostMicros+command.costMicros>next.budget.maxCostMicros)fail('BUDGET_EXHAUSTED');
   next.budget.reservedCostMicros+=command.costMicros;break;
  case 'block':release(next,now);next.status='blocked';next.blockedReason=command.reason;break;
  case 'complete':
   if(next.budget.steps>=next.budget.maxSteps)fail('BUDGET_EXHAUSTED');
   next.budget.steps++;release(next,now);next.status='completed';next.result=data(command.result);break;
  case 'pause':release(next,now);next.fence++;next.status='paused';break;
  case 'cancel':release(next,now);next.fence++;next.status='cancelled';break;
  case 'resume':
   if(!['blocked','paused','waiting_for_approval'].includes(next.status))fail('NOT_RESUMABLE');
   next.input=data(command.input);next.inputVersion++;next.planDigest=plan(next);next.approval=null;next.checkpoint=null;next.result=null;next.blockedReason=null;
   next.status=next.requiresApproval?'waiting_for_approval':'queued';break;
  case 'approve':
   if(!next.requiresApproval||command.planDigest!==next.planDigest||command.expiresAt<=now||command.expiresAt>now+86400000)fail('INVALID_APPROVAL');
   if(!['waiting_for_approval','queued','blocked'].includes(next.status))fail('NOT_APPROVABLE');
   next.approval={planDigest:command.planDigest,expiresAt:command.expiresAt};next.status='queued';next.blockedReason=null;break;
 }
 next.revision++;next.updatedAt=now;return next;
}
function createLedger({read,compareAndSwap,now=Date.now,maxConcurrent=2}){
 if(typeof read!=='function'||typeof compareAndSwap!=='function'||!integer(maxConcurrent,1,10))fail('STORE_REQUIRED');
 async function snapshot(owner){return structuredClone(decode(await read(scopedKey(owner))));}
 async function execute(owner,command){
  const key=scopedKey(owner);validateCommand(command);const operationDigest=digest(command);
  for(let attempt=0;attempt<8;attempt++){
   const raw=await read(key),d=decode(raw),prior=d.receipts.find(r=>r.operationId===command.operationId);
   if(prior){if(prior.digest!==operationDigest)fail('OPERATION_REUSED');return {replayed:true,...structuredClone(prior.result)};}
   if(d.receipts.length>=500||d.audit.length>=1000)fail('CAPACITY_REACHED');
   if(d.revision===Number.MAX_SAFE_INTEGER)fail('COUNTER_EXHAUSTED');
   const at=now();if(!Number.isSafeInteger(at))fail('INVALID_CLOCK');
   let task=d.tasks.find(t=>t.id===command.taskId);
   if(command.type==='create'){
    if(task)fail('TASK_EXISTS');if(d.tasks.length>=50)fail('CAPACITY_REACHED');
    task={id:command.taskId,kind:command.kind,objective:command.objective,input:data(command.input),inputVersion:1,revision:1,status:command.requiresApproval?'waiting_for_approval':'queued',requiresApproval:command.requiresApproval,approval:null,lease:null,fence:0,checkpoint:null,checkpoints:[],result:null,blockedReason:null,createdAt:at,updatedAt:at,budget:{...data(command.budget),usedMs:0,attempts:0,steps:0,reservedCostMicros:0}};
    task.planDigest=plan(task);d.tasks.push(task);
   }else{
    if(!task)fail('NOT_FOUND');if(task.revision!==command.expectedRevision)fail('REVISION_CONFLICT');
    if(command.type==='claim'&&d.tasks.filter(t=>t.id!==task.id&&t.status==='running'&&t.lease?.expiresAt>at).length>=maxConcurrent)fail('CONCURRENCY_LIMIT');
    const next=transition(task,command,at);d.tasks[d.tasks.indexOf(task)]=next;task=next;
   }
   d.revision++;const result={task:structuredClone(task)};
   d.receipts.push({operationId:command.operationId,digest:operationDigest,result});
   d.audit.push({operationId:command.operationId,taskId:task.id,type:command.type,status:task.status,at});
   const nextRaw=JSON.stringify(d);if(Buffer.byteLength(nextRaw)>2*1024*1024)fail('CAPACITY_REACHED');
   if(await compareAndSwap(key,raw,nextRaw))return {replayed:false,...result};
  }
  fail('BUSY_RECONCILE');
 }
 return {snapshot,execute};
}
module.exports={createLedger,scopedKey,digest};
