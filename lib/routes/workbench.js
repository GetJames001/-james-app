'use strict';
const {requireAuth,configuredIdentity}=require('../auth.js');
function createHandler({store,authorize=requireAuth,identity=configuredIdentity}){
 return async(req,res)=>{
  if(!authorize(req,res,{csrf:req.method!=='GET'}))return;
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(Object.keys(req.query||{}).some(k=>k!=='path'))return res.status(400).json({error:'INVALID_REQUEST'});
  const owner=identity();if(!owner)return res.status(503).json({error:'OWNER_UNAVAILABLE'});
  let body;
  if(req.method==='POST'){
   try{body=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(typeof body!=='string')throw Error();}catch{return res.status(400).json({error:'INVALID_REQUEST'});}
   if(Buffer.byteLength(body)>262144)return res.status(413).json({error:'REQUEST_TOO_LARGE'});
  }
  try{
   const request=new Request('https://james.invalid/api/james/workbench',{method:req.method,headers:{'Content-Type':req.headers?.['content-type']||'',Origin:'https://james.invalid'},...(body===undefined?{}:{body})});
   const {workbenchRoute}=await import('../workbench/route.mjs');
   const result=await workbenchRoute(request,{store},owner);
   return res.status(result.status).json(await result.json());
  }catch{return res.status(503).json({error:'WORKBENCH_UNAVAILABLE'});}
 };
}
module.exports=(req,res)=>createHandler({store:require('../workbench/storage.cjs').createStorage({url:process.env.KV_REST_API_URL,token:process.env.KV_REST_API_TOKEN})})(req,res);
module.exports.createHandler=createHandler;
