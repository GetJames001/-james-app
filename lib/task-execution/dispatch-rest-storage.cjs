'use strict';
// Separate ports retain the original task-ledger adapter's narrow key policy.
// This module opens no listener and never provisions or discovers credentials.
const {CAS}=require('../customer-activity/storage.cjs');
const {boundedJson}=require('../attention/storage-response.cjs');
const MAX_BYTES=2*1024*1024;
const raw=value=>typeof value==='string'&&Buffer.byteLength(value)<=MAX_BYTES;
const unavailable=()=>Object.assign(Error('DISPATCH_STORAGE_UNAVAILABLE'),{code:'DISPATCH_STORAGE_UNAVAILABLE'});
function createDispatchStorage({url,token,kind,fetchImpl=fetch}){
 if(!['dispatch','notifications'].includes(kind))throw unavailable();
 const keyPattern=new RegExp('^james:task-'+kind+':v1:[a-f0-9]{64}$');
 async function command(parts){
  if(typeof url!=='string'||!url||typeof token!=='string'||!token)throw unavailable();
  try{
   const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(parts)});
   if(!response.ok)throw unavailable();
   const body=await boundedJson(response);
   if(!body||typeof body!=='object'||Array.isArray(body)||body.error||!Object.hasOwn(body,'result'))throw unavailable();
   return body.result;
  }catch{throw unavailable();}
 }
 return {
  async read(key){
   if(typeof key!=='string'||!keyPattern.test(key))throw unavailable();
   const result=await command(['GET',key]);
   if(result!==null&&!raw(result))throw unavailable();
   return result;
  },
  async compareAndSwap(key,previous,next){
   if(typeof key!=='string'||!keyPattern.test(key)||(previous!==null&&!raw(previous))||!raw(next))throw unavailable();
   const result=await command(['EVAL',CAS,1,key,previous===null?'absent':'present',previous||'',next]);
   if(result!==0&&result!==1)throw unavailable();
   return result===1;
  }
 };
}
module.exports={createDispatchStorage};
