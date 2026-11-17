'use strict';
const {requireAuth,configuredIdentity,privateNoStore}=require('../auth.js');
const ARCHER='Fahco4VZzobUeiPqni1S';
function createHandler({authorize=requireAuth,identity=configuredIdentity,store,fetchImpl=fetch,env=process.env}={}){
 return async(req,res)=>{
  privateNoStore(res);
  if(!authorize(req,res,{csrf:req.method==='POST'}))return;
  const ready=!!env.ELEVENLABS_API_KEY&&env.JAMES_ARCHER_ENABLED==='true';
  if(req.method==='GET')return res.status(200).json({voice:'archer',ready,reason:ready?null:!env.ELEVENLABS_API_KEY?'connection_required':'activation_required'});
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{}
  if(!body||Object.keys(body).sort().join('|')!=='scope|text'||typeof body.text!=='string'||!body.text.trim()||body.text.length>12000||!body.scope||Object.keys(body.scope).sort().join('|')!=='accountId|conversationId|generation')return res.status(400).json({error:'INVALID_SPEECH_REQUEST'});
  if(!ready)return res.status(503).json({error:!env.ELEVENLABS_API_KEY?'ARCHER_CONNECTION_REQUIRED':'ARCHER_ACTIVATION_REQUIRED'});
  let current;try{current=await store.execute(identity());}catch{return res.status(503).json({error:'CONVERSATION_UNCONFIRMED'});}
  if(current?.status!=='ready'||['accountId','conversationId','generation'].some(k=>current[k]!==body.scope[k]))return res.status(409).json({error:'CONVERSATION_CHANGED'});
  try{
   const response=await fetchImpl('https://api.elevenlabs.io/v1/text-to-speech/'+ARCHER+'/stream?output_format=mp3_44100_128',{method:'POST',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,'Content-Type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({text:body.text,model_id:'eleven_flash_v2_5'}),signal:AbortSignal.timeout(25000)});
   if(!response.ok)return res.status(502).json({error:response.status===401||response.status===403?'ARCHER_ACCESS_REQUIRED':response.status===429?'ARCHER_USAGE_LIMIT':'ARCHER_SPEECH_FAILED'});
   if(!response.headers.get('content-type')?.startsWith('audio/'))return res.status(502).json({error:'ARCHER_SPEECH_FAILED'});
   const reader=response.body.getReader();let length=0;const chunks=[];
   while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8000000){await reader.cancel();return res.status(502).json({error:'ARCHER_SPEECH_TOO_LARGE'});}chunks.push(Buffer.from(value));}
   if(!length)return res.status(502).json({error:'ARCHER_SPEECH_FAILED'});
   res.setHeader('Content-Type','audio/mpeg');return res.status(200).send(Buffer.concat(chunks));
  }catch{return res.status(502).json({error:'ARCHER_SPEECH_FAILED'});}
 };
}
module.exports=(req,res)=>createHandler({store:require('../conversation/storage.cjs').createStorage({url:process.env.KV_REST_API_URL,token:process.env.KV_REST_API_TOKEN})})(req,res);
module.exports.createHandler=createHandler;
