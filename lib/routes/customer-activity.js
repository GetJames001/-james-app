'use strict';
const {requireAuth,configuredIdentity}=require('../auth.js');
const {createStorage}=require('../customer-activity/storage.cjs');
const {evolve}=require('../customer-activity/records.cjs');
function createHandler({store,authorize=requireAuth,identity=configuredIdentity}){
 return async function handler(req,res){
  if(!authorize(req,res,{csrf:req.method!=='GET'}))return;
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});}
  if(Object.keys(req.query||{}).some(k=>k!=='path'))return res.status(400).json({ok:false,error:'INVALID_REQUEST'});
  const owner=identity();if(!owner)return res.status(503).json({ok:false,error:'OWNER_UNAVAILABLE'});
  try{
   if(req.method==='GET')return res.status(200).json({ok:true,document:await store.load(owner)});
   if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({ok:false,error:'JSON_REQUIRED'});
   let command=req.body;
   if(Buffer.byteLength(typeof command==='string'?command:JSON.stringify(command)||'')>12000)return res.status(413).json({ok:false,error:'REQUEST_TOO_LARGE'});
   try{if(typeof command==='string')command=JSON.parse(command);}catch{return res.status(400).json({ok:false,error:'INVALID_COMMAND'});}
   if(!command||Object.keys(command).some(k=>!['type','expectedRevision','customer','activity'].includes(k)))return res.status(400).json({ok:false,error:'INVALID_COMMAND'});
   if(command.type==='record_activity' && (Date.parse(command.activity?.occurredAt)>Date.now() || (command.activity?.outcome==='other'&&!command.activity?.notes?.trim())))return res.status(400).json({ok:false,error:'INVALID_COMMAND'});
   const current=await store.load(owner);
   try{evolve(current,command);}catch{return res.status(400).json({ok:false,error:'INVALID_COMMAND'});}
   const result=await store.commit(owner,command);
   return res.status(result.ok?200:409).json(result);
  }catch{return res.status(503).json({ok:false,error:'STORAGE_UNAVAILABLE'});}
 };
}
module.exports=(req,res)=>createHandler({store:createStorage({url:process.env.KV_REST_API_URL,token:process.env.KV_REST_API_TOKEN})})(req,res);
module.exports.createHandler=createHandler;
