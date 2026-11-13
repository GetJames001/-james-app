'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CAS}=require('../lib/customer-activity/storage.cjs');
const {scopedDispatchKey}=require('../lib/task-execution/dispatch-store.cjs');
const {createDispatchStorage}=require('../lib/task-execution/dispatch-rest-storage.cjs');
const {createPreviewProof,BRANCH}=require('../lib/task-execution/preview-proof.cjs');
function rest(){
 const rows=new Map(),calls=[];let lose=false,down=false;
 const fetchImpl=async(url,options)=>{
  assert.equal(url,'https://fictional-kv.example.test');assert.equal(options.headers.Authorization,'Bearer synthetic');
  assert.equal(options.redirect,'error');assert.ok(options.signal);
  if(down)throw Error('private upstream detail');
  const parts=JSON.parse(options.body);calls.push(parts);
  if(parts[0]==='GET')return Response.json({result:rows.get(parts[1])??null});
  assert.equal(parts[0],'EVAL');assert.equal(parts[1],CAS);assert.equal(parts[2],1);
  const previous=parts[4]==='absent'?null:parts[5];
  if((rows.get(parts[3])??null)!==previous)return Response.json({result:0});
  rows.set(parts[3],parts[6]);if(lose){lose=false;throw Error('lost response');}return Response.json({result:1});
 };
 return {rows,calls,fetchImpl,lose:()=>{lose=true;},down:()=>{down=true;}};
}
const options=h=>({url:'https://fictional-kv.example.test',token:'synthetic',fetchImpl:h.fetchImpl});
function env(extra={}){return {VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:BRANCH,JAMES_HOSTED_PROOF_ENABLED:'true',JAMES_HOSTED_PROOF_ID:'fixture-one',JAMES_HOSTED_PROOF_START_AT:'1000',JAMES_HOSTED_PROOF_END_AT:'20000',KV_REST_API_URL:'https://fictional-kv.example.test',KV_REST_API_TOKEN:'synthetic',...extra};}
test('REST dispatch and notification ports are namespace and owner isolated with atomic CAS',async()=>{
 const h=rest(),dispatch=createDispatchStorage({...options(h),kind:'dispatch'}),notices=createDispatchStorage({...options(h),kind:'notifications'});
 const key=scopedDispatchKey('fictional-a','dispatch');
 const race=await Promise.all([dispatch.compareAndSwap(key,null,'{}'),dispatch.compareAndSwap(key,null,'{}')]);
 assert.equal(race.filter(Boolean).length,1);assert.equal(await dispatch.read(key),'{}');
 assert.equal(await dispatch.read(scopedDispatchKey('fictional-b','dispatch')),null);
 for(const forbidden of [key.replace('task-dispatch','task-execution'),'james:tasks',scopedDispatchKey('fictional-a','notifications')])await assert.rejects(()=>dispatch.read(forbidden),/DISPATCH_STORAGE_UNAVAILABLE/);
 await assert.rejects(()=>notices.read(key),/DISPATCH_STORAGE_UNAVAILABLE/);
 assert.equal(await notices.read(scopedDispatchKey('fictional-a','notifications')),null);
});
test('REST ports fail closed on corrupt envelopes, bounded data, outages and ambiguous writes',async()=>{
 const h=rest(),make=()=>createDispatchStorage({...options(h),kind:'dispatch'}),key=scopedDispatchKey('fictional-a','dispatch');
 h.lose();await assert.rejects(()=>make().compareAndSwap(key,null,'{}'),/DISPATCH_STORAGE_UNAVAILABLE/);
 assert.equal(await make().read(key),'{}');assert.equal(await make().compareAndSwap(key,null,'bad'),false);
 await assert.rejects(()=>make().compareAndSwap(key,'{}','x'.repeat(2*1024*1024+1)),/DISPATCH_STORAGE_UNAVAILABLE/);
 for(const body of [{result:[]},{result:false},{error:'private token'},{result:7}])await assert.rejects(()=>createDispatchStorage({...options(h),kind:'dispatch',fetchImpl:async()=>Response.json(body)}).read(key),/^Error: DISPATCH_STORAGE_UNAVAILABLE$/);
 await assert.rejects(()=>createDispatchStorage({...options(h),kind:'dispatch',fetchImpl:async()=>Response.json({result:true})}).compareAndSwap(key,null,'{}'),/DISPATCH_STORAGE_UNAVAILABLE/);
 h.down();await assert.rejects(()=>make().read(key),/^Error: DISPATCH_STORAGE_UNAVAILABLE$/);
});
test('pilot composition rejects Production, other branches, disabled flags and invalid windows before transport',()=>{
 const h=rest();
 for(const change of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'fix/calendar-refresh-diagnosis-20261031'},{JAMES_HOSTED_PROOF_ENABLED:'false'},{JAMES_HOSTED_PROOF_END_AT:'1801001'},{JAMES_HOSTED_PROOF_ID:'../other'}])assert.throws(()=>createPreviewProof({env:env(change),owner:'fictional-a',fetchImpl:h.fetchImpl,now:()=>1000}),/PROOF_DISABLED|INVALID_PROOF_WINDOW/);
 assert.equal(h.calls.length,0);
});
test('fresh server compositions persist independent preparation, block, resume, duplicates and queued notices',async()=>{
 const h=rest();let at=1000;
 const make=(owner='fictional-a',proofId='fixture-one')=>createPreviewProof({env:env({JAMES_HOSTED_PROOF_ID:proofId}),owner,fetchImpl:h.fetchImpl,now:()=>at});
 await make().tick();const first=await make().status();
 assert.deepEqual(first.tasks.map(t=>t.status).sort(),['blocked','completed']);assert.equal(first.notifications.length,1);assert.equal(first.notifications[0].state,'queued');
 await make().tick();assert.deepEqual((await make().status()).tasks,first.tasks);assert.equal((await make().status()).notifications.length,1);
 assert.equal((await make('fictional-b').status()).tasks.length,0);assert.equal((await make('fictional-a','other-pilot').status()).tasks.length,0);
 await make().resumeFollowup();await make().tick();const final=await make().status();
 assert.ok(final.tasks.every(t=>t.status==='completed'&&t.result.outcome==='prepared'));
 assert.equal(final.notifications.length,2);assert.ok(final.notifications.every(n=>n.state==='queued'&&n.receiptDigest===null));
 assert.ok(h.calls.every(c=>/^james:task-(?:execution|dispatch|notifications):v1:[a-f0-9]{64}$/.test(c[c[0]==='GET'?1:3])));
 const before=h.calls.length;at=20000;await assert.rejects(()=>make().tick(),/PROOF_WINDOW_CLOSED/);assert.equal(h.calls.length,before);
 // Stop after expiry remains possible and retains the evidence.
 await make().stop();const stopped=await make().status();assert.ok(stopped.occurrences.every(r=>r.revoked));assert.ok(stopped.notifications.every(n=>n.state==='cancelled'));
});
test('cancelled pilot cannot be reactivated by repeated registration, and storage failure stays unavailable',async()=>{
 const h=rest(),proof=createPreviewProof({env:env(),owner:'fictional-a',fetchImpl:h.fetchImpl,now:()=>1000});
 await proof.register();await proof.stop();await proof.tick();assert.equal((await proof.status()).tasks.length,0);
 h.down();await assert.rejects(()=>proof.status(),/TASK_STORAGE_UNAVAILABLE/);
});
