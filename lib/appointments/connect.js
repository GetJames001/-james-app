'use strict';
const crypto=require('node:crypto');
const {requireAuth,privateNoStore,configuredIdentity}=require('../auth');
const {googleRedirectUri}=require('../google/oauth-redirect');
const {googleRefreshTokenKey}=require('../google/token-store');
const {SCOPE,grantKey,createGoogle}=require('./google');
const COOKIE='__Host-james_calendar_create_state';
function createHandlers({authorize=requireAuth,env=process.env,identity=configuredIdentity,fetchImpl=fetch}={}){
 const client=()=>createGoogle({env,owner:identity(),fetchImpl});
 async function connect(req,res){
  privateNoStore(res);if(!authorize(req,res,{csrf:true}))return;
  if(req.method!=='POST')return res.status(405).send('Use Enable appointment saving inside James.');
  try{
   const redirect=googleRedirectUri(req,env);grantKey(env,identity());if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)throw Error();
   const state='appointment-'+crypto.randomBytes(24).toString('hex');res.setHeader('Set-Cookie',`${COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
   const query=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:SCOPE+' https://www.googleapis.com/auth/calendar.readonly',access_type:'offline',prompt:'consent select_account',include_granted_scopes:'true',state});
   return res.status(200).json({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?'+query});
  }catch{return res.status(503).json({error:'CALENDAR_CREATE_CONFIGURATION_UNAVAILABLE'});}
 }
 async function callback(req,res){
  privateNoStore(res);if(!authorize(req,res))return;if(req.method!=='GET')return res.status(405).send('Method not allowed.');
  const state=req.query?.state,cookies=Object.fromEntries(String(req.headers?.cookie||'').split(';').map(x=>x.trim().split('=')));
  if(typeof state!=='string'||!/^appointment-[a-f0-9]{48}$/.test(state)||cookies[COOKIE]!==state)return res.status(400).send('Appointment saving was not connected: invalid or expired state. Start a fresh connection inside James. Existing Calendar reading is unchanged.');
  res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  if(req.query.error||typeof req.query.code!=='string'||!req.query.code)return res.status(400).send('Appointment saving permission was not completed. Existing Calendar reading is unchanged.');
  let stage='permission_exchange';
  try{
   const google=client(),redirect=googleRedirectUri(req,env),key=grantKey(env,identity());
   const {response,data:token}=await google.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:req.query.code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:redirect,grant_type:'authorization_code'})});
   if(!response.ok||typeof token.refresh_token!=='string'||!token.refresh_token||typeof token.access_token!=='string'||!String(token.scope||'').split(/\s+/).includes(SCOPE))throw Error();
   stage='calendar_verification';const calendarId=await google.primary(token.access_token);
   const existingRefresh=await google.kv(['GET',googleRefreshTokenKey(env)]);if(typeof existingRefresh!=='string'||!existingRefresh)throw Error();
   const existing=await google.refresh(existingRefresh);if(await google.primary(existing.access_token)!==calendarId)throw Error();
   stage='save_permission';const saved=await google.kv(['SET',key,JSON.stringify({refreshToken:token.refresh_token,calendarId,scope:SCOPE,connectedAt:new Date().toISOString()})]);if(saved!=='OK')throw Error();
   res.setHeader('Content-Type','text/html; charset=utf-8');return res.status(200).send('<!doctype html><title>James appointment saving connected</title><h1>Appointment saving connected.</h1><p>James can create appointments after you review and confirm them. Existing Calendar reading and Gmail credentials were not replaced.</p><p><a href="/">Return to James</a> and ask James to prepare your appointment. No appointment was created by this permission step.</p>');
  }catch{return res.status(503).send('Appointment saving could not be connected at '+stage+'. Existing Calendar reading is unchanged. Start a fresh connection from James; do not refresh this callback.');}
 }
 return {connect,callback};
}
module.exports={...createHandlers(),createHandlers,COOKIE};
