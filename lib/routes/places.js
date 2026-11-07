'use strict';
const {requireAuth,privateNoStore}=require('../auth');
const {searchPlaces}=require('../travel/places');
function createHandler({authorize=requireAuth,env=process.env,fetchImpl=fetch}={}){
 return async(req,res)=>{
  privateNoStore(res);if(!authorize(req,res,{csrf:true}))return;
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
  const query={...req.query};delete query.path;if(Object.keys(query).length)return res.status(400).json({error:'QUERY_NOT_SUPPORTED'});
  let body;try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(!raw||Buffer.byteLength(raw)>2048)throw Error();body=JSON.parse(raw);if(!body||!Object.keys(body).includes('query')||Object.keys(body).some(k=>!['query','area','location'].includes(k))||typeof body.query!=='string'||body.query.trim().length<3||body.query.length>400||/[\x00-\x1f]/.test(body.query))throw Error();}catch{return res.status(400).json({error:'INVALID_PLACE_QUERY'});}
  return res.status(200).json(await searchPlaces(body,{env,fetchImpl}));
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
