'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandlers,SCOPE,COOKIE,tokenKey}=require('../lib/google/gmail-connect.js');
const host='diagnostic-fixture.vercel.app',env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'fixture',VERCEL_BRANCH_URL:host,JAMES_GOOGLE_PREVIEW_CALLBACK_URL:'https://'+host+'/api/google/callback',GOOGLE_CLIENT_ID:'secret-client-canary',GOOGLE_CLIENT_SECRET:'secret-client-secret-canary',KV_REST_API_URL:'https://private-store-canary.invalid',KV_REST_API_TOKEN:'secret-store-canary'};
const code='secret-code-canary',email='private-email-canary@example.test',access='secret-access-canary',refresh='secret-refresh-canary';
const response=()=>({headers:{},code:200,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;},redirect(n,v){this.code=n;this.location=v;return this;}});
function fixture({failureAt=0,reply,config=env,throwLogger=false}={}){
 const logs=[],calls=[];
 const h=createHandlers({env:config,identity:()=> 'owner',authorize:()=>true,logger:entry=>{logs.push(entry);if(throwLogger)throw Error('secret-logger-error');},fetchImpl:async(url,options)=>{
  calls.push({url,options});if(calls.length===failureAt){if(reply instanceof Error)throw reply;return typeof reply==='function'?reply():reply;}
  return Response.json(calls.length===1?{access_token:access,refresh_token:refresh,scope:SCOPE}:calls.length===2?{emailAddress:email}:{result:'OK'});
 }});
 return {...h,logs,calls};
}
async function attempt(f){const start=response();await f.connect({method:'POST',headers:{host}},start);assert.equal(start.code,303);const state=new URL(start.location).searchParams.get('state'),req={method:'GET',headers:{host,cookie:COOKIE+'='+state},query:{state,code}},res=response();await f.callback(req,res);return {req,res,state};}
function safe(f,res,state){
 const out=JSON.stringify({logs:f.logs,body:res.body});
 for(const secret of [code,email,access,refresh,env.GOOGLE_CLIENT_ID,env.GOOGLE_CLIENT_SECRET,env.KV_REST_API_TOKEN,env.KV_REST_API_URL,state,'secret-provider-description','secret-provider-url','secret-logger-error'])assert.equal(out.includes(secret),false,'diagnostic must not contain '+secret);
 for(const entry of f.logs){assert.deepEqual(Object.keys(entry).sort(),['diagnosticId','httpStatus','providerReason','reason','stage']);assert.match(entry.diagnosticId,/^[a-f0-9]{16}$/);}
}
for(const scenario of [
 {name:'invalid client',at:1,status:401,payload:{error:'invalid_client',error_description:'secret-provider-description'},stage:'permission_exchange',reason:'invalid_client'},
 {name:'expired or reused provider code',at:1,status:400,payload:{error:'invalid_grant'},stage:'permission_exchange',reason:'invalid_grant'},
 {name:'disabled API is identified only from structured provider evidence',at:2,status:403,payload:{error:{message:'secret-provider-description',details:[{reason:'SERVICE_DISABLED',metadata:{url:'secret-provider-url'}}]}},stage:'gmail_verification',reason:'SERVICE_DISABLED'},
 {name:'missing scope permission',at:2,status:403,payload:{error:{errors:[{reason:'insufficientPermissions'}]}},stage:'gmail_verification',reason:'insufficientPermissions'},
 {name:'rate limit',at:2,status:429,payload:{error:{errors:[{reason:'rateLimitExceeded'}]}},stage:'gmail_verification',reason:'rateLimitExceeded'},
 {name:'unrecognized provider reason is suppressed',at:2,status:403,payload:{error:{errors:[{reason:'secret-provider-description'}]}},stage:'gmail_verification',reason:null},
 {name:'storage HTTP error',at:3,status:403,payload:{error:'secret-provider-description'},stage:'save_connection',reason:null}
])test('safe diagnostic: '+scenario.name,async()=>{
 const f=fixture({failureAt:scenario.at,reply:Response.json(scenario.payload,{status:scenario.status})}),{res,state}=await attempt(f);
 assert.equal(res.code,503);assert.equal(f.calls.length,scenario.at);assert.equal(f.logs.length,1);assert.equal(f.logs[0].stage,scenario.stage);assert.equal(f.logs[0].httpStatus,scenario.status);assert.equal(f.logs[0].providerReason,scenario.reason);assert.equal(res.headers['X-James-Gmail-Diagnostic'],f.logs[0].diagnosticId);safe(f,res,state);
 if(scenario.at===3)assert.equal(JSON.parse(f.calls[2].options.body)[1],tokenKey(env,'owner'));
});
for(const scenario of [
 {name:'malformed provider JSON',reply:()=>new Response('secret-provider-description',{status:502}),reason:'invalid_response',status:502},
 {name:'bounded oversized response',reply:()=>new Response('secret-provider-description',{status:200,headers:{'content-length':'999999999'}}),reason:'invalid_response',status:200},
 {name:'network exception',reply:Error('secret-provider-description'),reason:'network_failure',status:null},
 {name:'timeout',reply:Object.assign(Error('secret-provider-description'),{name:'TimeoutError'}),reason:'request_timeout',status:null}
])test('safe diagnostic: '+scenario.name,async()=>{
 const f=fixture({failureAt:1,reply:scenario.reply}),{res,state}=await attempt(f);assert.equal(res.code,503);assert.equal(f.logs[0].reason,scenario.reason);assert.equal(f.logs[0].httpStatus,scenario.status);safe(f,res,state);
});
test('configuration failure records no credentials and never calls a provider',async()=>{
 const f=fixture({config:{...env,KV_REST_API_TOKEN:''}}),{res,state}=await attempt(f);assert.equal(res.code,503);assert.equal(f.calls.length,0);assert.equal(f.logs[0].stage,'configuration');assert.equal(f.logs[0].reason,'configuration_invalid');safe(f,res,state);
});
test('invalid and denied state never exchange a code and do not log state or provider text',async()=>{
 const f=fixture();let first=response();await f.callback({method:'GET',headers:{host,cookie:COOKIE+'=wrong'},query:{state:'secret-state-canary',code}},first);assert.equal(first.code,400);assert.equal(f.calls.length,0);safe(f,first,'secret-state-canary');
 const start=response();await f.connect({method:'POST',headers:{host}},start);const state=new URL(start.location).searchParams.get('state'),res=response();await f.callback({method:'GET',headers:{host,cookie:COOKIE+'='+state},query:{state,error:'secret-provider-description'}},res);assert.equal(res.code,400);assert.equal(f.calls.length,0);assert.equal(f.logs.at(-1).providerReason,null);assert.match(res.headers['Set-Cookie'],/Max-Age=0/);safe(f,res,state);
});
for(const failureAt of [0,1,2,3])test('browser refresh replay after '+(failureAt?'failed stage '+failureAt:'success')+' does not exchange or save again',async()=>{
 const f=fixture({failureAt,reply:()=>Response.json({error:'invalid_grant'},{status:400})}),{req,res,state}=await attempt(f);
 assert.match(res.headers['Set-Cookie'],/Max-Age=0/);const calls=f.calls.length,replay=response();
 // Model the browser honoring the callback's Set-Cookie deletion before refresh.
 await f.callback({...req,headers:{host,cookie:''}},replay);
 assert.equal(replay.code,400);assert.equal(f.calls.length,calls);assert.equal(f.logs.at(-1).stage,'state_validation');assert.equal(f.logs.at(-1).reason,'invalid_state');safe(f,replay,state);
});
test('diagnostic sink failure cannot bypass state validation or replace the safe response',async()=>{
 const f=fixture({failureAt:1,reply:Response.json({error:'invalid_client'},{status:401}),throwLogger:true}),{res,state}=await attempt(f);assert.equal(res.code,503);assert.equal(f.calls.length,1);safe(f,res,state);
});
test('replaying a consumed provider code with a retained cookie cannot save a second grant',async()=>{
 const f=fixture({failureAt:4,reply:Response.json({error:'invalid_grant',error_description:'secret-provider-description'},{status:400})}),{req,res,state}=await attempt(f);assert.equal(res.code,200);
 const replay=response();await f.callback(req,replay);assert.equal(replay.code,503);assert.equal(f.calls.length,4);assert.equal(f.calls.filter(call=>call.url===env.KV_REST_API_URL).length,1);assert.equal(f.logs.at(-1).providerReason,'invalid_grant');safe(f,replay,state);
});
