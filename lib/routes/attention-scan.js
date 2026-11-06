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
   let working=previous,successful=0,changed=false,olderPartial=false;const sources={};const at=now();
   const readers=[['microsoft',()=>readMail(req,previous)],...(readGmail?[['gmail',()=>readGmail(previous)]]:[])];
   const reads=await Promise.allSettled(readers.map(([,reader])=>reader()));
   for(let index=0;index<readers.length;index++){
    const provider=readers[index][0];
    stage='mail_read';let data;
    try{if(reads[index].status==='rejected')throw Error();data=reads[index].value;if(provider==='gmail'&&data.connected===false){sources.gmail='not_connected';continue;}if(data.connected!==true||!Array.isArray(data.messages))throw Error();}
    catch{
     sources[provider==='gmail'?'gmail':'hotmail']='unavailable';
     continue;
    }
    stage='prepare_review';olderPartial=olderPartial||data.discovery?.failed===true;
    try{const next=collectReview(working,accountId,data.messages,at,provider,data.checkpoint||null,data.reconciliation||null,data.discovery||null);working={...(working||{revision:0}),...next};changed=true;successful++;sources[provider==='gmail'?'gmail':'hotmail']='checked';}
    catch(error){if(error.message!=='MAIL_REVIEW_CAPACITY')throw error;sources[provider==='gmail'?'gmail':'hotmail']='capacity_limited';}
   }
   if(working)for(const [name,status] of Object.entries(sources))if(['unavailable','capacity_limited'].includes(status)){working={...working,...collectFailure(working,accountId,at,name==='gmail'?'gmail':'microsoft',status==='capacity_limited'?'MAIL_REVIEW_CAPACITY':'MAIL_READ_FAILED')};changed=true;}
   if(!changed) return res.status(503).json({error:'MAIL_REVIEW_UNAVAILABLE',stage:'mail_read'});
   stage='save_review';const result=await store.save({accountId,expectedRevision:previous?.revision||0,state:working.state,policy:working.policy,coverage:working.coverage,provenance:working.provenance});
   if(!successful)return res.status(503).json({error:Object.values(sources).includes('capacity_limited')?'MAIL_REVIEW_CAPACITY':'MAIL_REVIEW_UNAVAILABLE',stage:'mail_read'});
   return res.status(200).json({saved:true,revision:result.snapshot.revision,partial:olderPartial||Object.values(sources).some(status=>['unavailable','capacity_limited'].includes(status)),sources,mailboxWide:false,semanticReviewComplete:false});
  }catch(error){console.warn('ATTENTION_MAIL_REVIEW_FAILED',{stage,reason:['REVISION_CONFLICT','INVALID_SNAPSHOT','CORRUPT_SNAPSHOT','INVALID_STORED_BYTES','MAIL_REVIEW_CAPACITY','COMMIT_OUTCOME_UNKNOWN'].includes(error.code||error.message)?(error.code||error.message):'unavailable'});return res.status(error.code==='REVISION_CONFLICT'?409:503).json({error:error.code==='REVISION_CONFLICT'?'REVIEW_CHANGED_RETRY':error.message==='MAIL_REVIEW_CAPACITY'?'MAIL_REVIEW_CAPACITY':'MAIL_REVIEW_UNAVAILABLE',stage});}
 };
}
async function command(parts){
 const response=await fetch(process.env.KV_REST_API_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),headers:{Authorization:'Bearer '+process.env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(parts)});
 // Snapshot store independently enforces a 1 MiB decoded value limit.
 if(!response.ok)throw Error('STORAGE_UNAVAILABLE');
 const data=await boundedJson(response);if(data.error||!Object.hasOwn(data,'result'))throw Error('STORAGE_UNAVAILABLE');return data.result;
}
const readGmailInbox=require('../google/gmail-mail.js').createReader();
module.exports=createHandler({store:createSnapshotStore({command,maxBytes:1024*1024}),readGmail:previous=>readGmailInbox({previous}),readMail:async (req,previous)=>{
 const invoke=async query=>{
  let status=200,data;
  const res={setHeader(){},status(value){status=value;return this;},json(value){data=value;return this;},end(){return this;}};
  await require('../../api/microsoft/mail.js')({...req,headers:req.headers,method:'GET',body:undefined,query:{account:'personal',...query}},res);
  if(status!==200||data?.connected!==true)throw Error('MAIL_UNAVAILABLE');return data;
 };
 const latest=await invoke(previous?{reviewCheckIds:JSON.stringify(require('../attention/mail-reconcile.cjs').selectChecks(previous,'microsoft',[]).ids)}:{});
 return require('../attention/mail-discovery.cjs').discover(previous,'personal-inbox-review',latest,async cursor=>{
  if(!/^\d{1,12}$/.test(cursor))throw Error('INVALID_MAIL_CURSOR');
  return invoke({cursor});
 },new Date().toISOString());
}});
module.exports.createHandler=createHandler;
module.exports.command=command;
