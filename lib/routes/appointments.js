'use strict';
const {requireAuth,privateNoStore,configuredIdentity}=require('../auth');
const {createReview}=require('../appointments/core');
const {createGoogle}=require('../appointments/google');
const known=new Set(['APPOINTMENT_DETAILS_REQUIRED','APPOINTMENT_TIMEZONE_REQUIRED','APPOINTMENT_TIME_REQUIRED','REVIEW_EXPIRED','CALENDAR_PERMISSION_REQUIRED','CALENDAR_CREATE_UNAVAILABLE','CALENDAR_SAVE_UNCONFIRMED','CALENDAR_EVENT_CONFLICT']);
function createHandler({authorize=requireAuth,env=process.env,identity=configuredIdentity,fetchImpl=fetch,now=Date.now,googleFactory=createGoogle}={}){
 return async(req,res)=>{
  privateNoStore(res);if(!authorize(req,res,{csrf:req.method==='POST'}))return;
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  const query={...req.query};delete query.path;if(Object.keys(query).length)return res.status(400).json({error:'QUERY_NOT_SUPPORTED'});
  try{
   const owner=identity(),branch=env.VERCEL_ENV==='preview'?'preview:'+env.VERCEL_GIT_COMMIT_REF:'production';
   if(!owner||env.VERCEL_ENV==='preview'&&!env.VERCEL_GIT_COMMIT_REF)throw Error();
   const google=googleFactory({env,owner,fetchImpl});
   if(req.method==='GET')return res.status(200).json({createConnected:Boolean(await google.grant()),confirmationRequired:true});
   if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
   let body;try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(!raw||Buffer.byteLength(raw)>8192)throw Error();body=JSON.parse(raw);if(!body||Array.isArray(body))throw Error();}catch{return res.status(400).json({error:'INVALID_APPOINTMENT_REQUEST'});}
   const review=createReview({secret:env.JAMES_SESSION_SECRET,owner,branch,now});
   if(body.action==='prepare'&&Object.keys(body).sort().join('|')==='action|details')return res.status(200).json(review.prepare(body.details));
   if(body.action==='confirm'&&Object.keys(body).sort().join('|')==='action|reviewToken')return res.status(200).json(await google.create(review.verify(body.reviewToken)));
   return res.status(400).json({error:'INVALID_APPOINTMENT_REQUEST'});
  }catch(error){const safe=known.has(error.message)?error.message:'APPOINTMENT_SERVICE_UNAVAILABLE';return res.status(safe.startsWith('APPOINTMENT_')&&safe!=='APPOINTMENT_SERVICE_UNAVAILABLE'||safe==='REVIEW_EXPIRED'?400:safe==='CALENDAR_PERMISSION_REQUIRED'?409:503).json({error:safe});}
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
