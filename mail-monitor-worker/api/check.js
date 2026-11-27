'use strict';
const crypto=require('node:crypto');
const ORIGIN='https://james-app-git-fix-calendar-refresh-diagnosis-fe3b3a-james-cb7a.vercel.app';
const QA_HOST='james-isolated-qa-1bd8f93-git-release-builder-abd811-james-cb7a.vercel.app';
const PATH='/api/attention/background-scan';
function createHandler({env=process.env,fetchImpl=(...args)=>fetch(...args),now=()=>Date.now()}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  const expected=env.CRON_SECRET,actual=req.headers?.authorization;
  if(typeof expected!=='string'||expected.length<32||typeof actual!=='string'||actual.length>1024||!crypto.timingSafeEqual(crypto.createHash('sha256').update(actual).digest(),crypto.createHash('sha256').update('Bearer '+expected).digest()))return res.status(401).json({error:'UNAUTHORIZED'});
  try{
   const scope=env.JAMES_MAIL_WORKER_SCOPE;
   if(scope&&scope!=='everyday'&&scope!=='travel-qa')throw Error();
   const host=scope==='travel-qa'?QA_HOST:null;
   const origin=host?'https://'+host:ORIGIN;
   if(typeof env.JAMES_MAIL_WORKER_PRIVATE_KEY!=='string'||env.JAMES_MAIL_WORKER_PRIVATE_KEY.length>4096)throw Error();
   const key=crypto.createPrivateKey(env.JAMES_MAIL_WORKER_PRIVATE_KEY);if(key.asymmetricKeyType!=='ed25519')throw Error();
   const time=String(Math.floor(now()/1000)),nonce=crypto.randomBytes(32).toString('hex'),signature=crypto.sign(null,Buffer.from(['POST',PATH,time,nonce,...(host?[host]:[])].join('\n')),key).toString('base64url');
   const response=await fetchImpl(origin+PATH,{method:'POST',redirect:'error',signal:AbortSignal.timeout(110000),headers:{authorization:'JamesWorker '+signature,'x-james-worker-time':time,'x-james-worker-nonce':nonce,'content-type':'application/json'},body:'{}'});
   if(response.status===202){
    const result=await response.json();
    if(result?.skipped!=='already_running')throw Error();
    return res.status(200).json({ok:true,skipped:true});
   }
   if(!response.ok)throw Error();const result=await response.json();if(result.ok!==true)throw Error();return res.status(200).json({ok:true,partial:result.partial===true});
  }catch{return res.status(503).json({error:'BACKGROUND_REVIEW_UNAVAILABLE'});}
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
