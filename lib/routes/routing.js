'use strict';
const {requireAuth,privateNoStore}=require('../auth');
const {readiness,estimate}=require('../travel/routing');
function createHandler({authorize=requireAuth,env=process.env,fetchImpl=fetch,now=Date.now}={}){
 return async(req,res)=>{
  privateNoStore(res);
  if(!authorize(req,res,{csrf:req.method==='POST'}))return;
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  const query={...req.query};delete query.path;
  if(Object.keys(query).length)return res.status(400).json({error:'QUERY_NOT_SUPPORTED'});
  if(req.method==='GET')return res.status(200).json(readiness(env));
  let body;try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(!raw||Buffer.byteLength(raw)>4096)throw Error();body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['origin','destination','appointmentStart','bufferMinutes'].includes(k)))throw Error();}catch{return res.status(400).json({error:'INVALID_ROUTE_REQUEST'});}
  return res.status(200).json(await estimate(body,{env,fetchImpl,now:now()}));
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
