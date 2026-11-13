'use strict';
const {digest}=require('./ledger.cjs');
const {integer,fail}=require('./dispatch-store.cjs');
function createDispatcher({triggers,ledger,worker,outbox,now=Date.now,maxPerTick=2,maxTickMs=1000,maxAttempts=4,retryDelayMs=1000,leaseMs=3000}){
 if(!triggers||!ledger||!worker||typeof worker.run!=='function'||!outbox||!integer(maxPerTick,1,10)||!integer(maxTickMs,1,30000)||!integer(maxAttempts,1,10)||!integer(retryDelayMs,1,3600000)||!integer(leaseMs,500,30000))fail('INVALID_DISPATCH_OPTIONS');
 const clock=()=>{const at=now();if(!integer(at))fail('INVALID_CLOCK');return at;};
 const expectedPlan=c=>digest({kind:c.kind,inputVersion:1,input:c.input});
 async function notify(owner,occurrence,task){
  const latest=(await triggers.snapshot(owner)).records.find(r=>r.occurrenceId===occurrence.occurrenceId);
  if(!latest||!latest.enabled||latest.revoked||latest.state!=='completed'||task.status!=='completed')return {status:'suppressed'};
  return outbox.enqueue(owner,{id:'ready-'+digest({taskId:task.id,inputVersion:task.inputVersion}),taskId:task.id,inputVersion:task.inputVersion,summary:'Preparation ready: '+task.objective.slice(0,900)});
 }
 async function reconcileCancellation(owner,occurrence){
  const latest=(await triggers.snapshot(owner)).records.find(r=>r.occurrenceId===occurrence.occurrenceId);
  if(!latest?.revoked)return {status:'superseded'};
  if(!latest.cancellationPending)return {status:'cancelled',taskId:latest.taskId,taskStatus:'previously_verified',notificationStatus:'suppressed'};
  // Fence task execution independently of the notification store. A notification
  // outage must never leave a late-created task runnable or block other tasks.
  let task,taskVerified=false,taskStatus='unverified',notificationStatus='unavailable';
  try{
   task=(await ledger.snapshot(owner)).tasks.find(t=>t.id===latest.taskId);
   if(task&&!['completed','cancelled','failed'].includes(task.status))task=(await ledger.execute(owner,{type:'cancel',operationId:'cancel-'+digest({id:latest.occurrenceId,revision:task.revision}),taskId:task.id,expectedRevision:task.revision})).task;
   taskStatus=task?.status||'not_started';taskVerified=!!task||latest.attempts===0;
  }catch{taskStatus='unverified';}
  try{await outbox.suppressTask(owner,latest.taskId);notificationStatus='suppressed';}catch{}
  if(taskVerified&&notificationStatus==='suppressed'){await triggers.settleCancellation(owner,latest.occurrenceId);return {status:'cancelled',taskId:latest.taskId,taskStatus,notificationStatus};}
  return {status:'reconcile_required',taskId:latest.taskId,taskStatus,notificationStatus};
 }

 async function run(owner,occurrence){
  const existing=(await ledger.snapshot(owner)).tasks.find(t=>t.id===occurrence.taskId);
  const reconcileOnly=!!existing&&!['queued','running'].includes(existing.status);
  const claimed=await triggers.claim(owner,occurrence.occurrenceId,{leaseMs,maxAttempts,reconcileOnly});if(!claimed)return {status:'not_claimed'};
  const retry=()=>triggers.finish(owner,claimed,'retry',{retryAt:clock()+retryDelayMs});let timer;
  const controller=new AbortController();
  try{
   if(!await triggers.current(owner,claimed))return reconcileCancellation(owner,claimed);
   const receipt=await ledger.execute(owner,claimed.command);
   if(receipt.task.id!==claimed.taskId||receipt.task.planDigest!==expectedPlan(claimed.command)||receipt.task.inputVersion!==1)fail('TASK_PLAN_MISMATCH');
   if(!await triggers.current(owner,claimed))return reconcileCancellation(owner,claimed);
   let task=(await ledger.snapshot(owner)).tasks.find(t=>t.id===claimed.taskId);if(!task)fail('TASK_NOT_FOUND');
   if(task.inputVersion===1&&task.planDigest!==expectedPlan(claimed.command))fail('TASK_PLAN_MISMATCH');
   if(['queued','running'].includes(task.status)){
    // This is an admission/wait deadline, not a claim that JavaScript can kill
    // arbitrary adapters. The injected transport must honor signal/deadline.
    await Promise.race([Promise.resolve().then(()=>worker.run(owner,task.id,{signal:controller.signal,deadline:clock()+maxTickMs})),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('DISPATCH_TIMEOUT'));},maxTickMs);})]);
    if(!await triggers.current(owner,claimed))return reconcileCancellation(owner,claimed);
    task=(await ledger.snapshot(owner)).tasks.find(t=>t.id===claimed.taskId);if(!task)fail('TASK_NOT_FOUND');
   }
   if(task.status==='completed'){
    const finished=await triggers.finish(owner,claimed,'completed');if(finished.status==='completed')await notify(owner,finished.occurrence,task);return finished;
   }
   if(['blocked','paused','waiting_for_approval'].includes(task.status))return triggers.finish(owner,claimed,'blocked');
   if(['cancelled','failed'].includes(task.status))return triggers.finish(owner,claimed,'failed',{permanent:true});
   return retry();
  }catch(error){
   if(error.code==='TASK_PLAN_MISMATCH'||error.code==='OPERATION_REUSED'||error.code==='TASK_EXISTS')return triggers.finish(owner,claimed,'failed',{permanent:true});
   // Unknown storage/transport outcomes retain the deterministic create receipt;
   // next attempt reconciles before dispatch rather than creating another task.
   return retry();
  }finally{clearTimeout(timer);}
 }
 async function tick(owner){
  const started=clock(),notifications=[],cancellations=[];let occurrences=(await triggers.snapshot(owner)).records;
  for(const occurrence of occurrences.filter(r=>r.revoked&&r.cancellationPending)){try{cancellations.push(await reconcileCancellation(owner,occurrence));}catch{cancellations.push({status:'reconcile_required',taskId:occurrence.taskId,taskStatus:'unverified',notificationStatus:'unverified'});}}
  const tasks=(await ledger.snapshot(owner)).tasks;
  for(const occurrence of occurrences.filter(r=>r.enabled&&!r.revoked)){
   const task=tasks.find(t=>t.id===occurrence.taskId);
   if(occurrence.state==='completed'&&task?.status==='completed'){try{notifications.push(await notify(owner,occurrence,task));}catch{notifications.push({status:'unavailable'});}}
   if(occurrence.state==='blocked'&&task&&['queued','running','completed','cancelled','failed'].includes(task.status))await triggers.requeue(owner,occurrence.occurrenceId);
  }
  occurrences=(await triggers.snapshot(owner)).records;
  const candidates=occurrences.filter(r=>r.enabled&&!r.revoked&&r.at<=clock()&&r.retryAt<=clock()&&(['scheduled','retry','claimed'].includes(r.state)||r.state==='failed'&&tasks.some(t=>t.id===r.taskId&&['completed','blocked','paused','waiting_for_approval'].includes(t.status)))&&(!r.lease||r.lease.expiresAt<=clock())).sort((a,b)=>a.at-b.at||a.occurrenceId.localeCompare(b.occurrenceId)).slice(0,maxPerTick);
  const results=await Promise.allSettled(candidates.map(occurrence=>clock()-started<maxTickMs?run(owner,occurrence):Promise.resolve({status:'deferred'})));
  return {status:'checked',notifications,cancellations,results:results.map(result=>result.status==='fulfilled'?result.value:{status:'unavailable'})};
 }
 async function cancel(owner,id){
  const occurrences=await triggers.revoke(owner,id),tasks=[];let pending=false;
  for(const occurrence of occurrences){const result=await reconcileCancellation(owner,occurrence);if(result.status==='reconcile_required')pending=true;tasks.push({taskId:occurrence.taskId,status:result.taskStatus||'unverified'});}
  return {status:pending?'reconcile_required':'cancelled',tasks};
 }

 return {tick,cancel};
}
module.exports={createDispatcher};
