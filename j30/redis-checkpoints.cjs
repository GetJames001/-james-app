'use strict';
const {randomUUID}=require('node:crypto');const {scopeKey}=require('./checkpoints.cjs');
// Same atomic compare-and-swap primitive as James's existing Redis adapters.
const CAS="local old=redis.call('GET',KEYS[1]); if (ARGV[1]=='absent' and old==false) or (ARGV[1]=='present' and old==ARGV[2]) then redis.call('SET',KEYS[1],ARGV[3]); return 1 end; return 0";
function createRedisCheckpoints({read,compareAndSwap}){
 return {async exclusive(scope,id,operation){
  const key='james:j30:v1:'+scopeKey(scope,id);let previous=await read(key),state;
  try{state=previous===null?{version:1,task:null,lock:null}:JSON.parse(previous)}catch{throw Error('CHECKPOINT_INVALID')}
  if(!state||Object.keys(state).sort().join('|')!=='lock|task|version'||state.version!==1||(state.lock!==null&&(typeof state.lock!=='string'||!/^[\w-]{1,160}$/.test(state.lock))))throw Error('CHECKPOINT_INVALID');
  function validTask(row){if(row!==null&&(!row||typeof row!=='object'||Array.isArray(row)||JSON.stringify(row.scope)!==JSON.stringify(scope)||row.taskId!==id))throw Error('CHECKPOINT_INVALID')}
  validTask(state.task);if(state.lock!==null)throw Error('TASK_BUSY_OR_INTERRUPTED');
  state={...state,lock:randomUUID()};let raw=JSON.stringify(state);
  if(!await compareAndSwap(key,previous,raw))throw Error('TASK_BUSY_OR_INTERRUPTED');
  try{return await operation({read:async()=>structuredClone(state.task),write:async row=>{if(row===null)throw Error('CHECKPOINT_INVALID');validTask(row);const next={...state,task:structuredClone(row)},encoded=JSON.stringify(next);if(encoded.length>100000)throw Error('CHECKPOINT_TOO_LARGE');if(!await compareAndSwap(key,raw,encoded))throw Error('CHECKPOINT_WRITE_UNCONFIRMED');state=next;raw=encoded;}})}
  finally{const unlocked=JSON.stringify({...state,lock:null});if(!await compareAndSwap(key,raw,unlocked))throw Error('CHECKPOINT_RELEASE_UNCONFIRMED')}
 }};
}
function createRedisBackend({url,token,fetchImpl=fetch}){
 async function command(parts){
  if(!url||!token)throw Error('CHECKPOINT_BACKEND_UNAVAILABLE');let response;
  try{response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(parts)})}catch{throw Error('CHECKPOINT_BACKEND_UNAVAILABLE')}
  if(!response.ok||!response.body)throw Error('CHECKPOINT_BACKEND_UNAVAILABLE');const reader=response.body.getReader(),decoder=new TextDecoder();let raw='',size=0;
  try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>256000)throw Error('CHECKPOINT_TOO_LARGE');raw+=decoder.decode(item.value,{stream:true})}raw+=decoder.decode()}catch(error){try{await reader.cancel()}catch{}throw error}finally{reader.releaseLock()}
  let value;try{value=JSON.parse(raw)}catch{throw Error('CHECKPOINT_INVALID')};if(!value||value.error||!Object.hasOwn(value,'result'))throw Error('CHECKPOINT_INVALID');return value.result;
 }
 return createRedisCheckpoints({read:async key=>{const result=await command(['GET',key]);if(result!==null&&typeof result!=='string')throw Error('CHECKPOINT_INVALID');return result},compareAndSwap:async(key,old,next)=>{const result=await command(['EVAL',CAS,1,key,old===null?'absent':'present',old||'',next]);if(result!==0&&result!==1)throw Error('CHECKPOINT_WRITE_UNCONFIRMED');return result===1}});
}
module.exports={createRedisCheckpoints,createRedisBackend};
