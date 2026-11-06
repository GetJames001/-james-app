'use strict';
const crypto=require('node:crypto');
const {requireAuth,privateNoStore,configuredIdentity}=require('../auth.js');
const {googleRedirectUri}=require('./oauth-redirect.js');
const {boundedJson}=require('../attention/storage-response.cjs');
const SCOPE='https://www.googleapis.com/auth/gmail.readonly',COOKIE='__Host-james_gmail_state';
function tokenKey(env=process.env,owner=configuredIdentity()){
 if(!owner)throw Error('OWNER_REQUIRED');
 if(env.VERCEL_ENV==='preview'&&!env.VERCEL_GIT_COMMIT_REF)throw Error('BRANCH_REQUIRED');
 return 'james:gmail-read:v1:'+crypto.createHash('sha256').update(JSON.stringify([env.VERCEL_ENV==='preview'?'preview:'+env.VERCEL_GIT_COMMIT_REF:'production',owner])).digest('hex');
}
// Never include provider messages, descriptions, URLs or exception objects in diagnostics.
const PROVIDER_REASONS=new Set(['invalid_client','invalid_grant','invalid_request','invalid_scope','unauthorized_client','access_denied','temporarily_unavailable','server_error','SERVICE_DISABLED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','RATE_LIMIT_EXCEEDED','QUOTA_EXCEEDED','accessNotConfigured','insufficientPermissions','authError','forbidden','rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','backendError']);
function allowedReason(data){
 const error=data?.error;
 const candidates=[typeof error==='string'?error:null,...(Array.isArray(error?.errors)?error.errors.slice(0,20).map(item=>item?.reason):[]),...(Array.isArray(error?.details)?error.details.slice(0,20).map(item=>item?.reason):[])];
 return candidates.find(value=>typeof value==='string'&&PROVIDER_REASONS.has(value))||null;
}
class ConnectionFailure extends Error{
 constructor(reason,httpStatus=null,providerReason=null){super(reason);this.reason=reason;this.httpStatus=httpStatus;this.providerReason=providerReason;}
}
function createHandlers({authorize=requireAuth,fetchImpl=(...args)=>fetch(...args),env=process.env,identity=configuredIdentity,logger=entry=>console.warn('JAMES_GMAIL_CONNECT_FAILED',entry)}={}){
 function fail(res,status,stage,error){
  const known=error instanceof ConnectionFailure;
  const diagnostic={diagnosticId:crypto.randomBytes(8).toString('hex'),stage,httpStatus:known?error.httpStatus:null,providerReason:known?error.providerReason:null,reason:known?error.reason:'unexpected_failure'};
  try{logger(diagnostic);}catch{} // Diagnostics must not change the authorization outcome.
  res.setHeader('X-James-Gmail-Diagnostic',diagnostic.diagnosticId);
  return res.status(status).send('Gmail reading could not be connected at '+stage+'. HTTP status: '+(diagnostic.httpStatus??'unavailable')+'. Provider reason: '+(diagnostic.providerReason||'not supplied or not allowlisted')+'. Reason: '+diagnostic.reason+'. Diagnostic: '+diagnostic.diagnosticId+'. Existing Calendar access is unchanged. Start a fresh connection from James; do not refresh this callback page.');
 }
 async function read(url,options,{provider=true}={}){
  let response;
  try{response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});}catch(error){throw new ConnectionFailure(['AbortError','TimeoutError'].includes(error?.name)?'request_timeout':'network_failure');}
  const status=Number.isInteger(response.status)&&response.status>=100&&response.status<=599?response.status:null;
  let data;try{data=await boundedJson(response);}catch{throw new ConnectionFailure('invalid_response',status);}
  if(!response.ok)throw new ConnectionFailure('http_failure',status,provider?allowedReason(data):null);
  return {data,status};
 }
 async function connect(req,res){
  privateNoStore(res);if(!authorize(req,res,{csrf:req.method==='POST'}))return;
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).send('Use Enable Gmail reading inside James.');}
  let redirect;try{redirect=googleRedirectUri(req,env);tokenKey(env,identity());if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)throw Error();}catch{return fail(res,503,'configuration',new ConnectionFailure('configuration_invalid'));}
  const state='gmail-'+crypto.randomBytes(24).toString('hex');
  res.setHeader('Set-Cookie',`${COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  const query=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent select_account',include_granted_scopes:'true',state});
  const authorizationUrl='https://accounts.google.com/o/oauth2/v2/auth?'+query;
  if(req.headers?.accept==='application/json')return res.status(200).json({authorizationUrl});
  return res.redirect(303,authorizationUrl);
 }
 async function callback(req,res){
  privateNoStore(res);if(!authorize(req,res))return;
  if(req.method!=='GET')return res.status(405).send('Method not allowed.');
  const state=req.query?.state,cookies=Object.fromEntries(String(req.headers?.cookie||'').split(';').map(x=>x.trim().split('=')));
  if(typeof state!=='string'||!/^gmail-[a-f0-9]{48}$/.test(state)||cookies[COOKIE]!==state)return fail(res,400,'state_validation',new ConnectionFailure('invalid_state'));
  res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  if(req.query.error||typeof req.query.code!=='string'||!req.query.code)return fail(res,400,'permission_response',new ConnectionFailure(req.query.error?'permission_not_completed':'missing_code',null,allowedReason({error:req.query.error})));
  let stage='configuration';
  try{
   const redirect=googleRedirectUri(req,env),key=tokenKey(env,identity());
   if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.KV_REST_API_URL||!env.KV_REST_API_TOKEN)throw new ConnectionFailure('configuration_invalid');
   stage='permission_exchange';
   const tokenResponse=await read('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:req.query.code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:redirect,grant_type:'authorization_code'})});
   const token=tokenResponse.data;
   if(typeof token?.refresh_token!=='string'||!token.refresh_token)throw new ConnectionFailure('missing_refresh_token',tokenResponse.status);
   if(typeof token.access_token!=='string'||!token.access_token)throw new ConnectionFailure('missing_access_token',tokenResponse.status);
   if(!String(token.scope||'').split(/\s+/).includes(SCOPE))throw new ConnectionFailure('required_scope_missing',tokenResponse.status);
   stage='gmail_verification';const profileResponse=await read('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+token.access_token}});
   const profile=profileResponse.data;
   if(typeof profile?.emailAddress!=='string'||!/^\S+@\S+$/.test(profile.emailAddress))throw new ConnectionFailure('invalid_profile',profileResponse.status);
   stage='save_connection';const savedResponse=await read(env.KV_REST_API_URL,{method:'POST',headers:{Authorization:'Bearer '+env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(['SET',key,JSON.stringify({refreshToken:token.refresh_token,email:profile.emailAddress,scope:SCOPE,connectedAt:new Date().toISOString()})])},{provider:false});
   const saved=savedResponse.data;
   if(saved?.error||saved?.result!=='OK')throw new ConnectionFailure('storage_rejected',savedResponse.status);
   res.setHeader('Content-Type','text/html; charset=utf-8');
   return res.status(200).send('<!doctype html><title>James Gmail reading connected</title><h1>Gmail reading connected.</h1><p>Hotmail remains your primary sending address. Gmail sending was not requested. Existing Calendar credentials were not replaced.</p><p>You can close this window. Mail review integration is the next step; this permission step does not start a full mailbox scan.</p>');
  }catch(error){return fail(res,503,stage,stage==='configuration'&&!(error instanceof ConnectionFailure)?new ConnectionFailure('configuration_invalid'):error);}
 }
 return {connect,callback};
}
const handlers=createHandlers();module.exports={...handlers,createHandlers,tokenKey,SCOPE,COOKIE};
