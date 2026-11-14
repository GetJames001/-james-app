'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {create,subscription,transmit,enabled}=require('../lib/attention/review-alert.cjs');
const {collectReview,projectReview,decideReview}=require('../lib/attention/mail-review.cjs');
const push=require('web-push');
const timestamp=Date.parse('2026-11-14T21:00:00Z');
function sample(){
 const ecdh=crypto.createECDH('prime256v1');ecdh.generateKeys();
 return {endpoint:'https://fcm.googleapis.com/fcm/send/fictional_endpoint_token',keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')}};
}
function fixture(send){
 const db=new Map();
 async function redis([op,...p]){
  if(op==='GET')return db.get(p[0])??null;
  const [, ,key,expected,next]=p;
  if((db.get(key)??'')!==expected)return 0;
  if(next)db.set(key,next);else db.delete(key);return 1;
 }
 const service=create('fixture@example.test',{secret:'fictional-testing-secret-32-bytes-or-more',redis,send,now:()=>timestamp});
 async function arm(){
  const {publicKey}=await service.prepare();const sub=sample();
  await service.pair(sub,publicKey);
  assert.ok(![...db.values()].some(v=>v.includes(sub.endpoint)||v.includes(sub.keys.auth)));
 }
 return {service,arm};
}
function saved(offset=0){
 const at=new Date(timestamp+offset).toISOString();
 return {revision:1,accountId:'owner',...collectReview(null,'owner',[{id:'one',subject:'Interview invitation',receivedDateTime:at}],at)};
}
test('only one new actionable result sends, and transport and device receipts stay distinct',async()=>{
 let sends=0;const f=fixture(async()=>{sends++;return 'accepted';});
 await f.arm();await f.service.deliver(saved(-1000));assert.equal(sends,0);
 const snapshot=saved(),key=projectReview(snapshot).items[0].reviewKey;
 const handled={...snapshot,...decideReview(snapshot,key,'handled',new Date(timestamp).toISOString())};
 await f.service.deliver(handled);assert.equal(sends,0);
 await Promise.all([f.service.deliver(snapshot),f.service.deliver(snapshot)]);
 assert.equal(sends,1);assert.equal((await f.service.status()).state,'accepted');assert.equal((await f.service.status()).receipt,null);
 await f.service.acknowledge(key,'opened');await f.service.acknowledge(key,'shown');assert.equal((await f.service.status()).receipt,'opened');
 await f.service.stop();assert.equal((await f.service.status()).state,'off');
});
test('ambiguous or stopped delivery is not retried',async()=>{
 let sends=0;const f=fixture(async()=>{sends++;throw Error();});await f.arm();
 await f.service.deliver(saved());await f.service.deliver(saved());assert.equal(sends,1);
 assert.equal((await f.service.status()).state,'unconfirmed');
 await f.service.stop();await f.service.deliver(saved());assert.equal(sends,1);
});
test('sender prepares encrypted Web Push only for the approved Android endpoint',async t=>{
 const sub=sample(),keys=push.generateVAPIDKeys(),key='d'.repeat(64);
 assert.throws(()=>subscription({...sub,endpoint:'https://example.test/other'}));
 subscription(sub);
 t.mock.method(global,'fetch',async(url,opt)=>{
  assert.equal(url,sub.endpoint);assert.equal(opt.redirect,'error');assert.equal(opt.headers['Content-Encoding'],'aes128gcm');
  assert.ok(!opt.body.includes(Buffer.from(key)));assert.ok(opt.headers.Authorization.startsWith('vapid '));return new Response(null,{status:201});
 });
 assert.equal(await transmit({subscription:sub,keys},key),'accepted');
 assert.equal(enabled({headers:{host:'www.getjames.ai'}},{VERCEL_ENV:'production'}),false);
});
