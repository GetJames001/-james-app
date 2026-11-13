'use strict';
const {createHash}=require('node:crypto');
const plain=v=>v!==null&&Object.getPrototypeOf(v)===Object.prototype;
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const integer=(v,a=0,b=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
function fail(code){throw Object.assign(Error(code),{code});}
function scopedDispatchKey(owner,kind){if(typeof owner!=='string'||!owner.trim()||owner.length>320)fail('OWNER_REQUIRED');if(!['dispatch','notifications'].includes(kind))fail('INVALID_NAMESPACE');return 'james:task-'+kind+':v1:'+createHash('sha256').update(owner).digest('hex');}
function createDocumentStore({read,compareAndSwap,kind,validate,initial=()=>({records:[],audit:[]})}){
 if(typeof read!=='function'||typeof compareAndSwap!=='function'||typeof validate!=='function')fail('STORE_REQUIRED');
 function decode(raw){
  if(raw===null)return {schemaVersion:1,revision:0,...initial()};
  try{if(typeof raw!=='string'||Buffer.byteLength(raw)>2*1024*1024)throw Error();const d=JSON.parse(raw);if(!plain(d)||d.schemaVersion!==1||!integer(d.revision)||!Array.isArray(d.records)||d.records.length>50||!Array.isArray(d.audit)||d.audit.length>200||!validate(d))throw Error();return d;}catch{fail('CORRUPT_DISPATCH_STORE');}
 }
 async function snapshot(owner){return structuredClone(decode(await read(scopedDispatchKey(owner,kind))));}
 async function mutate(owner,fn){
  const key=scopedDispatchKey(owner,kind);
  for(let retry=0;retry<8;retry++){
   const raw=await read(key),d=decode(raw),before=JSON.stringify(d),value=fn(d);
   if(JSON.stringify(d)===before)return structuredClone(value);
   if(d.revision===Number.MAX_SAFE_INTEGER||d.records.length>50||d.audit.length>200)fail('CAPACITY_REACHED');d.revision++;
   if(!validate(d))fail('INVALID_DISPATCH_MUTATION');const next=JSON.stringify(d);if(Buffer.byteLength(next)>2*1024*1024)fail('CAPACITY_REACHED');
   if(await compareAndSwap(key,raw,next))return structuredClone(value);
  }
  fail('BUSY_RECONCILE');
 }
 return {snapshot,mutate};
}
module.exports={createDocumentStore,scopedDispatchKey,plain,id,integer,fail};
