'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const auth=require('../lib/auth.js');
const {googleRefreshTokenKey,DIAGNOSTIC_BRANCH,DIAGNOSTIC_KEY}=require('../lib/google/token-store.js');
const callback=require('../api/google/callback.js'),status=require('../lib/google/status.js'),calendars=require('../lib/google/calendars.js'),events=require('../lib/google/events.js'),connect=require('../api/google/connect.js');
const host='diagnostic.example.vercel.app';
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;},redirect(n,v){this.statusCode=n;this.location=v;return this;}};}
function request(){return {method:'GET',headers:{host,cookie:auth.SESSION_COOKIE+'='+auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)},query:{}};}
const json=data=>({ok:true,status:200,json:async()=>data});
test('default keys remain unchanged; diagnostic branch is Preview-only',()=>{
 for(const env of [{},{VERCEL_ENV:'production'},{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'review/customer-activity-save-20261021'}])assert.equal(googleRefreshTokenKey(env),'google:refresh_token');
 for(const ref of [undefined,'','  '])assert.throws(()=>googleRefreshTokenKey({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:ref}));
 assert.equal(googleRefreshTokenKey({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:DIAGNOSTIC_BRANCH}),DIAGNOSTIC_KEY);
 for(const VERCEL_ENV of ['production','development',undefined])assert.throws(()=>googleRefreshTokenKey({VERCEL_ENV,VERCEL_GIT_COMMIT_REF:DIAGNOSTIC_BRANCH}));
});
test('callback and every diagnostic reader isolate the grant with no fallback or live overwrite',async()=>{
 const before={...process.env},previousFetch=global.fetch;
 Object.assign(process.env,{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:DIAGNOSTIC_BRANCH,VERCEL_BRANCH_URL:host,JAMES_GOOGLE_PREVIEW_CALLBACK_URL:`https://${host}/api/google/callback`,JAMES_AUTH_EMAIL:'isolated@example.test',JAMES_SESSION_SECRET:'isolated-fixture-secret-longer-than-thirty-two-bytes',GOOGLE_CLIENT_ID:'diagnostic-client',GOOGLE_CLIENT_SECRET:'diagnostic-secret',KV_REST_API_URL:'https://synthetic-store.example.test',KV_REST_API_TOKEN:'synthetic-store'});
 const store=new Map([['google:refresh_token','working-grant-must-stay']]),operations=[],refreshes=[];
 global.fetch=async(url,options)=>{
  if(url===process.env.KV_REST_API_URL){const [op,key,value]=JSON.parse(options.body);operations.push({op,key});if(op==='SET'){store.set(key,value);return json({result:'OK'});}return json({result:store.get(key)||null});}
  if(url==='https://oauth2.googleapis.com/token'){if(options.body.get('grant_type')==='authorization_code')return json({refresh_token:'diagnostic-grant'});refreshes.push(options.body.get('refresh_token'));return json({access_token:'synthetic-access'});}
  if(String(url).startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList'))return json({items:[]});
  throw Error('Unexpected provider request');
 };
 try{
  for(const handler of [status,calendars,events]){const out=response();await handler(request(),out);assert.equal(handler===status?out.body.connected:out.statusCode,handler===status?false:401);}
  assert.equal(refreshes.length,0);
  const req=request();req.headers.cookie+='; google_oauth_state=synthetic-state';req.query={state:'synthetic-state',code:'synthetic-code'};
  const saved=response();await callback(req,saved);assert.equal(saved.statusCode,200);
  assert.equal(store.get('google:refresh_token'),'working-grant-must-stay');assert.equal(store.get(DIAGNOSTIC_KEY),'diagnostic-grant');
  for(const handler of [status,calendars,events,events]){const out=response();await handler(request(),out);assert.equal(out.statusCode,200);assert.equal(out.body.connected,true);}
  assert.deepEqual(refreshes,['diagnostic-grant','diagnostic-grant','diagnostic-grant']);assert.ok(operations.every(op=>op.key===DIAGNOSTIC_KEY));
  process.env.VERCEL_ENV='production';const count=operations.length,refreshCount=refreshes.length;
  for(const handler of [connect,callback,status,calendars,events]){const out=response();await handler(req,out);assert.ok(out.statusCode>=400);}
  assert.equal(operations.length,count);assert.equal(refreshes.length,refreshCount);
  process.env.VERCEL_ENV='preview';
  for(const ref of ['', '  ']){process.env.VERCEL_GIT_COMMIT_REF=ref;for(const handler of [connect,callback,status,calendars,events]){const out=response();await handler(req,out);assert.ok(out.statusCode>=400);}}
  delete process.env.VERCEL_GIT_COMMIT_REF;
  for(const handler of [connect,callback,status,calendars,events]){const out=response();await handler(req,out);assert.ok(out.statusCode>=400);}
  assert.equal(operations.length,count);assert.equal(refreshes.length,refreshCount);
  process.env.VERCEL_GIT_COMMIT_REF='review/customer-activity-save-20261021';
  const working=response();await status(request(),working);assert.equal(working.body.connected,true);assert.equal(operations.at(-1).key,'google:refresh_token');assert.equal(store.get('google:refresh_token'),'working-grant-must-stay');
 }finally{global.fetch=previousFetch;for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});
