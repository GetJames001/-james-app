'use strict';
const {privateNoStore,configuredIdentity}=require('../lib/auth.js');
const {parseScheduleEvent}=require('@vercel/schedules');
const {createScheduleProof}=require('../lib/task-execution/schedule-transport.cjs');

// PRIVATE FUNCTION ONLY: no public gateway route. SDK parsing validates format,
// not caller identity. Vercel's private trigger is the authentication boundary.
function createHandler({service=()=>createScheduleProof({owner:configuredIdentity()})}={}){
 return async(req,res)=>{
  privateNoStore(res);let proof;
  try{proof=service();}catch{return res.status(503).json({error:'HOSTED_PROOF_DISABLED'});}
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  let metadata;
  try{
   if(req.body!==undefined&&req.body!==null&&req.body!==''&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length))throw Error();
   const headers=new Headers();
   for(const [key,value] of Object.entries(req.headers||{}))if(key.toLowerCase().startsWith('ce-')){
    if(typeof value!=='string'||value.length>512)throw Error();headers.set(key,value);
   }
   metadata=await parseScheduleEvent(new Request('https://private.invalid/',{method:'POST',headers}));
  }catch{return res.status(400).json({error:'INVALID_SCHEDULE_EVENT'});}
  try{return res.status(200).json(await proof.run(metadata));}
  catch(error){return res.status(['INVALID_SCHEDULE_EVENT','PROOF_WINDOW_CLOSED'].includes(error.code)?400:503).json({error:['INVALID_SCHEDULE_EVENT','PROOF_WINDOW_CLOSED'].includes(error.code)?error.code:'HOSTED_PROOF_UNAVAILABLE'});}
 };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
