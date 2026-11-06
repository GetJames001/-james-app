'use strict';
const {requireAuth,privateNoStore}=require('../auth.js');
const {googleRefreshTokenKey}=require('./token-store.js');
const {boundedJson}=require('../attention/storage-response.cjs');
function createHandler({authorize=requireAuth,fetchImpl=(...args)=>fetch(...args),env=process.env}={}){
 return async(req,res)=>{
  privateNoStore(res);if(!authorize(req,res))return;
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  const query={...req.query};delete query.path;if(Object.keys(query).length)return res.status(400).json({error:'QUERY_NOT_SUPPORTED'});
  let stage='configuration';
  try{
   const key=googleRefreshTokenKey(env);
   if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)throw Error();
   stage='saved_connection';
   const stored=await fetchImpl(env.KV_REST_API_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),headers:{Authorization:'Bearer '+env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(['GET',key])});
   const data=await boundedJson(stored);if(!stored.ok||data.error||!Object.hasOwn(data,'result'))throw Error();
   if(data.result===null)return res.status(200).json({connected:false,calendarRead:'not_connected',gmailRead:'not_connected',gmailSend:'not_checked'});
   if(typeof data.result!=='string'||!data.result)throw Error();
   stage='token_refresh';
   const refreshed=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:data.result,grant_type:'refresh_token'})});
   const token=await boundedJson(refreshed);if(!refreshed.ok||typeof token.access_token!=='string'||!token.access_token)throw Error();
   const scopes=typeof token.scope==='string'?new Set(token.scope.split(/\s+/)):null;
   const granted=names=>scopes?names.some(name=>scopes.has(name))?'granted':'not_granted':'unknown';
   return res.status(200).json({connected:true,calendarRead:granted(['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.events.readonly']),gmailRead:granted(['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/']),gmailSend:'not_checked',scopeEvidence:scopes?'provider_refresh_response':'not_returned',source:'existing_james_google_connection'});
  }catch{return res.status(503).json({error:'GOOGLE_ACCESS_CHECK_UNAVAILABLE',stage});}
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
