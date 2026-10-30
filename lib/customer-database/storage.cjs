'use strict';
const {CAS}=require('../customer-activity/storage.cjs');
const {randomUUID}=require('node:crypto');
const model=require('./model.cjs');
function failure(code){throw Object.assign(new Error(code),{code});}
function createTransport({url,token,fetchImpl=fetch}){
 return async parts=>{
  if(!url||!token)failure('STORAGE_UNAVAILABLE');
  const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(parts)});
  if(!response.ok||!response.body)failure('STORAGE_UNAVAILABLE');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>12*1024*1024)failure('STORAGE_RESPONSE_TOO_LARGE');text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{try{await reader.cancel();}catch{}reader.releaseLock();}
  const result=JSON.parse(text);if(!result||result.error||!Object.hasOwn(result,'result'))failure('INVALID_STORAGE_RESPONSE');return result.result;
 };
}
function createStore({command}){
 const read=async key=>{const value=await command(['GET',key]);if(value!==null&&typeof value!=='string')failure('INVALID_STORAGE_RESPONSE');return value;};
 const save=async(key,raw,next)=>{const value=await command(['EVAL',CAS,1,key,raw===null?'absent':'present',raw||'',JSON.stringify(next)]);if(value!==0&&value!==1)failure('INVALID_STORAGE_RESPONSE');if(!value)failure('CONCURRENT_CHANGE');};
 const registry=async owner=>{
  const raw=await read(model.registryKey(owner)),doc=raw===null?{version:1,workspaces:[],operations:[]}:JSON.parse(raw);
  if(doc.version!==1||!Array.isArray(doc.workspaces)||doc.workspaces.length>20||!Array.isArray(doc.operations)||doc.operations.length>100)failure('INVALID_WORKSPACES');
  const ids=new Set();for(const w of doc.workspaces){model.id(w.id);model.text(w.name,120);if(ids.has(w.id))failure('INVALID_WORKSPACES');ids.add(w.id);}return {raw,doc};
 };
 const authorize=async(owner,workspace)=>{model.id(workspace);const r=await registry(owner);if(!r.doc.workspaces.some(w=>w.id===workspace))failure('WORKSPACE_NOT_FOUND');return r;};
 return {
  async workspaces(owner){return (await registry(owner)).doc.workspaces;},
  async createWorkspace(owner,{name,operationId}){
   model.id(operationId);name=model.text(name,120);if(!name)failure('WORKSPACE_NAME_REQUIRED');const {raw,doc}=await registry(owner),old=doc.operations.find(x=>x.id===operationId);
   if(old){if(old.name!==name)failure('OPERATION_ID_REUSED');return old.workspace;}
   if(doc.workspaces.length>=20||doc.operations.length>=100)failure('WORKSPACE_CAPACITY');
   const workspace={id:randomUUID(),name,createdAt:new Date().toISOString()};doc.workspaces.push(workspace);doc.operations.push({id:operationId,name,workspace});await save(model.registryKey(owner),raw,doc);return workspace;
  },
  async load(owner,workspace){await authorize(owner,workspace);const raw=await read(model.identityKey(owner,workspace));return raw===null?model.empty():model.validate(JSON.parse(raw));},
  async mutate(owner,workspace,expectedRevision,update){
   await authorize(owner,workspace);const key=model.identityKey(owner,workspace),raw=await read(key),doc=raw===null?model.empty():model.validate(JSON.parse(raw));
   // Run replay resolution before revision comparison: same operation can be
   // reconciled after a lost response, without applying it a second time.
   const result=await update(doc);if(result.replayed)return {...result,revision:doc.revision};
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==doc.revision)failure('CONCURRENT_CHANGE');model.validate(result.document);await save(key,raw,result.document);return {...result,revision:result.document.revision};
  }
 };
}
module.exports={createStore,createTransport};
