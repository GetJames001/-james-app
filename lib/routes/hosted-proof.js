'use strict';
const {requireAuth,configuredIdentity,privateNoStore}=require('../auth.js');
const {createScheduleProof}=require('../task-execution/schedule-transport.cjs');
function createHandler({authorize=requireAuth,service=()=>createScheduleProof({owner:configuredIdentity()})}={}){
 return async(req,res)=>{
  privateNoStore(res);
  if(!authorize(req,res,{csrf:req.method!=='GET'}))return;
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  if(Object.keys(req.query||{}).some(k=>k!=='path'))return res.status(400).json({error:'INVALID_REQUEST'});
  let proof;try{proof=service();}catch{return res.status(404).json({error:'NOT_ENABLED'});}
  try{
   if(req.method==='GET')return res.status(200).json(await proof.status());
   if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
   let body;try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(typeof raw!=='string'||Buffer.byteLength(raw)>256)throw Error();body=JSON.parse(raw);}catch{return res.status(400).json({error:'INVALID_REQUEST'});}
   if(!body||Array.isArray(body)||Object.keys(body).join('|')!=='action'||!['arm','stop','resume'].includes(body.action))return res.status(400).json({error:'INVALID_REQUEST'});
   return res.status(200).json(await proof[body.action]());
  }catch(error){
   if(['PROOF_STOPPED','PROOF_WINDOW_CLOSED','NOT_RESUMABLE'].includes(error.code))return res.status(409).json({error:error.code});
   return res.status(503).json({error:'HOSTED_PROOF_UNAVAILABLE'});
  }
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
module.exports.page=(req,res)=>{
 privateNoStore(res);if(!requireAuth(req,res))return;
 try{createScheduleProof({owner:configuredIdentity()});}catch{return res.status(404).json({error:'NOT_ENABLED'});}
 if(!['GET','HEAD'].includes(req.method))return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 const script=req.query?.path==='hosted-proof-ui.js';
 res.setHeader('Content-Type',script?'application/javascript; charset=utf-8':'text/html; charset=utf-8');
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
 res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
 if(req.method==='HEAD')return res.status(200).end();
 return res.status(200).send(require('node:fs').readFileSync(require('node:path').join(process.cwd(),script?'hosted-proof-ui.js':'hosted-proof.html'),'utf8'));
};
