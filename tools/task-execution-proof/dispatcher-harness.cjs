'use strict';
// Synthetic cross-process proof only. No browser, live credentials or provider.
const {openStore}=require('./store.cjs');
const {createLedger,scopedKey}=require('../../lib/task-execution/ledger.cjs');
const {createWorker}=require('../../lib/task-execution/worker.cjs');
const {createTriggers}=require('../../lib/task-execution/triggers.cjs');
const {createDispatcher}=require('../../lib/task-execution/dispatcher.cjs');
const {createNotificationOutbox}=require('../../lib/task-execution/notification-outbox.cjs');
async function main(){
 const [filename,owner,mode,startAt]=process.argv.slice(2),store=openStore(filename);
 const ledger=createLedger(store),triggers=createTriggers(store),outbox=createNotificationOutbox(store);
 const adapter=async({task,checkpoint,reserve})=>{
  if(task.kind==='followup_fixture'&&!task.input.customer)throw Object.assign(Error('MISSING_INPUT'),{code:'MISSING_INPUT'});
  await reserve(0);if(!task.checkpoint)await checkpoint({step:'input_checked'});
  const key=scopedKey(owner)+':dispatcher-artifact:'+task.id+':'+task.inputVersion,prior=store.findArtifact(key);
  if(prior&&prior.digest!==task.planDigest)throw Error('ARTIFACT_ID_REUSED');
  const artifact=prior?.value||store.artifact(key,task.planDigest,{title:'Fictional scheduled preparation',text:'Read-only fixture result'});
  if(prior)process.send?.({event:'artifact_reconciled'});
  if(mode==='hold_after_artifact'){process.send?.({event:'artifact_written'});await new Promise(resolve=>process.once('message',resolve));}
  return {outcome:'prepared',artifactKey:key,artifact};
 };
 try{
  const worker=createWorker({ledger,workerId:'dispatcher-proof-worker',leaseMs:3000,adapters:{agenda_fixture:adapter,followup_fixture:adapter}});
  const dispatcher=createDispatcher({ledger,triggers,worker,outbox,leaseMs:3000,maxTickMs:5000,maxPerTick:2,retryDelayMs:1000});
  while(Date.now()<Number(startAt))await new Promise(resolve=>setTimeout(resolve,Math.max(1,Number(startAt)-Date.now())));
  process.send?.({event:'due_tick',at:Date.now()});
  await dispatcher.tick(owner);process.send?.({event:'finished'});
 }finally{store.close();}
}
main().then(()=>process.disconnect?.()).catch(()=>{process.send?.({event:'failed'});process.exitCode=1;process.disconnect?.();});
