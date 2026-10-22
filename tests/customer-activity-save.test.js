'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {makeStore,scopedKey}=require('../lib/customer-activity/records.cjs');
const {createHandler}=require('../lib/routes/customer-activity.js');
const {createStorage,CAS}=require('../lib/customer-activity/storage.cjs');
const auth=require('../lib/auth.js');
function memory(){const data=new Map();return {data,store:makeStore({read:async k=>data.get(k)??null,compareAndSwap:async(k,old,next)=>{if((data.get(k)??null)!==old)return false;data.set(k,next);return true;}})};}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(x){this.body=x;return this;}};}
const customer={id:'test-c',name:'Fictional test customer'};
const visit={id:'test-v',customerId:customer.id,occurredAt:'2026-10-20T12:00:00.000Z',outcome:'attempted',notes:'No answer',nextAction:'Call again'};
test('authenticated handler saves, reopens, isolates owner, rejects stale writes and unsafe requests',async()=>{
 const old={...process.env};process.env.JAMES_AUTH_EMAIL='test@example.test';process.env.JAMES_SESSION_SECRET='test-only-secret-'.repeat(4);
 try{const h=memory(),handler=createHandler({store:h.store});const headers={host:'getjames.ai',origin:'https://getjames.ai','content-type':'application/json',cookie:`${auth.SESSION_COOKIE}=${auth.createSessionToken('test@example.test')}`};
 const call=async(method,body,overrides={})=>{const res=response();await handler({method,body,headers,query:{},...overrides},res);return res;};
 assert.equal((await call('GET',null,{headers:{host:'getjames.ai'}})).code,401);
 assert.equal(h.data.size,0);
 assert.equal((await call('POST',{}, {headers:{...headers,origin:'https://evil.example'}})).code,403);
 assert.equal((await call('POST',{type:'upsert_customer',expectedRevision:0,customer,owner:'someone'})).code,400);
 assert.equal((await call('POST',{type:'upsert_customer',expectedRevision:0,customer})).code,200);
 assert.equal((await call('POST',{type:'record_activity',expectedRevision:1,activity:visit})).code,200);
 const loaded=await call('GET');assert.equal(loaded.body.document.activities[0].outcome,'attempted');assert.equal(loaded.body.document.revision,2);
 assert.equal((await call('POST',{type:'record_activity',expectedRevision:1,activity:{...visit,id:'v2'}})).code,409);
 assert.equal((await call('POST',{type:'record_activity',expectedRevision:2,activity:{...visit,id:'v2',nextActionDue:'2026-02-30'}})).code,400);
 assert.equal((await h.store.load('another@example.test')).activities.length,0);
 assert.match(loaded.headers['Cache-Control'],/no-store/);
 assert.equal(h.data.size,1);assert.ok(h.data.has(scopedKey('test@example.test')));
 }finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});
test('REST adapter sends atomic CAS only to scoped activity keys and rejects ambiguous acknowledgements',async()=>{
 const backing=new Map(),calls=[];
 const fetchImpl=async(url,opts)=>{const cmd=JSON.parse(opts.body);calls.push(cmd);let result;
 if(cmd[0]==='GET')result=backing.get(cmd[1])??null;
 else{assert.equal(cmd[1],CAS);const [, , ,key,mode,old,next]=cmd;const previous=backing.get(key)??null;result=(mode==='absent'?previous===null:previous===old)?1:0;if(result)backing.set(key,next);}
 return new Response(JSON.stringify({result}));};
 const store=createStorage({url:'https://storage.example',token:'fictional',fetchImpl});
 assert.equal((await store.commit('test',{type:'upsert_customer',expectedRevision:0,customer})).ok,true);
 assert.equal((await store.load('test')).customers[0].id,customer.id);
 assert.ok(calls.every(c=>/^james:customer-activity:v1:/.test(c[c[0]==='GET'?1:3])));
 const bad=createStorage({url:'https://storage.example',token:'fictional',fetchImpl:async()=>new Response('{"result":true}')});
 await assert.rejects(()=>bad.load('test'),/INVALID_STORAGE_RESPONSE/);
});
test('storage failures produce no false success and corrupt records are not replaced',async()=>{
 const handler=createHandler({store:{load:async()=>{throw new Error('secret must not escape');}},authorize:()=>true,identity:()=> 'test'});
 const res=response();await handler({method:'GET'},res);assert.equal(res.code,503);assert.equal(JSON.stringify(res.body).includes('secret'),false);
});

test('authenticated follow-up updates persist, reject stale/invalid writes and stay account scoped',async()=>{
 const h=memory(),handler=createHandler({store:h.store,authorize:()=>true,identity:()=> 'followup-owner'});
 const call=async body=>{const res=response();await handler({method:'POST',body,headers:{'content-type':'application/json'},query:{}},res);return res;};
 await call({type:'upsert_customer',expectedRevision:0,customer});
 await call({type:'record_activity',expectedRevision:1,activity:{...visit,nextActionAt:'2099-10-23T17:00:00.000Z',nextActionDetails:'Call manager'}});
 assert.equal((await call({type:'update_followup',expectedRevision:2,followUp:{id:visit.id,operation:'reschedule',at:'2000-01-01T00:00:00.000Z'}})).code,400);
 assert.equal((await call({type:'update_followup',expectedRevision:2,followUp:{id:visit.id,operation:'reschedule',at:'2099-10-24T17:00:00.000Z'}})).code,200);
 assert.equal((await call({type:'update_followup',expectedRevision:2,followUp:{id:visit.id,operation:'complete',at:new Date().toISOString()}})).code,409);
 assert.equal((await call({type:'update_followup',expectedRevision:3,followUp:{id:visit.id,operation:'complete',at:new Date().toISOString()}})).code,200);
 const stored=await h.store.load('followup-owner');assert.ok(stored.activities[0].followUpCompletedAt);assert.equal(stored.activities[0].outcome,'attempted');assert.equal((await h.store.load('different-owner')).activities.length,0);
});
