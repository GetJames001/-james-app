'use strict';
const {CAS}=require('../customer-activity/storage.cjs');
const {boundedJson}=require('../attention/storage-response.cjs');
const validKey=key=>typeof key==='string'&&/^james:task-execution:v1:[a-f0-9]{64}$/.test(key);
const validRaw=raw=>typeof raw==='string'&&Buffer.byteLength(raw)<=2*1024*1024;
function unavailable(){return Object.assign(Error('TASK_STORAGE_UNAVAILABLE'),{code:'TASK_STORAGE_UNAVAILABLE'});}
function createStorage({url,token,fetchImpl=fetch}){
 async function command(parts){
  if(!url||!token)throw unavailable();
  try{
   const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(parts)});
   if(!response.ok)throw unavailable();
   const body=await boundedJson(response);
   if(!body||typeof body!=='object'||body.error||!Object.hasOwn(body,'result'))throw unavailable();
   return body.result;
  }catch{throw unavailable();}
 }
 return {
  async read(key){
   if(!validKey(key))throw unavailable();
   const raw=await command(['GET',key]);
   if(raw!==null&&!validRaw(raw))throw unavailable();
   return raw;
  },
  async compareAndSwap(key,previous,next){
   if(!validKey(key)||(previous!==null&&!validRaw(previous))||!validRaw(next))throw unavailable();
   const result=await command(['EVAL',CAS,1,key,previous===null?'absent':'present',previous||'',next]);
   if(result!==0&&result!==1)throw unavailable();
   return result===1;
  }
 };
}
module.exports={createStorage};
