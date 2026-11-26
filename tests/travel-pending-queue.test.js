'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createQueue,CAS}=require('../lib/travel/pending-queue.cjs');
const owner='fixture@example.invalid',ref={provider:'gmail',messageId:'gmail:fixture-1'};
function harness(options={}){
 let at=1000;const data=new Map();let fail=null;
 const command=async([op,...args])=>{
  if(fail?.(op,args))throw Error('STORAGE_FAILED');
  if(op==='GET')return data.get(args[0])??null;
  assert.equal(op,'EVAL');assert.equal(args[0],CAS);assert.equal(args[1],1);
  const [, ,key,old,next]=args;if((data.get(key)||'')!==old)return 0;data.set(key,next);return 1;
 };
 return {data,command,queue:createQueue({command,environment:'preview',now:()=>at,...options}),advance(n){at+=n;},fail(fn){fail=fn;}};
}
test('enqueue precedes work and dedupes repeat source; completed tombstone prevents replay',async()=>{
 const h=harness();assert.deepEqual(await h.queue.status(owner,'fetch'),{pending:0,running:0,blocked:0,done:0});
 assert.equal((await h.queue.enqueue(owner,'fetch',[ref,ref])).enqueued,1);
 let calls=0;assert.deepEqual(await h.queue.drain(owner,'fetch',async payload=>{calls++;assert.deepEqual(payload,ref);}),{completed:1,failed:0});
 assert.equal((await h.queue.enqueue(owner,'fetch',[ref])).enqueued,0);await h.queue.drain(owner,'fetch',async()=>{calls++;});assert.equal(calls,1);
 const stored=JSON.stringify([...h.data.values()]);assert.ok(!stored.includes('messageId'));assert.ok(!stored.includes('fixture@example.invalid'));
});
test('pending source survives provider failure, bounded backoff then succeeds',async()=>{
 const h=harness();await h.queue.enqueue(owner,'fetch',[ref]);
 assert.deepEqual(await h.queue.drain(owner,'fetch',async()=>{throw Error('private provider detail');}),{completed:0,failed:1});
 let calls=0;await h.queue.drain(owner,'fetch',async()=>{calls++;});assert.equal(calls,0);h.advance(1000);
 await h.queue.drain(owner,'fetch',async()=>{calls++;});assert.equal(calls,1);assert.equal((await h.queue.status(owner,'fetch')).done,1);
 assert.ok(!JSON.stringify([...h.data.values()]).includes('private provider detail'));
});
test('exhausted retry retained blocked and can be explicitly retried',async()=>{
 const h=harness({maxAttempts:2});const {ids}=await h.queue.enqueue(owner,'fetch',[ref]);
 await h.queue.drain(owner,'fetch',async()=>{throw Error();});h.advance(1000);await h.queue.drain(owner,'fetch',async()=>{throw Error();});
 assert.equal((await h.queue.status(owner,'fetch')).blocked,1);assert.ok([...h.data.values()][0].includes('fixture-1'));
 assert.equal(await h.queue.retry(owner,'fetch',ids[0]),true);await h.queue.drain(owner,'fetch',async()=>{});assert.equal((await h.queue.status(owner,'fetch')).done,1);
});
test('enqueue failure throws; caller must not advance mail cursor',async()=>{
 const h=harness();h.fail(()=>true);await assert.rejects(h.queue.enqueue(owner,'fetch',[ref]),/STORAGE_FAILED/);assert.equal(h.data.size,0);
});
test('failed completion commit leaves lease and safely repeats idempotent consumer',async()=>{
 const h=harness({leaseMs:1000});await h.queue.enqueue(owner,'fetch',[ref]);let calls=0;
 await assert.rejects(h.queue.drain(owner,'fetch',async()=>{calls++;h.fail((op)=>op==='EVAL');}),/STORAGE_FAILED/);
 h.fail(null);assert.equal((await h.queue.status(owner,'fetch')).running,1);h.advance(1000);
 await h.queue.drain(owner,'fetch',async()=>{calls++;});assert.equal(calls,2);assert.equal((await h.queue.status(owner,'fetch')).done,1);
});
test('concurrent workers lease one source once',async()=>{
 const h=harness();await h.queue.enqueue(owner,'fetch',[ref]);let calls=0;
 await Promise.all([h.queue.drain(owner,'fetch',async()=>{calls++;}),h.queue.drain(owner,'fetch',async()=>{calls++;})]);assert.equal(calls,1);
});
test('capacity never evicts pending work; atomic batch fails without partial insertion',async()=>{
 const h=harness({maxEntries:2});await h.queue.enqueue(owner,'fetch',[ref]);
 await assert.rejects(h.queue.enqueue(owner,'fetch',[{...ref,messageId:'x2'},{...ref,messageId:'x3'}]),/TRAVEL_QUEUE_CAPACITY/);assert.equal((await h.queue.status(owner,'fetch')).pending,1);
 await h.queue.enqueue(owner,'fetch',[{...ref,messageId:'x2'}]);await h.queue.drain(owner,'fetch',async()=>{}, {limit:1});
 assert.equal((await h.queue.enqueue(owner,'fetch',[{...ref,messageId:'x3'}])).enqueued,1);assert.equal((await h.queue.status(owner,'fetch')).pending,2);
});
test('account, environment and processing stage have separate keys',async()=>{
 const h=harness(),p=createQueue({command:h.command,environment:'production',now:()=>1000});
 await h.queue.enqueue(owner,'fetch',[ref]);await h.queue.enqueue('second@example.invalid','fetch',[ref]);await p.enqueue(owner,'fetch',[ref]);
 await h.queue.enqueue(owner,'upsert',[{id:'a'.repeat(64),at:1000,values:{start:'2026-12-03',destination:'Chicago'}}]);assert.equal(h.data.size,4);
 assert.ok([...h.data.keys()].every(k=>!k.includes('@')));
});
test('no raw mail, extra fields or booking reference accepted',async()=>{
 const h=harness();await assert.rejects(h.queue.enqueue(owner,'fetch',[{...ref,body:'secret'}]),/INVALID_TRAVEL_JOB/);
 await assert.rejects(h.queue.enqueue(owner,'upsert',[{id:'a'.repeat(64),at:1000,bookingReference:'ABCDEF',values:{start:'2026-12-03',destination:'Chicago'}}]),/INVALID_TRAVEL_JOB/);assert.equal(h.data.size,0);
});
test('corrupt stored document fails closed rather than dropping pending work',async()=>{
 const h=harness();await h.queue.enqueue(owner,'fetch',[ref]);const key=[...h.data.keys()][0];h.data.set(key,'bad-json');await assert.rejects(h.queue.drain(owner,'fetch',async()=>{}),/CORRUPT_TRAVEL_QUEUE/);assert.equal(h.data.get(key),'bad-json');
});
test('unknown storage commit is reported without claiming enqueue success',async()=>{
 const queue=createQueue({command:async([op])=>op==='GET'?null:'unexpected',environment:'preview'});
 await assert.rejects(queue.enqueue(owner,'fetch',[ref]),/TRAVEL_QUEUE_COMMIT_UNKNOWN/);
});
test('expired final-attempt lease becomes blocked, retaining source for recovery',async()=>{
 const h=harness({leaseMs:1000,maxAttempts:1});await h.queue.enqueue(owner,'fetch',[ref]);
 await assert.rejects(h.queue.drain(owner,'fetch',async()=>{h.fail(op=>op==='EVAL');}),/STORAGE_FAILED/);h.fail(null);h.advance(1000);
 let called=false;await h.queue.drain(owner,'fetch',async()=>{called=true;});assert.equal(called,false);assert.equal((await h.queue.status(owner,'fetch')).blocked,1);assert.ok([...h.data.values()][0].includes('fixture-1'));
});
