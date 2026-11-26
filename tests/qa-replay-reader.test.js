'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {qaConfiguration,createPinnedReader}=require('../lib/travel/qa-replay-reader.cjs');
const id='already-reviewed-message';
const sender='recruiter@example.invalid';
const fixture={
 id:'gmail:'+id,sender:'Recruiter <'+sender+'>',subject:'FW: Your trip confirmation (LAS - ORD)',
 receivedDateTime:'2026-11-19T21:04:00Z',
 bodyText:['Confirmation code: TEST42','Thursday, December 3, 2026','[airplane]','LAS','Las Vegas','2:09 PM','AA 3015','[destination]','ORD','Chicago','7:58 PM','Friday, December 4, 2026','[airplane]','ORD','Chicago','3:00 PM','AA 3081','[destination]','LAS','Las Vegas','5:16 PM'].join('\n')
};
const env={VERCEL_ENV:'preview',VERCEL_BRANCH_URL:'private-qa.vercel.app',
 JAMES_TRAVEL_QA_REPLAY_ENABLED:'true',JAMES_TRAVEL_QA_BRANCH_URL:'private-qa.vercel.app',
 JAMES_TRAVEL_QA_KV_URL:'https://test.example.invalid',JAMES_TRAVEL_EVERYDAY_KV_URL:'https://live.example.invalid',
 KV_REST_API_URL:'https://test.example.invalid',JAMES_TRAVEL_QA_APPROVED_GMAIL_ID:id,JAMES_TRAVEL_QA_APPROVED_SENDER:sender};
const job={provider:'gmail',messageId:id};
test('QA replay refuses production, wrong branch, shared store and default-disabled config',()=>{
 assert.deepEqual(qaConfiguration(env),{messageId:id,sender});
 for(const override of [{VERCEL_ENV:'production'},{VERCEL_BRANCH_URL:'everyday.vercel.app'},{JAMES_TRAVEL_EVERYDAY_KV_URL:env.KV_REST_API_URL},{KV_REST_API_URL:env.JAMES_TRAVEL_EVERYDAY_KV_URL},{JAMES_TRAVEL_QA_REPLAY_ENABLED:''},{JAMES_TRAVEL_QA_APPROVED_GMAIL_ID:''}]){
  assert.equal(qaConfiguration({...env,...override}),null);
 }
});
test('Only approved immutable provider item can be looked up; both dated flights survive',async()=>{
 let reads=0;
 const read=createPinnedReader({messageId:id,sender,readGmail:async args=>{reads++;assert.deepEqual(args,{messageId:id});return {connected:true,message:fixture}}});
 await assert.rejects(read({...job,messageId:'different-id'}),/TRAVEL_REPLAY_SCOPE/);
 await assert.rejects(read({...job,provider:'microsoft'}),/TRAVEL_REPLAY_SCOPE/);
 assert.equal(reads,0);
 const c=await read(job);
 assert.match(c.id,/^[a-f0-9]{64}$/);
 assert.match(c.values.flights[0],/AA 3015/);
 assert.match(c.values.flights[1],/AA 3081/);
 assert.ok(!JSON.stringify(c).includes('TEST42'));
});
test('Lookalike sender, mismatched item, preview or wrong flight produce no candidate',async()=>{
 for(const override of [{sender:'Recruiter <extra@example.invalid>'},{id:'gmail:other'}, {bodyText:'preview only'},{bodyText:fixture.bodyText.replace('AA 3081','AA 3082')},{sourceFolder:'Spam'}]){
  const read=createPinnedReader({messageId:id,sender,readGmail:async()=>({connected:true,message:{...fixture,...override}})});
  await assert.rejects(read(job),/TRAVEL_REPLAY_(MESSAGE|ITINERARY)_MISMATCH/);
 }
});
test('gated replay queues once, survives failed trip write, and completes on retry with one trip',async()=>{
 const {createReplay}=require('../lib/travel/qa-replay-job.cjs');
 const {createQueue,CAS}=require('../lib/travel/pending-queue.cjs');
 const {COMMIT}=require('../lib/travel/mail-trip-store.cjs');
 let now=1000,failFiles=true,reads=0;
 const queueDB=new Map(),tripDB=new Map();
 const command=async([op,...p])=>{
  if(op==='GET')return queueDB.get(p[0])??null;
  if(op==='HKEYS')return [...tripDB.keys()];
  if(op==='HGET')return tripDB.get(p[1])??null;
  assert.equal(op,'EVAL');
  const [lua,_,key]=p;
  if(lua===CAS){const [,, ,old,next]=p;if((queueDB.get(key)??'')!==old)return 0;queueDB.set(key,next);return 1;}
  assert.equal(lua,COMMIT);
  if(failFiles)throw Error('fixture DB write failure');
  const [,,,keyId,old,meta,contents]=p;
  if((tripDB.get(keyId)??'')!==old)return -1;
  tripDB.set(keyId,meta);tripDB.set('bytes:'+keyId,contents);return 1;
 };
 const run=createReplay({env,command,readGmail:async()=>{reads++;return {connected:true,message:fixture};},queueFactory: opts=>createQueue({...opts,now:()=>now})});
 const owner='traveler@example.invalid',scope={headers:{host:env.VERCEL_BRANCH_URL}};
 await run.prepare(owner,{headers:{host:'everyday.vercel.app'}});
 assert.equal(queueDB.size,0);
 assert.deepEqual(await run.sync(owner,null,{headers:{host:'everyday.vercel.app'}}),{status:'not_enabled'});
 await run.prepare(owner,scope);
 assert.deepEqual(await run.sync(owner,null,scope),{status:'pending',completed:0});
 assert.equal(tripDB.size,0);
 now+=1000;failFiles=false;
 await run.prepare(owner,scope);
 assert.deepEqual(await run.sync(owner,null,scope),{status:'checked',completed:1});
 await run.prepare(owner,scope);
 assert.deepEqual(await run.sync(owner,null,scope),{status:'checked',completed:0});
 assert.equal(reads,2);
 assert.equal(tripDB.size,2);
 assert.ok(!JSON.stringify([...queueDB.values()]).includes(id));
});
