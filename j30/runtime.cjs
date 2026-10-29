'use strict';
const BRANCH='poc/j30-browserbase-shopping-20261028';
function createRuntime({env,authorize,load}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==BRANCH)return res.status(404).json({ok:false,error:'NOT_FOUND'});
  if(!authorize(req,res,{csrf:req.method!=='GET'}))return;
  if(Object.keys(req.query||{}).some(k=>k!=='path'))return res.status(400).json({ok:false,error:'INVALID_REQUEST'});
  const state={provider:'browserbase',credentialsPresent:Boolean(env.BROWSERBASE_API_KEY&&env.BROWSERBASE_PROJECT_ID),enabled:env.J30_BROWSERBASE_ENABLED==='1',usageApproved:env.J30_BROWSERBASE_USAGE_APPROVED==='1',liveDemoVerified:false};
  if(req.method==='GET'){
   let driverAvailable=false;try{driverAvailable=typeof load('playwright').chromium?.connectOverCDP==='function'}catch{}
   return res.status(200).json({ok:true,...state,driverAvailable});
  }
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  if(!state.enabled||!state.usageApproved)return res.status(503).json({ok:false,error:'J30_EXECUTION_DISABLED'});
  if(!state.credentialsPresent)return res.status(503).json({ok:false,error:'PROVIDER_NOT_CONFIGURED'});
  try{
   const {chromium}=load('playwright');
   const provider=load('./browserbase.cjs').createBrowserbase({apiKey:env.BROWSERBASE_API_KEY,projectId:env.BROWSERBASE_PROJECT_ID,enabled:true,usageApproved:true,maxUsageMinutes:55,connectOverCDP:chromium.connectOverCDP.bind(chromium)});
   const checkpoints=load('./redis-checkpoints.cjs').createRedisBackend({url:env.KV_REST_API_URL,token:env.KV_REST_API_TOKEN});
   const conversationStore=load('../lib/conversation/storage.cjs').createStorage({url:env.KV_REST_API_URL,token:env.KV_REST_API_TOKEN});
   const handler=load('./host.cjs').createHostHandler({authorize,ownerIdentity:load('../lib/auth.js').configuredIdentity,conversationStore,checkpoints,provider,enabled:true});
   return await handler(req,res);
  }catch{return res.status(503).json({ok:false,error:'J30_RUNTIME_UNAVAILABLE'})}
 };
}
// Literal require keeps the CDP client in the hosted function dependency trace.
const loadRuntime=name=>name==='playwright'?require('playwright'):require(name);
module.exports=(req,res)=>createRuntime({env:process.env,authorize:require('../lib/auth.js').requireAuth,load:loadRuntime})(req,res);
module.exports.createRuntime=createRuntime;
