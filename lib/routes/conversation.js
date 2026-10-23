'use strict';
const {requireAuth,configuredIdentity}=require('../auth.js');
function createHandler({store,authorize=requireAuth,identity=configuredIdentity}){
 return async function(req,res){
  if(!authorize(req,res,{csrf:req.method!=='GET'}))return;
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  if(Object.keys(req.query||{}).some(k=>k!=='path'))return res.status(400).json({error:'INVALID_REQUEST'});
  const owner=identity();if(!owner)return res.status(503).json({error:'OWNER_UNAVAILABLE'});
  let command;
  if(req.method==='POST'){
   if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
   try{
    const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    if(typeof raw!=='string')return res.status(400).json({error:'INVALID_COMMAND'});
    if(Buffer.byteLength(raw)>4096)return res.status(413).json({error:'REQUEST_TOO_LARGE'});
    command=JSON.parse(raw);
    if(command===null||typeof command!=='object'||Array.isArray(command))return res.status(400).json({error:'INVALID_COMMAND'});
   }catch{return res.status(400).json({error:'INVALID_COMMAND'});}
  }
  try{
   const result=await store.execute(owner,command);
   return result?res.status(200).json(result):res.status(404).json({error:'NOT_ESTABLISHED'});
  }catch(error){
   const code=error?.message;
   if(code==='INVALID_COMMAND')return res.status(400).json({error:code});
   if(['SUPERSEDED','OPERATION_REUSED'].includes(code))return res.status(409).json({error:code});
   return res.status(503).json({error:'CONVERSATION_UNCONFIRMED'});
  }
 };
}
module.exports=(req,res)=>createHandler({store:require('../conversation/storage.cjs').createStorage({url:process.env.KV_REST_API_URL,token:process.env.KV_REST_API_TOKEN})})(req,res);
module.exports.createHandler=createHandler;
