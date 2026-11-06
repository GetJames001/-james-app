'use strict';
const {createHash}=require('node:crypto');
const {configuredIdentity,requireAuth,privateNoStore}=require('../auth.js');
const {createSnapshotStore}=require('../attention/snapshot-store.cjs');
const {decideReview}=require('../attention/mail-review.cjs');
function createHandler({authorize=requireAuth,identity=configuredIdentity,store,now=()=>new Date().toISOString()}){
 return async(req,res)=>{
  privateNoStore(res);if(!authorize(req,res,{csrf:req.method==='POST'}))return;
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
  const query={...req.query};delete query.path;
  let body;try{if(typeof req.body==='string'&&Buffer.byteLength(req.body)>512)throw Error();body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).json({error:'INVALID_REVIEW_DECISION'});}
  if(Object.keys(query).length||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['reviewKey','action'].includes(key))||!['handled','undo'].includes(body.action)||typeof body.reviewKey!=='string'||!/^[a-f0-9]{64}$/.test(body.reviewKey))return res.status(400).json({error:'INVALID_REVIEW_DECISION'});
  const owner=identity();if(!owner)return res.status(503).json({error:'REVIEW_UNAVAILABLE'});
  const accountId='owner:'+createHash('sha256').update(owner).digest('hex');
  try{
   const previous=await store.load(accountId),next=decideReview(previous,body.reviewKey,body.action,now());
   const result=await store.save({accountId,expectedRevision:previous.revision,...next});
   return res.status(200).json({saved:true,revision:result.snapshot.revision});
  }catch(error){const conflict=['REVISION_CONFLICT','REVIEW_CHANGED_RETRY'].includes(error.code);return res.status(conflict?409:503).json({error:conflict?'REVIEW_CHANGED_RETRY':'REVIEW_UNAVAILABLE'});}
 };
}
module.exports=createHandler({store:createSnapshotStore({command:require('./attention-scan.js').command,maxBytes:1024*1024})});module.exports.createHandler=createHandler;
