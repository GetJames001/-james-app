const crypto=require('node:crypto');
const {requireAuth,configuredIdentity}=require('../auth.js');
const {validateMutation,validateStored}=require('../capture-schema.js');
const KEY_PREFIX='james:capture:v1:';
const MUTATE_LUA=`
local replay=redis.call('GET',KEYS[2])
if replay then
 local cached=cjson.decode(replay)
 if cached.fingerprint~=ARGV[4] then return {'conflict'} end
 return {'replay',cached.record}
end
local existing=redis.call('HGET',KEYS[1],ARGV[1])
if (existing or '')~=ARGV[5] then return {'conflict'} end
local previous=nil
if existing then
 local ok,value=pcall(cjson.decode,existing)
 if not ok or type(value)~='table' or value.id~=ARGV[1] or type(value.revision)~='number' then return {'invalid_store'} end
 previous=value
end
local revision=previous and previous.revision or 0
if revision~=tonumber(ARGV[2]) then return {'conflict'} end
if not previous and redis.call('HLEN',KEYS[1])>=500 then return {'limit'} end
local next=cjson.decode(ARGV[3])
next.revision=revision+1
if previous then next.createdAt=previous.createdAt end
local encoded=cjson.encode(next)
redis.call('HSET',KEYS[1],ARGV[1],encoded)
redis.call('SET',KEYS[2],cjson.encode({fingerprint=ARGV[4],record=encoded}),'EX',86400)
return {'saved',encoded}
`;
async function executeRedis(command){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(process.env.KV_REST_API_URL,{method:'POST',headers:{Authorization:`Bearer ${process.env.KV_REST_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:controller.signal});
    const data=await response.json();if(!response.ok||data.error)throw new Error('STORE_UNAVAILABLE');return data.result;
  }finally{clearTimeout(timer);}
}
function createCaptureHandler({execute=executeRedis,now=()=>new Date()}={}){
 return async function handler(req,res){
  if(!requireAuth(req,res,{csrf:req.method==='POST'}))return;
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  const owner=crypto.createHash('sha256').update(configuredIdentity()).digest('hex');const key=KEY_PREFIX+owner+':records';
  try{
    if(req.method==='GET'){
      const rows=await execute(['HVALS',key]);if(!Array.isArray(rows)||rows.length>500)throw new Error('INVALID_STORE');
      const records=rows.map(row=>{if(typeof row!=='string'||Buffer.byteLength(row)>12288)throw new Error('INVALID_STORE');return validateStored(JSON.parse(row));});if(new Set(records.map(r=>r.id)).size!==records.length)throw new Error('INVALID_STORE');
      records.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));return res.status(200).json({records});
    }
    let mutation;
    try{
      if(Number(req.headers['content-length'])>12288)throw new Error('INVALID_RECORD');
      const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
      if(typeof raw!=='string'||Buffer.byteLength(raw)>12288)throw new Error('INVALID_RECORD');mutation=validateMutation(JSON.parse(raw));
    }catch{return res.status(400).json({error:'INVALID_RECORD'});}
    const existing=await execute(['HGET',key,mutation.id]);
    if(existing!==null && existing!==undefined){if(typeof existing!=='string'||Buffer.byteLength(existing)>12288)throw new Error('INVALID_STORE');const stored=validateStored(JSON.parse(existing));if(stored.id!==mutation.id)throw new Error('INVALID_STORE');}
    const timestamp=new Date(now()).toISOString();const record={...mutation.record,id:mutation.id,revision:mutation.expectedRevision+1,createdAt:timestamp,updatedAt:timestamp};
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify(mutation)).digest('hex');
    const result=await execute(['EVAL',MUTATE_LUA,2,key,KEY_PREFIX+owner+':operation:'+mutation.operationId,mutation.id,String(mutation.expectedRevision),JSON.stringify(record),fingerprint,existing || '']);
    if(!Array.isArray(result))throw new Error('STORE_UNAVAILABLE');
    if(result[0]==='conflict')return res.status(409).json({error:'REVISION_OR_OPERATION_CONFLICT'});
    if(result[0]==='limit')return res.status(409).json({error:'RECORD_LIMIT'});
    if(!['saved','replay'].includes(result[0]))throw new Error('INVALID_STORE');
    return res.status(200).json({saved:true,replayed:result[0]==='replay',record:validateStored(JSON.parse(result[1]))});
  }catch{return res.status(503).json({error:'CAPTURE_UNAVAILABLE'});}
 };
}
module.exports=createCaptureHandler();module.exports.createCaptureHandler=createCaptureHandler;module.exports.MUTATE_LUA=MUTATE_LUA;module.exports.KEY_PREFIX=KEY_PREFIX;
