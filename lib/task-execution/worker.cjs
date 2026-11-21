'use strict';
const {randomUUID}=require('node:crypto');
function createWorker({ledger,workerId,adapters,leaseMs=1500}){
 if(!ledger||typeof workerId!=='string'||!adapters)throw Error('WORKER_DEPENDENCIES_REQUIRED');
 return {
  async run(owner,taskId){
   const found=(await ledger.snapshot(owner)).tasks.find(t=>t.id===taskId);
   if(!found)return {status:'not_found'};
   if(!['queued','running'].includes(found.status))return {status:'not_runnable'};
   const adapter=Object.hasOwn(adapters,found.kind)?adapters[found.kind]:null;
   if(typeof adapter!=='function')return {status:'unsupported_kind'};
   let task;
   try{({task}=await ledger.execute(owner,{type:'claim',operationId:randomUUID(),taskId,expectedRevision:found.revision,workerId,leaseMs}));}
   catch(error){if(['REVISION_CONFLICT','LEASE_BUSY','CONCURRENCY_LIMIT','BUDGET_EXHAUSTED','APPROVAL_REQUIRED'].includes(error.code))return {status:'not_claimed',reason:error.code};throw error;}
   const update=async(type,payload)=>{
    const result=await ledger.execute(owner,{type,operationId:randomUUID(),taskId,expectedRevision:task.revision,workerId,fence:task.fence,...payload});task=result.task;return task;
   };
   try{
    const result=await adapter({task:structuredClone(task),checkpoint:async checkpoint=>update('checkpoint',{checkpoint}),reserve:async costMicros=>update('reserve',{costMicros})});
    await update('complete',{result});return {status:'completed',task};
   }catch(error){
    if(['STALE_LEASE','REVISION_CONFLICT'].includes(error.code))return {status:'superseded'};
    if(error.code==='BUDGET_EXHAUSTED'||error.code==='APPROVAL_REQUIRED')return {status:'not_completed',reason:error.code};
    try{await update('block',{reason:error.code==='MISSING_INPUT'?'missing_input':'source_unavailable'});}
    catch(conflict){if(['STALE_LEASE','REVISION_CONFLICT'].includes(conflict.code))return {status:'superseded'};throw conflict;}
    return {status:'blocked',task};
   }
  }
 };
}
module.exports={createWorker};
