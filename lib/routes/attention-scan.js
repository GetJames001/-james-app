'use strict';
const {createHash}=require('node:crypto');
const {configuredIdentity,requireAuth,privateNoStore}=require('../auth.js');
const {createSnapshotStore}=require('../attention/snapshot-store.cjs');
const {boundedJson}=require('../attention/storage-response.cjs');
const {collectReview,collectFailure}=require('../attention/mail-review.cjs');
function createHandler({authorize=requireAuth,identity=configuredIdentity,store,readMail,readGmail,now=()=>new Date().toISOString()}){
 return async(req,res)=>{
  privateNoStore(res);
  if(!authorize(req,res,{csrf:req.method==='POST'}))return;
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
  const query={...req.query};delete query.path;
  let body;try{if(typeof req.body==='string'&&Buffer.byteLength(req.body)>1024)throw Error();body=typeof req.body==='string'?JSON.parse(req.body):(req.body===undefined?{}:req.body);}catch{return res.status(400).json({error:'INVALID_SCAN_REQUEST'});}
  if(Object.keys(query).length||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)return res.status(400).json({error:'SCAN_CONTROLS_NOT_SUPPORTED'});
  const owner=identity();if(!owner)return res.status(503).json({error:'ATTENTION_UNAVAILABLE'});
  const accountId='owner:'+createHash('sha256').update(owner).digest('hex');
  let previous,stage='saved_state';
  try{
   previous=await store.load(accountId);
   let working=previous,successful=0,changed=false;const sources={};const at=now();
   for(const [provider,reader] of [['microsoft',()=>readMail(req)],...(readGmail?[['gmail',()=>readGmail()]]:[])]){
    stage='mail_read';let data;
    try{data=await reader();if(provider==='gmail'&&data.connected===false){sources.gmail='not_connected';continue;}if(data.connected!==true||!Array.isArray(data.messages))throw Error();}
    catch{
     sources[provider==='gmail'?'gmail':'hotmail']='unavailable';
     continue;
    }
    stage='prepare_review';const next=collectReview(working,accountId,data.messages,at,provider);working={...(working||{revision:0}),...next};changed=true;successful++;sources[provider==='gmail'?'gmail':'hotmail']='checked';
   }
   if(working)for(const [name,status] of Object.entries(sources))if(status==='unavailable'){working={...working,...collectFailure(working,accountId,at,name==='gmail'?'gmail':'microsoft')};changed=true;}
   if(!changed) return res.status(503).json({error:'MAIL_REVIEW_UNAVAILABLE',stage:'mail_read'});
   stage='save_review';const result=await store.save({accountId,expectedRevision:previous?.revision||0,state:working.state,policy:working.policy,coverage:working.coverage,provenance:working.provenance});
   if(!successful)return res.status(503).json({error:'MAIL_REVIEW_UNAVAILABLE',stage:'mail_read'});
   return res.status(200).json({saved:true,revision:result.snapshot.revision,partial:Object.values(sources).includes('unavailable'),sources,mailboxWide:false,semanticReviewComplete:false});
  }catch(error){console.warn('ATTENTION_MAIL_REVIEW_FAILED',{stage,reason:['REVISION_CONFLICT','INVALID_SNAPSHOT','CORRUPT_SNAPSHOT','INVALID_STORED_BYTES','MAIL_REVIEW_CAPACITY','COMMIT_OUTCOME_UNKNOWN'].includes(error.code||error.message)?(error.code||error.message):'unavailable'});return res.status(error.code==='REVISION_CONFLICT'?409:503).json({error:error.code==='REVISION_CONFLICT'?'REVIEW_CHANGED_RETRY':error.message==='MAIL_REVIEW_CAPACITY'?'MAIL_REVIEW_CAPACITY':'MAIL_REVIEW_UNAVAILABLE',stage});}
 };
}
async function command(parts){
 const response=await fetch(process.env.KV_REST_API_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),headers:{Authorization:'Bearer '+process.env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(parts)});
 // Snapshot store independently enforces a 1 MiB decoded value limit.
 if(!response.ok)throw Error('STORAGE_UNAVAILABLE');
 const data=await boundedJson(response);if(data.error||!Object.hasOwn(data,'result'))throw Error('STORAGE_UNAVAILABLE');return data.result;
}
module.exports=createHandler({store:createSnapshotStore({command,maxBytes:1024*1024}),readGmail:require('../google/gmail-mail.js').createReader(),readMail:async req=>{
 let status=200,data;
 const res={setHeader(){},status(value){status=value;return this;},json(value){data=value;return this;},end(){return this;}};
 await require('../../api/microsoft/mail.js')({...req,headers:req.headers,method:'GET',body:undefined,query:{account:'personal'}},res);
 if(status!==200)throw Error('MAIL_UNAVAILABLE');return data||{};
}});
module.exports.createHandler=createHandler;
