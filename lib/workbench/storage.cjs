'use strict';
const {createHash}=require('node:crypto');
const key=owner=>'james:workbench:v1:'+createHash('sha256').update(owner).digest('hex');
// Compare the entire previous value atomically; never overwrite another device's update.
const CAS="local old=redis.call('GET',KEYS[1]); if (ARGV[1]=='absent' and old==false) or (ARGV[1]=='present' and old==ARGV[2]) then redis.call('SET',KEYS[1],ARGV[3]); return 1 end; return 0";
function createStorage({url,token,fetchImpl=fetch}){
 async function command(parts){
  if(!url||!token)throw new Error('STORAGE_UNAVAILABLE');
  const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(parts)});
  if(!response.ok||!response.body)throw new Error('STORAGE_UNAVAILABLE');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let text='',size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024)throw new Error('STORAGE_RESPONSE_TOO_LARGE');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
  catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}
  const data=JSON.parse(text);
  if(!data||data.error||!Object.hasOwn(data,'result'))throw new Error('INVALID_STORAGE_RESPONSE');
  return data.result;
 }
 return {
 async load(owner){const raw=await command(['GET',key(owner)]);if(raw===null)return null;if(typeof raw!=='string')throw Error('INVALID_STORAGE_RESPONSE');const row=JSON.parse(raw);if(!Number.isSafeInteger(row.revision)||row.revision<1||typeof row.document!=='string')throw Error('INVALID_STORAGE_RESPONSE');const d=JSON.parse(row.document);if(!Array.isArray(d.projects)||!Array.isArray(d.receipts)||d.projects.some(p=>p.accountId!==owner)||d.receipts.some(r=>!r||typeof r.id!=='string'||typeof r.digest!=='string'||!r.outcome||!['succeeded','failed','conflict'].includes(r.outcome.status)||[r.outcome.project,r.outcome.currentProject].some(p=>p!=null&&(p.accountId!==owner||typeof p.id!=='string'||!Number.isSafeInteger(p.revision)))))throw Error('INVALID_STORAGE_RESPONSE');return {...row,raw};},
 async commit(owner,previous,document){const next=JSON.stringify({revision:(previous?.revision||0)+1,document});const result=await command(['EVAL',CAS,1,key(owner),previous===null?'absent':'present',previous?.raw||'',next]);if(result!==0&&result!==1)throw Error('INVALID_STORAGE_RESPONSE');return result===1;}
 };
}
module.exports={createStorage,CAS};
