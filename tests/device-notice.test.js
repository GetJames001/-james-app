'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createDeviceProof,chromeEndpoint,enabled} = require('../lib/task-execution/device-proof.cjs');
const {createHandler} = require('../lib/routes/device-proof.js');
const {CAS} = require('../lib/customer-activity/storage.cjs');
const host='https://fcm.googleapis.com', endpoint=host+'/fcm/send/fictional_subscription_12345';
const head='1'.repeat(40);
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'work/android-ready-alert-20261114',VERCEL_PROJECT_ID:'prj_SeUz2jQJ2KqxZFMALQsKloLicijw',VERCEL_GIT_COMMIT_SHA:head,JAMES_DEVICE_PROOF_HEAD:head,KV_REST_API_TOKEN:'fixture',KV_REST_API_URL:'https://store.test',JAMES_SESSION_SECRET:'local-fixture-only-'.repeat(3)};
function fixture(){
  const kv=new Map(), sent=[]; let time=1000000, response=201;
  const fetchImpl=async(url,opt)=>{
    assert.equal(url,env.KV_REST_API_URL);assert.equal(opt.redirect,'error');
    const [cmd,...p]=JSON.parse(opt.body);
    if(cmd==='GET')return Response.json({result:kv.get(p[0])??null});
    assert.equal(cmd,'EVAL');const [lua,count,key,...args]=p;assert.equal(count,1);
    const raw=kv.get(key)??null;
    const expected=lua===CAS?(args[0]==='absent'?null:args[1]):args[0]||null;
    if(raw!==expected)return Response.json({result:0});
    kv.set(key,lua===CAS?args[2]:args[1]);return Response.json({result:1});
  };
  const postPush=async(url,options)=>{sent.push({url,options});if(!response)throw Error('outcome unknown');return new Response(null,{status:response});};
  return {make:()=>createDeviceProof({env,owner:'fictional-owner',fetchImpl,postPush,now:()=>time}),sent,kv,advance:ms=>time+=ms,respond:v=>response=v};
}
test('prepared task sends one empty authorized push; actual display and tap are separate durable receipts',async()=>{
  const f=fixture(), app=f.make(),{subscriptionKey}=await app.begin();
  await app.pair(endpoint);assert.equal((await app.status()).state,'registered');
  const after=await f.make().run();
  assert.equal(after.agenda.text,'09:00 — Fictional planning call');assert.equal(after.transport,'accepted');
  assert.equal(after.notice,'unknown');assert.equal(after.shown,false);
  assert.equal(f.sent.length,1);const {url,options}=f.sent[0];assert.equal(url,endpoint);
  assert.equal(options.body,undefined);assert.equal(options.redirect,'error');
  const [_,token,pub]=/^vapid t=(\S+), k=(\S+)$/.exec(options.headers.Authorization);
  assert.equal(pub,subscriptionKey);const bytes=Buffer.from(pub,'base64url'), [header,claims,signature]=token.split('.');
  assert.equal(JSON.parse(Buffer.from(claims,'base64url')).aud,host);
  assert.ok(crypto.verify('sha256',Buffer.from(header+'.'+claims),{key:crypto.createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:bytes.subarray(1,33).toString('base64url'),y:bytes.subarray(33).toString('base64url')}}),dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')));
  assert.equal((await app.pending()).id,after.id);
  await assert.rejects(app.acknowledge(after.id,true),/NOTICE_UNAVAILABLE/);
  await assert.rejects(app.acknowledge('other'),/NOTICE_UNAVAILABLE/);
  await app.acknowledge(after.id);await f.make().acknowledge(after.id);await app.acknowledge(after.id,true);
  const status=await f.make().status();assert.equal(status.shown,true);assert.equal(status.opened,true);assert.equal(status.notice,'delivered');
  f.advance(1500);await app.run();assert.equal(f.sent.length,1);assert.deepEqual(await app.pending(),{});
  const encrypted=[...f.kv].find(([k])=>k.startsWith('james:device-proof:'))[1];
  assert.doesNotMatch(encrypted,/fcm\.googleapis|privateKey|subscription/);
});
test('concurrent calls, lost provider acknowledgement, cancellation and restart do not repeat the send',async()=>{
  const f=fixture(),app=f.make();await app.begin();await app.pair(endpoint);f.respond(null);
  await Promise.allSettled([app.run(),f.make().run()]);assert.equal(f.sent.length,1);
  f.advance(4000);await f.make().run();assert.equal(f.sent.length,1);
  const status=await app.status();assert.equal(status.shown,false);await app.stop();
  assert.equal((await app.status()).agenda.text,'09:00 — Fictional planning call');
  await assert.rejects(app.pending(),/WINDOW_CLOSED/);await assert.rejects(app.acknowledge(status.id),/NOTICE_UNAVAILABLE/);
  assert.equal((await app.status()).shown,false);
});
test('stop before send and expired windows admit no transmissions; one phone per cohort',async()=>{
  const f=fixture(), app=f.make();await app.begin();await app.pair(endpoint);await app.pair(endpoint);
  await assert.rejects(app.pair(endpoint+'z'),/DEVICE_ALREADY_PAIRED/);
  await app.stop();await assert.rejects(app.run(),/WINDOW_CLOSED/);assert.equal(f.sent.length,0);
  const g=fixture(), b=g.make();await b.begin();await b.pair(endpoint);g.advance(1800000);await assert.rejects(b.run(),/WINDOW_CLOSED/);assert.equal(g.sent.length,0);
});
test('Android-only transport refuses other destinations; route is owner and exact Preview scoped',async()=>{
  for(const url of ['https://example.org/a','http://fcm.googleapis.com/fcm/send/fictional_subscription_12345',endpoint+'?x=1',endpoint+'#x',endpoint.replace('googleapis.com','googleapis.com.example.org')])assert.throws(()=>chromeEndpoint(url),/INVALID_SUBSCRIPTION/);
  for(const extra of [{VERCEL_ENV:'production'},{VERCEL_PROJECT_ID:'wrong'},{VERCEL_GIT_COMMIT_REF:'main'},{JAMES_DEVICE_PROOF_HEAD:''}])assert.equal(enabled({...env,...extra}),false);
  let reached=false,called=false;
  const handler=createHandler({env,authorize:(req,res,opt)=>{called=true;assert.equal(opt.csrf,true);res.status(401).end();return null;},service:()=>{reached=true;}});
  const res={setHeader(){},status(n){this.code=n;return this;},end(){}};
  await handler({method:'POST',query:{path:'api/james/device-check'}},res);assert.equal(called,true);assert.equal(reached,false);assert.equal(res.code,401);
});
test('tap opens the matching fixed-origin result even if receipt storage fails',async()=>{
  const vm=require('node:vm'), fs=require('node:fs'), events={}, targets=[], actions=[];
  const id=crypto.randomUUID();
  vm.runInNewContext(fs.readFileSync('device-check-worker.js','utf8'),{URL,self:{registration:{scope:'https://preview.test/device-check/'},clients:{openWindow:async url=>{targets.push(url);return {};}},addEventListener:(name,fn)=>events[name]=fn},fetch:async(url,opts)=>{actions.push(JSON.parse(opts.body));throw Error('offline');}});
  const click=async data=>{let work;events.notificationclick({notification:{data,close(){}},waitUntil(p){work=p;}});await work;};
  await click({id,url:'https://elsewhere.test'});await click({id:'bad'});
  assert.deepEqual(targets,['https://preview.test/device-check/#'+id]);assert.deepEqual(actions,[{action:'opened',id}]);
});
