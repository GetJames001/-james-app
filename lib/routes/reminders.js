'use strict';
const crypto=require('node:crypto');
const {requireAuth,privateNoStore,configuredIdentity}=require('../auth');
const {boundedJson}=require('../attention/storage-response.cjs');
const CAS="if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2]);return 1";
const ABSENT="if redis.call('EXISTS',KEYS[1]) ~= 0 then return 0 end redis.call('SET',KEYS[1],ARGV[1]);return 1";
function createHandler({authorize=requireAuth,env=process.env,identity=configuredIdentity,fetchImpl=fetch,now=Date.now}={}){
 return async(req,res)=>{
  privateNoStore(res);if(!authorize(req,res,{csrf:req.method==='POST'}))return;
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  const query={...req.query};delete query.path;if(Object.keys(query).length)return res.status(400).json({error:'INVALID_REQUEST'});
  try{
   const owner=identity(),branch=env.VERCEL_ENV==='preview'?'preview:'+env.VERCEL_GIT_COMMIT_REF:'production';if(!owner||env.VERCEL_ENV==='preview'&&!env.VERCEL_GIT_COMMIT_REF||!env.KV_REST_API_URL||!env.KV_REST_API_TOKEN)throw Error();
   const key='james:timed-reminders:v1:'+crypto.createHash('sha256').update(JSON.stringify([branch,owner])).digest('hex');
   async function command(parts){const response=await fetchImpl(env.KV_REST_API_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),headers:{Authorization:'Bearer '+env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(parts)}),data=await boundedJson(response);if(!response.ok||data.error||!Object.hasOwn(data,'result'))throw Error();return data.result;}
   async function load(){const raw=await command(['GET',key]);if(raw===null)return {raw,items:[]};if(typeof raw!=='string'||Buffer.byteLength(raw)>65536)throw Error();const doc=JSON.parse(raw);if(doc.version!==1||!Array.isArray(doc.items)||doc.items.length>150||doc.items.some(r=>!r||!/^[a-f0-9]{64}$/.test(r.id)||typeof r.title!=='string'||r.title.length>200||!Number.isFinite(Date.parse(r.dueAt))||!['open','completed'].includes(r.status)))throw Error();return {raw,items:doc.items};}
   if(req.method==='GET')return res.status(200).json({items:(await load()).items,delivery:'while_james_open'});
   if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
   let body;try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(!raw||Buffer.byteLength(raw)>2048)throw Error();body=JSON.parse(raw);if(!body||Array.isArray(body))throw Error();}catch{return res.status(400).json({error:'INVALID_REQUEST'});}
   const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))&&Date.parse(value)>now()&&Date.parse(value)<=now()+366*86400000;
   let reminder;
   if(body.action==='create'&&Object.keys(body).sort().join('|')==='action|dueAt|timeZone|title'){
    if(typeof body.title!=='string'||!body.title.trim()||body.title.length>200||/[\x00-\x1f]/.test(body.title)||!validDate(body.dueAt)||typeof body.timeZone!=='string'||body.timeZone.length>100)return res.status(400).json({error:'REMINDER_DETAILS_REQUIRED'});
    try{new Intl.DateTimeFormat('en-US',{timeZone:body.timeZone});}catch{return res.status(400).json({error:'REMINDER_DETAILS_REQUIRED'});}
    const title=body.title.trim(),dueAt=new Date(body.dueAt).toISOString();reminder={id:crypto.createHash('sha256').update(JSON.stringify([key,title.toLowerCase(),dueAt])).digest('hex'),title,dueAt,timeZone:body.timeZone,status:'open',createdAt:new Date(now()).toISOString()};
   }else if(!(['complete','snooze'].includes(body.action)&&typeof body.id==='string'&&/^[a-f0-9]{64}$/.test(body.id)&&Object.keys(body).sort().join('|')===(body.action==='complete'?'action|id':'action|dueAt|id')&&(body.action!=='snooze'||validDate(body.dueAt))))return res.status(400).json({error:'INVALID_REQUEST'});
   for(let attempt=0;attempt<5;attempt++){
    const saved=await load(),items=structuredClone(saved.items);let result;
    if(reminder){const prior=items.find(r=>r.id===reminder.id);if(prior)return res.status(200).json({status:prior.status==='completed'?'already_completed':'saved',reminder:prior,delivery:'while_james_open'});if(items.filter(r=>r.status==='open').length>=100)return res.status(409).json({error:'REMINDER_CAPACITY'});items.push(reminder);result=reminder;}
    else{result=items.find(r=>r.id===body.id);if(!result)return res.status(404).json({error:'REMINDER_NOT_FOUND'});if(body.action==='complete'){result.status='completed';result.completedAt=new Date(now()).toISOString();}else{if(result.status!=='open')return res.status(409).json({error:'REMINDER_ALREADY_COMPLETED'});result.dueAt=new Date(body.dueAt).toISOString();}}
    const retained=[...items.filter(r=>r.status==='open'),...items.filter(r=>r.status==='completed').sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt))).slice(0,50)],next=JSON.stringify({version:1,items:retained});if(Buffer.byteLength(next)>65536)throw Error();
    const stored=await command(saved.raw===null?['EVAL',ABSENT,1,key,next]:['EVAL',CAS,1,key,saved.raw,next]);if(stored===1)return res.status(200).json({status:'saved',reminder:result,delivery:'while_james_open'});if(stored!==0)throw Error();
   }
   return res.status(409).json({error:'REMINDER_CHANGED_RETRY'});
  }catch{return res.status(503).json({error:'REMINDERS_UNAVAILABLE'});}
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
