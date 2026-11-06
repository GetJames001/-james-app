'use strict';
const crypto=require('node:crypto');
const {boundedJson}=require('../attention/storage-response.cjs');
const SCOPE='https://www.googleapis.com/auth/calendar.events.owned';
function grantKey(env,owner){if(!owner||env.VERCEL_ENV==='preview'&&!env.VERCEL_GIT_COMMIT_REF)throw Error('CONFIGURATION_UNAVAILABLE');return 'james:calendar-create:v1:'+crypto.createHash('sha256').update(JSON.stringify([env.VERCEL_ENV==='preview'?'preview:'+env.VERCEL_GIT_COMMIT_REF:'production',owner])).digest('hex');}
function createGoogle({env=process.env,owner,fetchImpl=fetch}={}){
 async function request(url,options={}){const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});const data=await boundedJson(response);return {response,data};}
 async function kv(command){if(!env.KV_REST_API_URL||!env.KV_REST_API_TOKEN)throw Error('STORAGE_UNAVAILABLE');const {response,data}=await request(env.KV_REST_API_URL,{method:'POST',headers:{Authorization:'Bearer '+env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(command)});if(!response.ok||data.error||!Object.hasOwn(data,'result'))throw Error('STORAGE_UNAVAILABLE');return data.result;}
 async function refresh(refreshToken){const {response,data}=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:refreshToken,grant_type:'refresh_token'})});if(!response.ok||typeof data.access_token!=='string'||!data.access_token)throw Error('CALENDAR_PERMISSION_REQUIRED');return data;}
 async function grant(){const raw=await kv(['GET',grantKey(env,owner)]);if(raw===null)return null;if(typeof raw!=='string'||raw.length>16384)throw Error('CALENDAR_PERMISSION_REQUIRED');const data=JSON.parse(raw);if(data.scope!==SCOPE||typeof data.refreshToken!=='string'||!data.refreshToken||typeof data.calendarId!=='string'||data.calendarId.length>300)throw Error('CALENDAR_PERMISSION_REQUIRED');return data;}
 async function primary(accessToken){const {response,data}=await request('https://www.googleapis.com/calendar/v3/calendars/primary',{headers:{Authorization:'Bearer '+accessToken}});if(!response.ok||typeof data.id!=='string'||!data.id||data.id.length>300)throw Error('CALENDAR_VERIFICATION_FAILED');return data.id;}
 async function create({details,eventId}){
  const saved=await grant();if(!saved)throw Error('CALENDAR_PERMISSION_REQUIRED');const token=await refresh(saved.refreshToken);
  if(typeof token.scope==='string'&&!token.scope.split(/\s+/).includes(SCOPE)&&!token.scope.split(/\s+/).includes('https://www.googleapis.com/auth/calendar'))throw Error('CALENDAR_PERMISSION_REQUIRED');
  const base='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(saved.calendarId)+'/events',headers={Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'};
  const matches=e=>e?.id===eventId&&e.status!=='cancelled'&&e.summary===details.title&&e.location===details.location&&Date.parse(e.start?.dateTime)===Date.parse(details.start)&&Date.parse(e.end?.dateTime)===Date.parse(details.end);
  const publicResult=e=>({status:'created',event:{id:e.id,title:e.summary,location:e.location,start:e.start.dateTime,end:e.end.dateTime,timeZone:details.timeZone},calendarChanged:true});
  const previous=await request(base+'/'+eventId,{headers});
  if(previous.response.ok){if(!matches(previous.data))throw Error('CALENDAR_EVENT_CONFLICT');return publicResult(previous.data);}
  if(previous.response.status!==404)throw Error('CALENDAR_CREATE_UNAVAILABLE');
  const event={id:eventId,summary:details.title,location:details.location,start:{dateTime:details.start,timeZone:details.timeZone},end:{dateTime:details.end,timeZone:details.timeZone}};
  let inserted;try{inserted=await request(base+'?sendUpdates=none',{method:'POST',headers,body:JSON.stringify(event)});}catch{throw Error('CALENDAR_SAVE_UNCONFIRMED');}
  if(inserted.response.status===409){const existing=await request(base+'/'+eventId,{headers});if(existing.response.ok&&matches(existing.data))return publicResult(existing.data);throw Error('CALENDAR_EVENT_CONFLICT');}
  if(!inserted.response.ok)throw Error('CALENDAR_CREATE_UNAVAILABLE');if(!matches(inserted.data))throw Error('CALENDAR_SAVE_UNCONFIRMED');return publicResult(inserted.data);
 }
 return {request,kv,refresh,primary,grant,create};
}
module.exports={SCOPE,grantKey,createGoogle};
