'use strict';
// Fictional preparation only: no fetch(), model, mailbox or external action.
const {createLedger,scopedKey}=require('../../lib/task-execution/ledger.cjs');
const {createWorker}=require('../../lib/task-execution/worker.cjs');
const {openStore}=require('./store.cjs');
async function main(){
 const [filename,owner,taskId,workerId,mode]=process.argv.slice(2),store=openStore(filename);
 const ledger=createLedger(store);
 const adapter=async({task,checkpoint,reserve})=>{
  if(task.kind==='followup_fixture'&&!task.input.customer)throw Object.assign(Error('MISSING_INPUT'),{code:'MISSING_INPUT'});
  await reserve(0);
  if(!task.checkpoint)await checkpoint({step:'input_checked',planDigest:task.planDigest});
  const artifactKey=scopedKey(owner)+':'+task.id+':'+task.inputVersion;
  const value=task.kind==='agenda_fixture'?{title:'Fictional agenda',items:task.input.events}:{title:'Fictional follow-up draft',text:'Hello '+task.input.customer+', here is the fictional follow-up.'};
  // Reconcile an artifact committed by the worker that died before its reply.
  const prior=store.findArtifact(artifactKey);
  if(prior&&prior.digest!==task.planDigest)throw Error('ARTIFACT_ID_REUSED');
  if(prior)process.send?.({event:'artifact_reconciled',taskId});
  const artifact=prior?.value||store.artifact(artifactKey,task.planDigest,value);
  if(mode==='hold_after_artifact'){
   process.send?.({event:'artifact_written',taskId});
   await new Promise(resolve=>process.once('message',resolve));
  }
  return {outcome:'prepared',artifactKey,planDigest:task.planDigest,artifact};
 };
 try{
  const worker=createWorker({ledger,workerId,adapters:{agenda_fixture:adapter,followup_fixture:adapter},leaseMs:3000});
  const result=await worker.run(owner,taskId);process.send?.({event:'finished',status:result.status,taskId});
 }finally{store.close();}
}
main().then(()=>process.disconnect?.()).catch(()=>{process.send?.({event:'failed',reason:'PROOF_WORKER_FAILED'});process.exitCode=1;process.disconnect?.();});
