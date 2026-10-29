const crypto = require('node:crypto');
const {requireAuth, configuredIdentity} = require('../auth.js');
const {createSnapshotStore} = require('../attention/snapshot-store.cjs');
const {createReadHandler} = require('../attention/read-endpoint.cjs');

// Bound the REST envelope before JSON parsing; snapshot validation remains 1 MiB.
const MAX_RESPONSE_BYTES=8*1024*1024;
async function boundedJson(response){
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_RESPONSE_BYTES)){
    await response.body?.cancel();throw new Error('STORAGE_RESPONSE_TOO_LARGE');
  }
  if(!response.body)throw new Error('EMPTY_STORAGE_RESPONSE');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let size=0,text='';
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>MAX_RESPONSE_BYTES)throw new Error('STORAGE_RESPONSE_TOO_LARGE');
    text+=decoder.decode(value,{stream:true});
  }text+=decoder.decode();return JSON.parse(text);}
  catch(error){try{await reader.cancel();}catch{}throw error;}
  finally{reader.releaseLock();}
}
// Reads only saved Attention state. Does not read tokens, mail, triage or Tasks.
async function readCommand(command){
  if(command.length!==2||command[0]!=='GET'||!/^james:attention:v1:[a-f0-9]{64}$/.test(command[1]))throw new Error('READ_ONLY_COMMAND_REQUIRED');
  const response=await fetch(process.env.KV_REST_API_URL,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{Authorization:`Bearer ${process.env.KV_REST_API_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify(command)
  });
  if(!response.ok)throw new Error('STORAGE_UNAVAILABLE');
  const data=await boundedJson(response);
  if(!data||data.error||!Object.hasOwn(data,'result')||(data.result!==null&&typeof data.result!=='string'))throw new Error('INVALID_STORAGE_RESPONSE');
  return data.result;
}
const store=createSnapshotStore({command:readCommand,maxBytes:1024*1024});
const read=createReadHandler({
  authorize:(req,res)=>requireAuth(req,res),
  resolveAccount:()=>{
    const identity=configuredIdentity();
    if(!identity)throw new Error('OWNER_UNAVAILABLE');
    return 'owner:'+crypto.createHash('sha256').update(identity).digest('hex');
  },
  loadSnapshot:store.load,
  now:()=>new Date().toISOString()
});
module.exports=async function handler(req,res){
  // Gateway's routing parameter is infrastructure, not a client account control.
  const query={...(req.query||{})};delete query.path;
  return read({...req,query},res);
};
