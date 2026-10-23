'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const auth=require('../lib/auth.js'),fast=require('../api/fast.js');
process.env.JAMES_AUTH_EMAIL='fixture@example.test';process.env.JAMES_SESSION_SECRET='synthetic-conversation-test-session-secret';process.env.OPENAI_API_KEY='synthetic-only';
async function run(provider,{authorized=true}={}){
 const prior=global.fetch,oldError=console.error;let calls=0;const logs=[];
 global.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.ok(options.signal);return typeof provider==='function'?provider():provider;};console.error=(...args)=>logs.push(args);
 const req={method:'POST',headers:{host:'www.getjames.ai',origin:'https://www.getjames.ai',...(authorized?{cookie:`${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`}:{})},body:{question:'Synthetic verification only'}};
 const res={code:200,setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 try{await fast(req,res);return {res,calls,logs};}finally{global.fetch=prior;console.error=oldError;}
}
for(const status of [401,403,404,429,500])test(`provider ${status} cannot masquerade as James session rejection`,async()=>{
 const {res,logs}=await run({ok:false,status,json:async()=>({error:{code:'model_not_found',message:'PRIVATE_PROVIDER_PROJECT_DETAIL'}})});
 assert.equal(res.code,502);assert.equal(res.body.error,'FAST_MODEL_UNAVAILABLE');assert.doesNotMatch(JSON.stringify({body:res.body,logs}),/PRIVATE_PROVIDER_PROJECT_DETAIL|synthetic-only/);
});
test('provider timeout is bounded and safely classified',async()=>{const {res}=await run(()=>{throw Object.assign(Error('PRIVATE_ENDPOINT'),{name:'TimeoutError'})});assert.equal(res.code,504);assert.equal(res.body.error,'FAST_TIMEOUT');assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_ENDPOINT/);});
test('James unauthenticated request still fails before provider work',async()=>{const {res,calls}=await run({}, {authorized:false});assert.equal(res.code,401);assert.equal(calls,0);});
test('permitted provider answer retains normal response contract',async()=>{const {res}=await run({ok:true,status:200,json:async()=>({output_text:'Synthetic reply'})});assert.equal(res.code,200);assert.equal(res.body.answer,'Synthetic reply');});
test('model inventory remains unavailable outside the exact isolated Preview',async()=>{
 const old=global.fetch,env=process.env.VERCEL_ENV,branch=process.env.VERCEL_GIT_COMMIT_REF;let calls=0;global.fetch=async()=>{calls++;throw Error('Must not reach provider')};
 try{for(const [mode,ref]of [['production','investigate/conversation-host-20261023'],['preview','review/customer-activity-save-20261021']]){
 process.env.VERCEL_ENV=mode;process.env.VERCEL_GIT_COMMIT_REF=ref;const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
 await fast({method:'GET',query:{diagnostics:'models'},headers:{host:'www.getjames.ai',cookie:`${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`}},res);assert.equal(res.code,405);
 }assert.equal(calls,0);}finally{global.fetch=old;if(env===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=env;if(branch===undefined)delete process.env.VERCEL_GIT_COMMIT_REF;else process.env.VERCEL_GIT_COMMIT_REF=branch;}
});
test('authenticated isolated model inventory reports IDs only and does not assert inference permission',async()=>{
 const old=global.fetch,env=process.env.VERCEL_ENV,branch=process.env.VERCEL_GIT_COMMIT_REF;process.env.VERCEL_ENV='preview';process.env.VERCEL_GIT_COMMIT_REF='investigate/conversation-host-20261023';
 global.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/models');assert.equal(options.method,'GET');return {ok:true,json:async()=>({data:[{id:'gpt-4.1-mini',owned_by:'PRIVATE_PROJECT'},{id:'gpt-5-mini'},{id:'unrelated-model'},{id:'gpt-4.1-mini'}]})}};
 try{const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};await fast({method:'GET',query:{diagnostics:'models'},headers:{host:'www.getjames.ai',cookie:`${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`}},res);assert.equal(res.code,200);assert.deepEqual(res.body.models,['gpt-4.1-mini','gpt-5-mini']);assert.equal(res.body.inferenceAccessVerified,false);assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_PROJECT|synthetic-only/);}finally{global.fetch=old;if(env===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=env;if(branch===undefined)delete process.env.VERCEL_GIT_COMMIT_REF;else process.env.VERCEL_GIT_COMMIT_REF=branch;}
});
