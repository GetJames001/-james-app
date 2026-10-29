'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),auth=require('../lib/auth.js');
const {createHandler}=require('../lib/routes/conversation.js'),{createStorage}=require('../lib/conversation/storage.cjs');
process.env.JAMES_AUTH_EMAIL='conversation-fixture@example.test';process.env.JAMES_SESSION_SECRET='conversation-fixture-session-secret-long-enough';process.env.JAMES_AUTH_PASSWORD_HASH=auth.hashPassword('fixture',{salt:Buffer.alloc(16,5)});
function res(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this},end(){return this}};}
function req(extra={}){return {method:'POST',body:{action:'ensure'},headers:{host:'www.getjames.ai',origin:'https://www.getjames.ai','content-type':'application/json',cookie:`${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`},...extra};}
test('conversation lifecycle uses actual host authentication and rejects foreign origins before storage',async()=>{let calls=0;const handler=createHandler({store:{execute:async owner=>{calls++;assert.equal(owner,process.env.JAMES_AUTH_EMAIL);return {status:'ready'}}}});let response=res();await handler(req(),response);assert.equal(response.code,200);assert.match(response.headers['Cache-Control'],/no-store/);for(const headers of [{host:'www.getjames.ai'},{...req().headers,origin:'https://foreign.example'}]){response=res();await handler(req({headers}),response);assert.ok([401,403].includes(response.code));}assert.equal(calls,1);});
test('conversation route rejects invalid bodies and identity overrides before storage',async()=>{let calls=0;const handler=createHandler({store:{execute:async()=>calls++}});for(const [extra,status] of [[{body:null},400],[{body:'{'},400],[{body:'x'.repeat(4097)},413],[{query:{accountId:'foreign'}},400]]){const response=res();await handler(req(extra),response);assert.equal(response.code,status);}assert.equal(calls,0);});
test('REST lifecycle adapter validates envelopes and refuses missing configuration',async()=>{await assert.rejects(createStorage({}).execute('fixture',{action:'ensure'}),/STORAGE_UNAVAILABLE/);for(const result of [{error:'private error'},{result:7}]){const store=createStorage({url:'https://fixture.invalid',token:'fictional-token',fetchImpl:async()=>new Response(JSON.stringify(result))});await assert.rejects(store.execute('fixture',{action:'ensure'}));}});
test('REST lifecycle adapter uses isolated keys and an atomic command',async()=>{const values=new Map(),commands=[];const store=createStorage({url:'https://fixture.invalid',token:'fictional-token',fetchImpl:async(_url,options)=>{const c=JSON.parse(options.body);commands.push(c);let result;if(c[0]==='GET')result=values.get(c[1])??null;else{assert.equal(c[0],'EVAL');const previous=values.get(c[3])??null;result=(c[4]==='absent'?previous===null:previous===c[5])?1:0;if(result)values.set(c[3],c[6]);}return new Response(JSON.stringify({result}));}});const head=await store.execute('fixture',{action:'ensure'});assert.equal(head.status,'ready');assert.ok(commands.every(c=>String(c[c[0]==='GET'?1:3]).startsWith('james:conversation:v1:')));assert.equal((await store.execute('fixture',{action:'end',conversationId:head.conversationId,generation:head.generation,operationId:'end-1'})).status,'ended');});

test('authenticated lifecycle GET needs no Origin and reads without a command',async()=>{
 let observed; const handler=createHandler({store:{execute:async(owner,command)=>{observed={owner,command};return {conversationId:'fixture-ended',generation:3,status:'ended'};}}});
 const headers={...req().headers}; delete headers.origin;
 const response=res(); await handler(req({method:'GET',headers,body:undefined}),response);
 assert.equal(response.code,200); assert.equal(response.body.status,'ended'); assert.equal(observed.command,undefined);
});
test('lifecycle GET without a James session refuses before reading storage',async()=>{
 let calls=0; const handler=createHandler({store:{execute:async()=>{calls++;}}});
 const response=res(); await handler(req({method:'GET',headers:{host:'www.getjames.ai'},body:undefined}),response);
 assert.equal(response.code,401); assert.equal(response.body.error,'UNAUTHORIZED'); assert.equal(calls,0);
});
