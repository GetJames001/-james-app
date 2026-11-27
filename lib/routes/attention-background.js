'use strict';
// Approval-gated machine access to one existing Preview collector. Not a public
// mailbox API and not active merely because this file is deployed.
const crypto=require('node:crypto');
const {privateNoStore,configuredIdentity,createSessionToken,SESSION_COOKIE}=require('../auth.js');
const BRANCH='fix/calendar-refresh-diagnosis-20261031';
const HOST='james-app-git-fix-calendar-refresh-diagnosis-fe3b3a-james-cb7a.vercel.app';
const QA_HOST='james-isolated-qa-1bd8f93-git-release-builder-abd811-james-cb7a.vercel.app';
const QA_BRANCH='release/builder9-completion';
const QA_PROJECT='prj_xV5D6jff7kSCiL5UYDpO88J7NefH';
const PATH='/api/attention/background-scan';
const canonical=(time,nonce,host)=>['POST',PATH,time,nonce,...(host?[host]:[])].join('\n');
function scopeFor(env,host){
 if(env.JAMES_MAIL_BACKGROUND_ENABLED!=='true'||env.VERCEL_ENV!=='preview')return null;
 if(env.JAMES_MAIL_BACKGROUND_SCOPE==='travel-qa'){
  // The opt-in QA receiver may never point at the everyday project/database.
  if(env.VERCEL_PROJECT_ID!==QA_PROJECT||env.VERCEL_GIT_COMMIT_REF!==QA_BRANCH||
     env.VERCEL_BRANCH_URL!==QA_HOST||host!==QA_HOST||
     !require('../travel/qa-replay-reader.cjs').qaConfiguration(env))return null;
  return {branch:QA_BRANCH,host:QA_HOST,signatureHost:QA_HOST};
 }
 if(env.JAMES_MAIL_BACKGROUND_SCOPE&&env.JAMES_MAIL_BACKGROUND_SCOPE!=='everyday')return null;
 return env.VERCEL_GIT_COMMIT_REF===BRANCH&&env.VERCEL_BRANCH_URL===HOST&&host===HOST?{branch:BRANCH,host:HOST}:null;
}
const RELEASE="if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
async function invokeScan(req,scan=require('./attention-scan.js')){
 const cookie=SESSION_COOKIE+'='+createSessionToken(configuredIdentity(),{ttl:60});
 let status=500,result;
 const response={setHeader(){},status(value){status=value;return this;},json(value){result=value;return this;},end(){return this;}};
 const host=req.headers.host;
 await scan({method:'POST',headers:{host,origin:'https://'+host,'content-type':'application/json',cookie},query:{},body:{}},response);
 if(status!==200||result?.saved!==true)throw Error('SCAN_UNAVAILABLE');
 return {partial:result.partial===true,revision:Number.isSafeInteger(result.revision)?result.revision:null};
}
function createHandler({env=process.env,identity=configuredIdentity,command=require('./attention-scan.js').command,run=invokeScan,now=()=>Date.now(),log=record=>console.info('JAMES_BACKGROUND_MAIL_SCAN',record)}={}){
 return async(req,res)=>{
  privateNoStore(res);
  const scope=scopeFor(env,req.headers?.host);
  if(!scope)return res.status(404).json({error:'NOT_ENABLED'});
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  const time=req.headers?.['x-james-worker-time'],nonce=req.headers?.['x-james-worker-nonce'],authorization=req.headers?.authorization;
  if(typeof time!=='string'||!/^\d{10}$/.test(time)||Math.abs(Math.floor(now()/1000)-Number(time))>60||typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce)||typeof authorization!=='string'||!/^JamesWorker [A-Za-z0-9_-]{86}$/.test(authorization))return res.status(401).json({error:'UNAUTHORIZED'});
  try{if(typeof env.JAMES_MAIL_WORKER_PUBLIC_KEY!=='string'||env.JAMES_MAIL_WORKER_PUBLIC_KEY.length>4096)throw Error();const key=crypto.createPublicKey(env.JAMES_MAIL_WORKER_PUBLIC_KEY);if(key.asymmetricKeyType!=='ed25519'||!crypto.verify(null,Buffer.from(canonical(time,nonce,scope.signatureHost)),key,Buffer.from(authorization.slice(12),'base64url')))throw Error();}catch{return res.status(401).json({error:'UNAUTHORIZED'});}
  const query={...req.query};delete query.path;
  let body;try{if(typeof req.body==='string'&&Buffer.byteLength(req.body)>512)throw Error();body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).json({error:'INVALID_REQUEST'});}
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||'')||Object.keys(query).length||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)return res.status(400).json({error:'INVALID_REQUEST'});
  const owner=identity();if(!owner)return res.status(503).json({error:'UNAVAILABLE'});
  const ownerKey=crypto.createHash('sha256').update(JSON.stringify([scope.branch,owner])).digest('hex'),lock='james:mail-worker:lock:v1:'+ownerKey;
  let locked=false;
  try{
   const replay=await command(['SET','james:mail-worker:nonce:v1:'+ownerKey+':'+nonce,'1','NX','EX','180']);
   if(replay===null)return res.status(409).json({error:'REPLAY_REJECTED'});if(replay!=='OK')throw Error();
   const lease=await command(['SET',lock,nonce,'NX','EX','180']);if(lease===null)return res.status(202).json({skipped:'already_running'});if(lease!=='OK')throw Error();locked=true;
   const result=await run(req);try{log({status:result.partial?'partial':'checked'});}catch{}
   return res.status(200).json({ok:true,partial:result.partial===true});
  }catch{try{log({status:'failed'});}catch{}return res.status(503).json({error:'BACKGROUND_REVIEW_UNAVAILABLE'});}
  finally{if(locked)try{await command(['EVAL',RELEASE,'1',lock,nonce]);}catch{}}
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;module.exports.canonical=canonical;module.exports.HOST=HOST;module.exports.PATH=PATH;
module.exports.QA_HOST=QA_HOST;module.exports.scopeFor=scopeFor;
module.exports.invokeScan=invokeScan;
