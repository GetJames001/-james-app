// Isolated transport boundary, NOT authentication or a database implementation.
// Host supplies an authenticated same-origin transport and immutable server scope.
export function createRemoteWorkbenchStore({accountId,accountGeneration,request,newOperationId=()=>crypto.randomUUID()}) {
 if(!accountId||!Number.isSafeInteger(accountGeneration)||typeof request!=='function')throw Error('Trusted scope and transport required');
 let active=true,pending=null,inFlight=false;
 const clone=x=>structuredClone(x),scope={accountId,accountGeneration};
 const superseded=()=>({status:'superseded'});
 const owns=p=>p&&p.accountId===accountId&&typeof p.id==='string'&&Number.isSafeInteger(p.revision)&&p.revision>=0;
 const failed=(commitState='unknown')=>({status:'failed',commitState,userMessage:'Save is not confirmed. Your draft is retained.'});
 async function read(action,id){
  if(!active)return superseded();
  let response;
  try{response=await request({action,...scope,...(id===undefined?{}:{id})})}
  catch(error){if(!active)return superseded();throw error}
  if(!active)return superseded();
  if(response?.accountId!==accountId||response.accountGeneration!==accountGeneration)throw Error('Unverified response scope');
  if(action==='list'){
   if(!Array.isArray(response.projects)||!response.projects.every(owns))throw Error('Invalid project list');
   return clone(response.projects);
  }
  if(response.project!==null&&(!owns(response.project)||response.project.id!==id))throw Error('Invalid project response');
  return clone(response.project);
 }
 async function send(){
  if(!active)return superseded();
  if(inFlight)return {status:'blocked',reason:'save_in_progress'};
  const ticket=pending;inFlight=true;
  try{
   let response;try{response=await request(clone(ticket))}catch{return active?failed():superseded()}
   if(!active)return superseded();
   if(response?.accountId!==accountId||response.accountGeneration!==accountGeneration||response.operationId!==ticket.operationId)return failed();
   if(response.status==='succeeded'){
    if(!owns(response.project)||response.project.id!==ticket.project.id||response.project.revision!==ticket.expectedRevision+1)return failed();
    pending=null;return {status:'succeeded',project:clone(response.project)};
   }
   if(['failed','conflict'].includes(response.status)&&response.commitState==='not_committed'){
    if(response.currentProject!==undefined&&response.currentProject!==null&&(!owns(response.currentProject)||response.currentProject.id!==ticket.project.id))return failed();
    pending=null;return {status:response.status,commitState:'not_committed',...(response.currentProject===undefined?{}:{currentProject:clone(response.currentProject)}),userMessage:'Save rejected. Your draft is retained.'};
   }
   return failed();
  }finally{inFlight=false}
 }
 return {
  get accountId(){return accountId},get accountGeneration(){return accountGeneration},
  list:()=>read('list'),load:id=>read('load',id),
  async save(project,{expectedRevision}={}){
   if(!active)return superseded();
   if(pending)return {status:'blocked',reason:'unresolved_save',commitState:'unknown'};
   if(!owns(project)||!Number.isSafeInteger(expectedRevision+1)||project.revision!==expectedRevision)return failed('not_committed');
   const operationId=newOperationId();if(typeof operationId!=='string'||!operationId)throw Error('Operation identity required');
   const candidate={action:'save',...scope,operationId,expectedRevision,project:clone(project)};
   // Local preflight proves no request was sent; never retain an unsendable retry.
   if(new TextEncoder().encode(JSON.stringify(candidate)).byteLength>262144)return failed('not_committed');
   pending=candidate;
   return send();
  },
  // Replays exact operation and payload, never a caller's newer draft.
  retryPending:()=>pending?send():Promise.resolve({status:'blocked',reason:'no_pending_save'}),
  pendingRecovery:()=>active&&pending?clone(pending):null,
  revoke(){active=false;const recovery=pending?clone(pending):null;pending=null;return recovery},
  switchAccount:()=>Promise.resolve({status:'blocked',reason:'host_must_replace_authenticated_store'}),
  readBlob:()=>Promise.reject(Error('Authenticated asset transport not connected')),
  writeBlob:()=>Promise.reject(Error('Authenticated asset transport not connected')),
  failNextSave:()=>{throw Error('Demo diagnostic unavailable')}
 };
}
