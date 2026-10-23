'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const auth=require('../lib/auth.js'),fast=require('../api/fast.js');
process.env.JAMES_AUTH_EMAIL='fixture@example.test';process.env.JAMES_SESSION_SECRET='synthetic-conversation-test-session-secret';process.env.OPENAI_API_KEY='synthetic-only';process.env.JAMES_FAST_MODEL='gpt-5.6-luna';
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

test('release has no model-inventory endpoint in any environment',async()=>{
 const prior=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Unexpected provider access')};
 try{const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};await fast({method:'GET',query:{diagnostics:'models'},headers:{host:'www.getjames.ai',cookie:`${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`}},res);assert.equal(res.code,405);assert.equal(calls,0);}finally{global.fetch=prior;}
});
test('missing model configuration fails clearly before provider access',async()=>{
 const configured=process.env.JAMES_FAST_MODEL;delete process.env.JAMES_FAST_MODEL;try{const {res,calls}=await run({});assert.equal(res.code,503);assert.equal(res.body.error,'FAST_MODEL_NOT_CONFIGURED');assert.equal(calls,0);}finally{process.env.JAMES_FAST_MODEL=configured;}
});
test('configured model is used without any branch-specific behavior',async()=>{
 const prior=global.fetch;let body;global.fetch=async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({output_text:'Synthetic reply'})}};
 try{const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};await fast({method:'POST',headers:{host:'www.getjames.ai',origin:'https://www.getjames.ai',cookie:`${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`},body:{question:'Synthetic only'}},res);assert.equal(res.code,200);assert.equal(body.model,'gpt-5.6-luna');assert.equal(body.reasoning.effort,'low');assert.equal(body.max_output_tokens,800);assert.equal(body.store,false);}finally{global.fetch=prior;}
});
