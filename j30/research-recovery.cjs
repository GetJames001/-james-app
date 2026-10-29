'use strict';
const {createHash}=require('node:crypto');
const {scopeKey}=require('./checkpoints.cjs');
const {discoveryRequest}=require('./discovery.cjs');
const {currentWithin,valueWithin}=require('./public-fetch.cjs');
const {generalReport,validateCheckpoint}=require('./general-shopping.cjs');
const INDEX_ID='__j30_research_index_v1';
const fail=code=>{throw Error(code)};
function queryKey(text){const p=discoveryRequest(text);return createHash('sha256').update(JSON.stringify([p.query.toLowerCase(),p.maxPrice,p.currency])).digest('hex')}
function createRecoverableResearch({research,checkpoints,verifyScope,timeoutMs=45000}){
 if(typeof research!=='function'||!checkpoints?.exclusive||typeof verifyScope!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000)fail('HOST_DEPENDENCIES_REQUIRED');
 return async request=>{
  const {scope,taskId:requestedId,text,signal:upstream,isCurrent=()=>false}=request;
  scopeKey(scope,requestedId);if(requestedId.startsWith('__j30_'))fail('REQUEST_INVALID');
  const key=queryKey(text),deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),timeoutMs),signal=upstream?AbortSignal.any([upstream,deadline.signal]):deadline.signal;
  async function current(){await currentWithin(async()=>{if(!isCurrent()||!await verifyScope(scope)||!isCurrent())fail('TASK_INTERRUPTED')},signal)}
  try{
  await current();
  const entry=await valueWithin(()=>checkpoints.exclusive(scope,INDEX_ID,async store=>{
   let index=await store.read();await current();
   if(index){
    if(index.version!==1||index.kind!=='research-recovery-index'||JSON.stringify(index.scope)!==JSON.stringify(scope)||index.taskId!==INDEX_ID||!Array.isArray(index.entries)||index.entries.length>20)fail('CHECKPOINT_INVALID');
    const ids=new Set();for(const e of index.entries){if(!e||Object.keys(e).sort().join('|')!=='key|taskId|text'||typeof e.taskId!=='string'||e.taskId.startsWith('__j30_')||ids.has(e.taskId)||typeof e.text!=='string'||e.key!==queryKey(e.text))fail('CHECKPOINT_INVALID');scopeKey(scope,e.taskId);ids.add(e.taskId)}
   }else index={version:1,kind:'research-recovery-index',scope,taskId:INDEX_ID,entries:[]};
   const exact=index.entries.find(e=>e.taskId===requestedId),latest=[...index.entries].reverse().find(e=>e.key===key);
   if(exact&&exact.key!==key)fail('TASK_REQUEST_MISMATCH');
   let legacy;
   if(!exact)await checkpoints.exclusive(scope,requestedId,async taskStore=>{
    const previous=await taskStore.read();await current();if(!previous)return;
    if(previous.kind!=='general-shopping'||previous.taskId!==requestedId||JSON.stringify(previous.scope)!==JSON.stringify(scope)||typeof previous.request!=='string')fail('CHECKPOINT_INVALID');
    if(queryKey(previous.request)!==key)fail('TASK_REQUEST_MISMATCH');
    validateCheckpoint(previous,discoveryRequest(previous.request),scope,requestedId);
    legacy={key,text:previous.request,taskId:requestedId};
   });
   if(request.fresh===true){
    if(exact||legacy||!latest)fail('FRESH_RESEARCH_NOT_ALLOWED');
    // A new run is explicit and may never bypass an uncertain prior write/read.
    await checkpoints.exclusive(scope,latest.taskId,async taskStore=>{const previous=await taskStore.read();await current();if(!previous||previous.kind!=='general-shopping'||JSON.stringify(previous.scope)!==JSON.stringify(scope)||previous.taskId!==latest.taskId||previous.request!==latest.text||previous.status!=='completed'||previous.uncertainSession!==false||previous.cleanupUnconfirmed!==false)fail('FRESH_RESEARCH_NOT_ALLOWED');validateCheckpoint(previous,discoveryRequest(previous.request),scope,latest.taskId);if(generalReport(previous).comparisonVerified!==true)fail('FRESH_RESEARCH_NOT_ALLOWED')});
   }else if(exact||latest)return structuredClone(exact||legacy||latest);
   if(index.entries.length>=20)fail('TASK_HISTORY_LIMIT');
   const next=legacy||{key,text,taskId:requestedId};index.entries.push(next);await current();await store.write(index);await current();return next;
  }),signal);
  await current();const result=await research({...request,signal,text:entry.text,taskId:entry.taskId});await current();
  return entry.taskId===requestedId?result:{...result,recoveredTask:true,requestedTaskId:requestedId};
  }finally{clearTimeout(timer)}
 };
}
module.exports={createRecoverableResearch,INDEX_ID};
