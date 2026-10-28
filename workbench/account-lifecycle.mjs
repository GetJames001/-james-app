import {createRemoteWorkbenchStore} from './remote-store.mjs';

// Called only by the host authentication owner, never by conversation tools.
// Recovery is memory-only and private to this instance. No cross-account replay.
export function createWorkbenchAccountLifecycle({fetch: fetcher, mount, root, conversationId, stopVoice, onFocus=()=>{}}) {
 if(typeof fetcher!=='function'||typeof mount!=='function'||!root||!conversationId||typeof stopVoice!=='function')throw Error('Host dependencies required');
 let epoch=0,active=null;
 const recoveries=new Map();
 function revoke() {
  epoch++;
  const prior=active;active=null;root.hidden=true;
  if(!prior)return {status:'closed'};
  // Invalidate transport before invoking callback-capable screen teardown.
  const pending=prior.store.revoke();
  let screenResult;
  try{screenResult=prior.screen?.revoke()}catch{screenResult={status:'failed'}}
  const retained={accountId:prior.accountId,screen:screenResult?.recovery??null,pending};
  if(retained.screen||pending){const entries=recoveries.get(prior.accountId)||[];entries.push(retained);recoveries.set(prior.accountId,entries)}
  let voiceStopped=screenResult?.voiceStopped;
  if(voiceStopped!==true&&voiceStopped!==false){try{stopVoice();voiceStopped=true}catch{voiceStopped=false}}
  return {status:'revoked',voiceStopped};
 }
 async function connect() {
  // Reserve this operation before teardown can synchronously start another.
  const ticket=epoch+1;revoke();
  if(ticket!==epoch)return {status:'superseded'};
  let candidate;
  try{
   const identity=await fetcher('/api/james/workbench',{credentials:'same-origin',cache:'no-store',redirect:'error'});
   if(!identity.ok)throw Error('Authentication unavailable');
   const {accountId}=await identity.json();
   if(ticket!==epoch)return {status:'superseded'};
   if(typeof accountId!=='string'||!accountId.trim())throw Error('Trusted identity missing');
   const store=createRemoteWorkbenchStore({accountId,accountGeneration:ticket,request:async body=>{
    if(ticket!==epoch)throw Error('Account revoked');
    const response=await fetcher('/api/james/workbench',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(response.status===401||response.status===403){if(ticket===epoch)revoke();throw Error('Authentication changed')}
    if(!response.ok)throw Error('Request not confirmed');
    return response.json();
   }});
   candidate={accountId,store,screen:null};active=candidate;
   const screen=mount(root,{store,conversationId,stopVoice,onFocus});
   // Nested connects cannot mount until their identity await resumes. Dispose
   // this returned instance synchronously, before allowing that continuation.
   if(ticket!==epoch){
    store.revoke();
    try{
     const result=screen?.revoke();
     if(result?.recovery){const entries=recoveries.get(accountId)||[];entries.push({accountId,screen:result.recovery,pending:null});recoveries.set(accountId,entries)}
    }catch{}
    // Observe a rejected ready promise even though this mount is superseded.
    Promise.resolve(screen?.ready).catch(()=>{});
    return {status:'superseded'};
   }
   candidate.screen=screen;
   const ready=await candidate.screen.ready;
   if(ticket!==epoch)return {status:'superseded'};
   if(ready?.status!=='ready')throw Error('Workspace failed to load');
   root.hidden=false;
   return {status:'ready',accountId,isCurrent:()=>ticket===epoch&&active===candidate,recoveryCount:(recoveries.get(accountId)||[]).length};
  }catch{
   if(ticket!==epoch)return {status:'superseded'};
   revoke();return {status:'failed'};
  }
 }
 // Only the currently verified owner can export their private recoveries.
 // These are evidence for reconciliation, not instructions to resave a draft.
 function recoveryForCurrentAccount(){return active?structuredClone(recoveries.get(active.accountId)||[]):[]}
 async function leave(){
  const prior=active,ticket=epoch;
  if(!prior)return {status:'closed'};
  const result=await prior.screen?.unmount();
  if(ticket!==epoch||active!==prior)return {status:'superseded'};
  if(result?.status!=='closed')return result||{status:'blocked'};
  prior.store.revoke();active=null;epoch++;root.hidden=true;
  return {status:'closed'};
 }
 // Read-only identity reconciliation; trusted host hides presentation while
 // awaiting this result. Network failure never grants renewed presentation.
 async function verifyIdentity(){
  const prior=active,ticket=epoch;
  if(!prior)return {status:'closed'};
  let response,identity;
  try{
   response=await fetcher('/api/james/workbench',{credentials:'same-origin',cache:'no-store',redirect:'error'});
   if(response.ok)identity=await response.json();
  }catch{ return ticket===epoch&&active===prior?{status:'failed'}:{status:'superseded'} }
  if(ticket!==epoch||active!==prior)return {status:'superseded'};
  if(response.status===401||response.status===403||(response.ok&&identity?.accountId!==prior.accountId)){
   revoke();return {status:'changed'};
  }
  if(!response.ok)return {status:'failed'};
  return {status:'verified',accountId:prior.accountId,isCurrent:()=>ticket===epoch&&active===prior};
 }
 return {connect,revoke,leave,verifyIdentity,recoveryForCurrentAccount};
}
