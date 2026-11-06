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
function createHandlers({authorize=requireAuth,fetchImpl=(...args)=>fetch(...args),env=process.env,identity=configuredIdentity}={}){
 async function read(url,options){const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});const data=await boundedJson(response);if(!response.ok)throw Error('PROVIDER_UNAVAILABLE');return data;}
 async function connect(req,res){
  privateNoStore(res);if(!authorize(req,res,{csrf:req.method==='POST'}))return;
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).send('Use Enable Gmail reading inside James.');}
  let redirect;try{redirect=googleRedirectUri(req,env);tokenKey(env,identity());if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)throw Error();}catch{return res.status(503).send('Open the configured James branch preview. Existing Google configuration must be checked before connecting Gmail.');}
  const state='gmail-'+crypto.randomBytes(24).toString('hex');
  res.setHeader('Set-Cookie',`${COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  const query=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent select_account',include_granted_scopes:'true',state});
  return res.redirect(303,'https://accounts.google.com/o/oauth2/v2/auth?'+query);
 }
 async function callback(req,res){
  privateNoStore(res);if(!authorize(req,res))return;
  if(req.method!=='GET')return res.status(405).send('Method not allowed.');
  const state=req.query?.state,cookies=Object.fromEntries(String(req.headers?.cookie||'').split(';').map(x=>x.trim().split('=')));
  if(typeof state!=='string'||!/^gmail-[a-f0-9]{48}$/.test(state)||cookies[COOKIE]!==state)return res.status(400).send('Invalid Gmail authorization state.');
  res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  if(req.query.error||typeof req.query.code!=='string'||!req.query.code)return res.status(400).send('Gmail permission was not completed. Existing Calendar access is unchanged.');
  let stage='configuration';
  try{
   const redirect=googleRedirectUri(req,env),key=tokenKey(env,identity());stage='permission_exchange';
   const token=await read('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:req.query.code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:redirect,grant_type:'authorization_code'})});
   if(typeof token.refresh_token!=='string'||!token.refresh_token||typeof token.access_token!=='string'||!String(token.scope||'').split(/\s+/).includes(SCOPE))throw Error();
   stage='gmail_verification';const profile=await read('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+token.access_token}});
   if(typeof profile.emailAddress!=='string'||!/^\S+@\S+$/.test(profile.emailAddress))throw Error();
   stage='save_connection';const saved=await read(env.KV_REST_API_URL,{method:'POST',headers:{Authorization:'Bearer '+env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(['SET',key,JSON.stringify({refreshToken:token.refresh_token,email:profile.emailAddress,scope:SCOPE,connectedAt:new Date().toISOString()})])});
   if(saved.error||saved.result!=='OK')throw Error();
   res.setHeader('Content-Type','text/html; charset=utf-8');
   return res.status(200).send('<!doctype html><title>James Gmail reading connected</title><h1>Gmail reading connected.</h1><p>Hotmail remains your primary sending address. Gmail sending was not requested. Existing Calendar credentials were not replaced.</p><p>You can close this window. Mail review integration is the next step; this permission step does not start a full mailbox scan.</p>');
  }catch{return res.status(503).send('Gmail reading could not be connected at '+stage+'. No Calendar token was overwritten. If Gmail verification failed, check Gmail API access in the existing Google project.');}
 }
 return {connect,callback};
}
const handlers=createHandlers();module.exports={...handlers,createHandlers,tokenKey,SCOPE,COOKIE};
