'use strict';
const {createHash}=require('node:crypto');
const {configuredIdentity,requireAuth,privateNoStore}=require('../auth.js');
const {createSnapshotStore}=require('../attention/snapshot-store.cjs');
const {boundedJson}=require('../attention/storage-response.cjs');
const {collectReview,collectFailure}=require('../attention/mail-review.cjs');
function createHandler({authorize=requireAuth,identity=configuredIdentity,store,readMail,now=()=>new Date().toISOString()}){
 return async(req,res)=>{
  privateNoStore(res);
  if(!authorize(req,res,{csrf:req.method==='POST'}))return;
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
  const query={...req.query};delete query.path;
  if(Object.keys(query).length||req.body&&Object.keys(req.body).length)return res.status(400).json({error:'SCAN_CONTROLS_NOT_SUPPORTED'});
  const owner=identity();if(!owner)return res.status(503).json({error:'ATTENTION_UNAVAILABLE'});
  const accountId='owner:'+createHash('sha256').update(owner).digest('hex');
  let previous,readFailed=false;
  try{
   previous=await store.load(accountId);
   let data;try{data=await readMail(req);if(data.connected!==true||!Array.isArray(data.messages))throw Error();}catch{readFailed=true;throw Error('MAIL_READ_FAILED');}
   const at=now(),next=collectReview(previous,accountId,data.messages,at);
   const result=await store.save({accountId,expectedRevision:previous?.revision||0,...next});
   return res.status(200).json({saved:true,revision:result.snapshot.revision,mailboxWide:false,semanticReviewComplete:false});
  }catch(error){if(readFailed&&previous){try{const next=collectFailure(previous,accountId,now());await store.save({accountId,expectedRevision:previous.revision,...next});}catch{}}return res.status(error.code==='REVISION_CONFLICT'?409:503).json({error:error.code==='REVISION_CONFLICT'?'REVIEW_CHANGED_RETRY':error.message==='MAIL_REVIEW_CAPACITY'?'MAIL_REVIEW_CAPACITY':'MAIL_REVIEW_UNAVAILABLE'});}
 };
}
async function command(parts){
 const response=await fetch(process.env.KV_REST_API_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),headers:{Authorization:'Bearer '+process.env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(parts)});
 // Snapshot store independently enforces a 1 MiB decoded value limit.
 if(!response.ok)throw Error('STORAGE_UNAVAILABLE');
 const data=await boundedJson(response);if(data.error||!Object.hasOwn(data,'result'))throw Error('STORAGE_UNAVAILABLE');return data.result;
}
module.exports=createHandler({store:createSnapshotStore({command,maxBytes:1024*1024}),readMail:async req=>{
 let status=200,data;
 const res={setHeader(){},status(value){status=value;return this;},json(value){data=value;return this;},end(){return this;}};
 await require('../../api/microsoft/mail.js')({...req,method:'GET',body:undefined,query:{account:'personal'}},res);
 if(status!==200)throw Error('MAIL_UNAVAILABLE');return data||{};
}});
module.exports.createHandler=createHandler;
