// Only the host calls start/end. Model tools must never instantiate or select
// account identity. This adapter trusts the same-origin authenticated route.
const valid=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(v);
function decode(value,status){
 if(!value||Object.keys(value).sort().join('|')!=='accountId|conversationId|generation|status'||value.status!==status||!valid(value.accountId)||!valid(value.conversationId)||!Number.isSafeInteger(value.generation)||value.generation<1)throw Error('Conversation identity unconfirmed');
 return Object.freeze({accountId:value.accountId,conversationId:value.conversationId,generation:value.generation});
}
const same=(a,b)=>a&&b&&a.accountId===b.accountId&&a.conversationId===b.conversationId&&a.generation===b.generation;
export function createConversationIdentityOwner({fetch:fetcher,newOperationId}){
 if(typeof fetcher!=='function'||typeof newOperationId!=='function')throw Error('Host dependencies required');
 let epoch=0,current=null,pendingEnd=null,closureScope=null;
 async function request(body){
  const r=await fetcher('/api/james/conversation',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  if(!r.ok){const error=Error('Conversation identity unconfirmed');error.invalidateClosure=r.status>=400&&r.status<500;throw error;}
  return r.json();
 }
 async function resolve(create){
  const ticket=++epoch;
  try{
   const value=await request(create?{action:'ensure'}:null);
   let next;try{next=decode(value,'ready')}catch(error){error.invalidateClosure=true;throw error;}
   if(ticket!==epoch)throw Error('Conversation request superseded');
   // Do not reopen an unchanged ACTIVE head while its End is uncertain.
   if(pendingEnd && same(next,pendingEnd.scope))throw Error('Server End unconfirmed');
   pendingEnd=null;current=next;closureScope=next;return next;
  }catch(error){
   if(ticket===epoch){current=null;if(error.invalidateClosure){closureScope=null;pendingEnd=null;}}
   throw Error('Conversation identity unconfirmed');
  }
 }
 // Retained identity authorizes closure only, never presentation or new work.
 function canEnd(scope){return !!same(scope,pendingEnd?.scope||closureScope);}
 function end(expectedScope){
  if(expectedScope!==undefined&&!canEnd(expectedScope))return Promise.resolve({status:'superseded'});
  // End reconciliation has its own identity, independent of the cleared
  // local current scope. Duplicate End joins the existing operation.
  if(pendingEnd)return pendingEnd.inflight||Promise.resolve(pendingEnd.result);
  const prior=closureScope;epoch++;current=null;
  if(!prior)return Promise.resolve({status:'closed'}); // local absence only
  let operationId;try{operationId=newOperationId()}catch{}
  const operation={scope:prior,inflight:null,result:null};pendingEnd=operation;
  if(!valid(operationId)){
   operation.result={status:'unconfirmed',scope:prior};return Promise.resolve(operation.result);
  }
  const command=Object.freeze({action:'end',conversationId:prior.conversationId,generation:prior.generation,operationId});
  function attempt(){
   if(pendingEnd!==operation)return Promise.resolve({status:'superseded'});
   if(operation.inflight)return operation.inflight;
   if(operation.result?.status==='ended')return Promise.resolve(operation.result);
   operation.inflight=(async()=>{
    let result;
    try{
     const ended=decode(await request(command),'ended');
     if(pendingEnd!==operation)return {status:'superseded'};
     if(!same(ended,prior))throw Error('Different conversation');
     result={status:'ended',scope:prior};
    }catch{
     if(pendingEnd!==operation)return {status:'superseded'};
     result={status:'unconfirmed',scope:prior,retry:attempt};
    }
    operation.result=result;return result;
   })().finally(()=>{operation.inflight=null});
   return operation.inflight;
  }
  return attempt();
 }
 return {start:()=>resolve(true),snapshotIdentity:()=>resolve(false),canEnd,end,revoke(){epoch++;current=null;pendingEnd=null;closureScope=null},current:()=>current?{...current}:null};
}
