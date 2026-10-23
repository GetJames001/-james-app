'use strict';
const {createHeadStore}=require('./head-store.cjs');
const {CAS}=require('../customer-activity/storage.cjs');
function createStorage({url,token,fetchImpl=fetch}){
 async function command(parts){
  if(!url||!token)throw Error('STORAGE_UNAVAILABLE');
  const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(parts)});
  if(!response.ok||!response.body)throw Error('STORAGE_UNAVAILABLE');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)throw Error('INVALID_STORAGE_RESPONSE');raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode();}
  catch(error){try{await reader.cancel()}catch{}throw error}finally{reader.releaseLock()}
  const result=JSON.parse(raw);if(!result||result.error||!Object.hasOwn(result,'result'))throw Error('INVALID_STORAGE_RESPONSE');return result.result;
 }
 return createHeadStore({read:async key=>{const value=await command(['GET',key]);if(value!==null&&typeof value!=='string')throw Error('INVALID_STORAGE_RESPONSE');return value;},compareAndSwap:async(key,old,next)=>{const value=await command(['EVAL',CAS,1,key,old===null?'absent':'present',old||'',next]);if(value!==0&&value!==1)throw Error('INVALID_STORAGE_RESPONSE');return value===1;}});
}
module.exports={createStorage};
