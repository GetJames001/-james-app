'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const source=path.resolve(__dirname,'..');
async function run(req,{authorized=true,configured=true,status=200,oversize=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'james-bridge-test-'));for(const f of ['api/wardrobe.js','lib/wardrobe/read-bridge.mjs','lib/wardrobe/signing-key.cjs']){const q=path.join(root,f);fs.mkdirSync(path.dirname(q),{recursive:true});fs.copyFileSync(path.join(source,f),q);}
 fs.writeFileSync(path.join(root,'lib/auth.js'),`exports.requireAuth=(q,r)=>${authorized?"({sub:'owner'})":"(r.status(401).json({error:'UNAUTHORIZED'}),null)"};`);
 const previousFetch=global.fetch,oldSecret=process.env.JAMES_WARDROBE_BRIDGE_SECRET,oldToken=process.env.JAMES_WARDROBE_SERVICE_TOKEN,calls=[];
 process.env.JAMES_WARDROBE_BRIDGE_SECRET=configured?'synthetic-only-secret-at-least-32-bytes':'';process.env.JAMES_WARDROBE_SERVICE_TOKEN='synthetic-service-token';
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(x){this.body=x;return this;},end(){this.ended=true;return this;}};
 try{
  const {createReadBridge}=await import(path.join(root,'lib/wardrobe/read-bridge.mjs'));
  const keys=require(path.join(root,'lib/wardrobe/signing-key.cjs')).bridgeKeys('synthetic-only-secret-at-least-32-bytes');
  const receiver=createReadBridge({siteOrigin:'https://aaru-working-review.aglow-ox-8353.chatgpt.site',ownerNamespace:'james-single-owner-v1',wardrobeUserId:'synthetic-wardrobe-user',publicKey:keys.publicKey,wardrobeRead:async r=>{assert.equal(r.headers.get('oai-authenticated-user-id'),'synthetic-wardrobe-user');return Response.json({revision:96,snapshot:{items:[]}});},photoRead:async()=>Response.json({photo:'synthetic'}),nowMs:Date.now});
  global.fetch=async(r,options)=>{calls.push({r,options});if(status!==200)return new Response('private provider failure',{status});if(oversize)return new Response(new Uint8Array(24*1024*1024+1));return receiver(r,{});};
  await require(path.join(root,'api/wardrobe.js'))(req,res);return {res,calls};
 }finally{global.fetch=previousFetch;for(const [k,v]of [['JAMES_WARDROBE_BRIDGE_SECRET',oldSecret],['JAMES_WARDROBE_SERVICE_TOKEN',oldToken]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}fs.rmSync(root,{recursive:true,force:true});}
}
test('authenticated James proxy traverses real signer/receiver with fixed owner',async()=>{const {res,calls}=await run({method:'GET',query:{path:'api/wardrobe'}});assert.equal(res.code,200);assert.equal(res.body.revision,96);assert.equal(calls.length,1);assert.equal(calls[0].r.headers.get('X-James-Owner'),'james-single-owner-v1');assert.equal(calls[0].options.redirect,'error');});
test('unauthenticated caller performs no upstream request',async()=>{const {res,calls}=await run({method:'GET'},{authorized:false});assert.equal(res.code,401);assert.equal(calls.length,0);});
test('write methods never reach receiver',async()=>{for(const method of ['POST','PUT','PATCH','DELETE']){const {res,calls}=await run({method});assert.equal(res.code,405);assert.equal(calls.length,0);}});
test('caller owner and invalid photo controls fail before upstream',async()=>{for(const query of [{owner:'another'},{photo:['a'.repeat(64)]},{photo:'../secret'}]){const {res,calls}=await run({method:'GET',query});assert.equal(res.code,400);assert.equal(calls.length,0);}});
test('missing configuration fails closed',async()=>{const {res,calls}=await run({method:'GET'},{configured:false});assert.equal(res.code,503);assert.equal(calls.length,0);});
test('upstream failure is redacted',async()=>{const {res}=await run({method:'GET'},{status:403});assert.equal(res.code,502);assert.deepEqual(res.body,{error:'WARDROBE_UNAVAILABLE'});});
test('HEAD photo read returns no body',async()=>{const {res}=await run({method:'HEAD',query:{photo:'a'.repeat(64)}});assert.equal(res.code,200);assert.equal(res.body,undefined);assert.equal(res.ended,true);});
test('response bound rejects oversized body',async()=>{const {res}=await run({method:'GET'},{oversize:true});assert.equal(res.code,503);});

test('public verification metadata is authenticated, public-only and makes no upstream read',async()=>{const {res,calls}=await run({method:'GET',query:{bridgeKey:'1'}});assert.equal(res.code,200);assert.match(res.body.publicKey,/^[a-f0-9]{64}$/);assert.equal(res.body.protocol,'james-wardrobe-read-ed25519-v2');assert.deepEqual(Object.keys(res.body).sort(),['owner','protocol','publicKey']);assert.equal(calls.length,0);const denied=await run({method:'GET',query:{bridgeKey:'1'}},{authorized:false});assert.equal(denied.res.code,401);});

test('real James auth protects public key metadata without touching Mail or provider services',async()=>{
 const auth=require('../lib/auth.js'),handler=require('../api/wardrobe.js');
 process.env.JAMES_AUTH_EMAIL='synthetic-owner@example.test';process.env.JAMES_SESSION_SECRET='synthetic-session-only-at-least-32-bytes';process.env.JAMES_WARDROBE_BRIDGE_SECRET='synthetic-bridge-only-at-least-32-bytes';
 const token=auth.createSessionToken(process.env.JAMES_AUTH_EMAIL),saved=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('No network permitted');};
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;},end(){this.ended=true;return this;}});
 try{const q={method:'GET',query:{bridgeKey:'1'},headers:{host:'www.getjames.ai',cookie:`${auth.SESSION_COOKIE}=${token}`}},r=response();await handler(q,r);assert.equal(r.code,200);assert.match(r.body.publicKey,/^[a-f0-9]{64}$/);assert.equal(calls,0);
 const denied=response();await handler({...q,headers:{...q.headers,cookie:'__Host-james_session=forged'}},denied);assert.equal(denied.code,401);assert.equal(calls,0);
 const hostile=response();await handler({...q,headers:{...q.headers,host:'attacker.example'}},hostile);assert.equal(hostile.code,403);assert.equal(calls,0);
 }finally{global.fetch=saved;}
});
