'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandlers,tokenKey,SCOPE,COOKIE}=require('../lib/google/gmail-connect.js');
const host='james-fixture.vercel.app',env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'fixture',VERCEL_BRANCH_URL:host,JAMES_GOOGLE_PREVIEW_CALLBACK_URL:'https://'+host+'/api/google/callback',GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',KV_REST_API_URL:'https://store.invalid',KV_REST_API_TOKEN:'synthetic-store'};
const response=()=>({headers:{},code:200,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;},redirect(n,v){this.code=n;this.location=v;return this;}});
function fixture({scope=SCOPE,profile=true,saved='OK',authorized=true}={}){const calls=[];const handlers=createHandlers({env,identity:()=> 'owner',authorize:(req,res)=>{if(authorized)return true;res.status(401).send('Unauthorized');return false;},fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(calls.length===1?{access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope}:calls.length===2?profile?{emailAddress:'owner@example.test'}:{}:{result:saved});}});return {...handlers,calls};}
async function start(f){const res=response();await f.connect({method:'POST',headers:{host},query:{}},res);return res;}
test('consent uses existing client/callback, read-only Gmail scope and no provider calls',async()=>{
 const f=fixture(),r=await start(f),url=new URL(r.location);assert.equal(r.code,303);assert.equal(url.searchParams.get('client_id'),env.GOOGLE_CLIENT_ID);assert.equal(url.searchParams.get('redirect_uri'),env.JAMES_GOOGLE_PREVIEW_CALLBACK_URL);assert.equal(url.searchParams.get('scope'),SCOPE);assert.equal(url.searchParams.get('include_granted_scopes'),'true');assert.match(r.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);assert.equal(f.calls.length,0);
});
test('callback saves Gmail permission separately and never overwrites Calendar grant',async()=>{
 const f=fixture(),startResponse=await start(f),state=new URL(startResponse.location).searchParams.get('state'),r=response();await f.callback({method:'GET',headers:{host,cookie:COOKIE+'='+state},query:{code:'synthetic-code',state}},r);
 assert.equal(r.code,200);assert.equal(f.calls.length,3);const command=JSON.parse(f.calls[2].options.body);assert.equal(command[0],'SET');assert.equal(command[1],tokenKey(env,'owner'));assert.match(command[1],/^james:gmail-read:v1:/);assert.doesNotMatch(command[1],/google:.*refresh_token/);assert.doesNotMatch(r.body,/synthetic-access|synthetic-refresh|synthetic-secret/);
});
test('wrong state, denied access and rejected read scope cannot save any grant',async()=>{
 for(const kind of ['state','denied','scope','profile','store']){const f=fixture({scope:kind==='scope'?'https://www.googleapis.com/auth/calendar.readonly':SCOPE,profile:kind!=='profile',saved:kind==='store'?'NO':'OK'}),s=await start(f),state=new URL(s.location).searchParams.get('state'),r=response();await f.callback({method:'GET',headers:{host,cookie:COOKIE+'='+state},query:{state:kind==='state'?'wrong':state,code:'synthetic-code',...(kind==='denied'?{error:'access_denied'}:{})}},r);assert.ok([400,503].includes(r.code));if(['state','denied'].includes(kind))assert.equal(f.calls.length,0);if(kind==='scope')assert.equal(f.calls.length,1);if(kind==='profile')assert.equal(f.calls.length,2);}
});
test('authentication, POST initiation and preview callback configuration are required',async()=>{
 const f=fixture({authorized:false}),r=await start(f);assert.equal(r.code,401);assert.equal(f.calls.length,0);
 const g=fixture(),get=response();await g.connect({method:'GET',headers:{host}},get);assert.equal(get.code,405);assert.equal(g.calls.length,0);
 assert.throws(()=>tokenKey({...env,VERCEL_GIT_COMMIT_REF:''},'owner'),/BRANCH/);assert.notEqual(tokenKey(env,'owner'),tokenKey({...env,VERCEL_GIT_COMMIT_REF:'other'},'owner'));assert.notEqual(tokenKey(env,'owner'),tokenKey(env,'other-owner'));
});

test('JSON initiation returns an authorization URL without a cross-origin fetch redirect',async()=>{
 const f=fixture(),r=response();await f.connect({method:'POST',headers:{host,accept:'application/json'}},r);
 assert.equal(r.code,200);assert.equal(r.location,undefined);assert.equal(new URL(r.body.authorizationUrl).origin,'https://accounts.google.com');assert.match(r.headers['Set-Cookie'],/gmail-/);
});
test('real auth keeps missing and foreign Origin POSTs forbidden',async()=>{
 const auth=require('../lib/auth.js');
 const prior={};for(const [key,value] of Object.entries({JAMES_AUTH_EMAIL:'fixture@example.test',JAMES_SESSION_SECRET:'synthetic-session-secret-at-least-32-characters',JAMES_ALLOWED_HOSTS:host})){prior[key]=process.env[key];process.env[key]=value;}
 try{
  const cookie=auth.SESSION_COOKIE+'='+auth.createSessionToken('fixture@example.test');
  const f=createHandlers({env,identity:()=> 'owner'});
  for(const origin of [undefined,'null','https://foreign.invalid','https://'+host]){
   const r=response();await f.connect({method:'POST',headers:{host,cookie,accept:'application/json',...(origin?{origin}:{})}},r);
   assert.equal(r.code,origin==='https://'+host?200:403);
  }
 }finally{for(const [key,value] of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('client uses same-origin fetch POST, navigates only to Google, and handles failure',async()=>{
 const {connectGmail}=require('../mail-attention.js');
 for(const kind of ['ok','forbidden','unsafe']){
  const button={disabled:false},status={textContent:''},form={querySelector:s=>s==='button'?button:status};let destination=null;
  await connectGmail(form,{fetchImpl:async(path,options)=>{
   assert.equal(path,'/api/google/gmail/connect');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.headers.Accept,'application/json');
   return {ok:kind!=='forbidden',json:async()=>({authorizationUrl:kind==='unsafe'?'https://foreign.invalid/':'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic'})};
  },navigate:url=>{destination=url;}});
  if(kind==='ok'){assert.match(destination,/^https:\/\/accounts.google.com/);assert.equal(button.disabled,true);}else{assert.equal(destination,null);assert.equal(button.disabled,false);assert.match(status.textContent,/could not open/);}
 }
});
