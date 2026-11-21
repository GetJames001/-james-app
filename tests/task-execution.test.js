'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLedger,scopedKey}=require('../lib/task-execution/ledger.cjs');
const {createWorker}=require('../lib/task-execution/worker.cjs');
const fixture=require('./fixtures/task-execution/inputs.json');
function harness(){
 const values=new Map();let clock=100000;
 const ports={read:async key=>values.get(key)??null,compareAndSwap:async(key,old,next)=>{if((values.get(key)??null)!==old)return false;values.set(key,next);return true;}};
 return {ledger:createLedger({...ports,now:()=>clock}),ports,values,advance:ms=>clock+=ms,now:()=>clock};
}
const create=(id='agenda',overrides={})=>({type:'create',operationId:'create-'+id,taskId:id,expectedRevision:0,kind:'agenda_fixture',objective:'Prepare fictional agenda',input:fixture.agenda,budget:fixture.budget,requiresApproval:false,...overrides});
const cmd=(task,type,overrides={})=>({type,operationId:type+'-'+task.id+'-'+task.revision,taskId:task.id,expectedRevision:task.revision,...overrides});
const rejected=code=>error=>error.code===code;
async function claim(h,task,workerId='worker-a'){return (await h.ledger.execute(fixture.owner,cmd(task,'claim',{workerId,leaseMs:1000}))).task;}
const workerCmd=(task,type,overrides={})=>cmd(task,type,{workerId:task.lease.workerId,fence:task.fence,...overrides});
test('owner boundaries and idempotent receipts survive CAS races and lost acknowledgements',async()=>{
 const h=harness(),command=create();const race=await Promise.all([h.ledger.execute(fixture.owner,command),h.ledger.execute(fixture.owner,command)]);
 assert.equal(race.filter(r=>r.replayed).length,1);assert.equal((await h.ledger.snapshot(fixture.owner)).tasks.length,1);
 assert.equal((await h.ledger.snapshot('fictional-owner-b')).tasks.length,0);
 await assert.rejects(()=>h.ledger.execute('fictional-owner-b',cmd(race[0].task,'cancel')),rejected('NOT_FOUND'));
 await assert.rejects(()=>h.ledger.execute(fixture.owner,{...command,objective:'Changed request'}),rejected('OPERATION_REUSED'));
 const before=(await h.ledger.snapshot(fixture.owner)).revision;
 assert.equal((await createLedger(h.ports).execute(fixture.owner,command)).replayed,true);assert.equal((await h.ledger.snapshot(fixture.owner)).revision,before);
 const lost=harness();let drop=true;const ledger=createLedger({...lost.ports,now:lost.now,compareAndSwap:async(...args)=>{const ok=await lost.ports.compareAndSwap(...args);if(ok&&drop){drop=false;throw Error('reply lost');}return ok;}});
 await assert.rejects(()=>ledger.execute(fixture.owner,command),/reply lost/);
 assert.equal((await ledger.execute(fixture.owner,command)).replayed,true);assert.equal((await ledger.snapshot(fixture.owner)).tasks.length,1);
});
test('version conflicts, active leases and expired-worker fencing cannot overwrite current work',async()=>{
 const h=harness();let task=(await h.ledger.execute(fixture.owner,create())).task;
 const old=await claim(h,task);await assert.rejects(()=>claim(h,old,'worker-b'),rejected('LEASE_BUSY'));
 h.advance(1001);task=await claim(h,old,'worker-b');assert.ok(task.fence>old.fence);
 await assert.rejects(()=>h.ledger.execute(fixture.owner,workerCmd({...old,revision:task.revision},'complete',{result:{outcome:'prepared'}})),rejected('STALE_LEASE'));
 await assert.rejects(()=>h.ledger.execute(fixture.owner,workerCmd(old,'checkpoint',{checkpoint:{step:'old'}})),rejected('REVISION_CONFLICT'));
 task=(await h.ledger.execute(fixture.owner,workerCmd(task,'complete',{result:{outcome:'prepared'}}))).task;assert.equal(task.status,'completed');
});
test('a blocked task releases its lease while another task progresses; resume versions its inputs',async()=>{
 const h=harness();let a=(await h.ledger.execute(fixture.owner,create('a'))).task,b=(await h.ledger.execute(fixture.owner,create('b'))).task;
 a=await claim(h,a);a=(await h.ledger.execute(fixture.owner,workerCmd(a,'block',{reason:'missing_input'}))).task;assert.equal(a.lease,null);
 b=await claim(h,b);b=(await h.ledger.execute(fixture.owner,workerCmd(b,'complete',{result:{outcome:'prepared',text:'Fictional agenda ready'}}))).task;
 assert.equal(b.status,'completed');assert.equal((await h.ledger.snapshot(fixture.owner)).tasks.find(t=>t.id==='a').status,'blocked');
 const priorDigest=a.planDigest;a=(await h.ledger.execute(fixture.owner,cmd(a,'resume',{input:{customer:'Alex Example'}}))).task;assert.equal(a.status,'queued');assert.equal(a.inputVersion,2);assert.notEqual(a.planDigest,priorDigest);
});
test('cancellation fences in-flight workers and receipts prevent a repeated cancel from changing state',async()=>{
 const h=harness();let task=await claim(h,(await h.ledger.execute(fixture.owner,create())).task);const old=task;
 const cancel=cmd(task,'cancel');task=(await h.ledger.execute(fixture.owner,cancel)).task;assert.equal(task.status,'cancelled');assert.ok(task.fence>old.fence);
 await assert.rejects(()=>h.ledger.execute(fixture.owner,workerCmd({...old,revision:task.revision},'complete',{result:{outcome:'prepared'}})),rejected('STALE_LEASE'));
 assert.equal((await h.ledger.execute(fixture.owner,cancel)).replayed,true);await assert.rejects(()=>claim(h,task),rejected('NOT_RUNNABLE'));
});
test('approval binds the exact input version and expires before worker progress',async()=>{
 const h=harness();let task=(await h.ledger.execute(fixture.owner,create('review',{requiresApproval:true}))).task;
 await assert.rejects(()=>claim(h,task),rejected('NOT_RUNNABLE'));
 await assert.rejects(()=>h.ledger.execute(fixture.owner,cmd(task,'approve',{planDigest:'a'.repeat(64),expiresAt:h.now()+500})),rejected('INVALID_APPROVAL'));
 const digest=task.planDigest;task=(await h.ledger.execute(fixture.owner,cmd(task,'approve',{planDigest:digest,expiresAt:h.now()+500}))).task;
 task=await claim(h,task);h.advance(501);await assert.rejects(()=>h.ledger.execute(fixture.owner,workerCmd(task,'complete',{result:{outcome:'prepared'}})),rejected('APPROVAL_REQUIRED'));
 task=(await h.ledger.execute(fixture.owner,cmd(task,'pause'))).task;
 task=(await h.ledger.execute(fixture.owner,cmd(task,'resume',{input:{changed:true}}))).task;assert.equal(task.approval,null);assert.equal(task.status,'waiting_for_approval');
 await assert.rejects(()=>h.ledger.execute(fixture.owner,cmd(task,'approve',{planDigest:digest,expiresAt:h.now()+500})),rejected('INVALID_APPROVAL'));
});
test('step, retry, time, concurrency and zero-spend bounds fail before further work',async()=>{
 const h=harness();let task=await claim(h,(await h.ledger.execute(fixture.owner,create('budget',{budget:{...fixture.budget,maxAttempts:1,maxSteps:1,maxDurationMs:1000}}))).task);
 await assert.rejects(()=>h.ledger.execute(fixture.owner,workerCmd(task,'reserve',{costMicros:1})),rejected('BUDGET_EXHAUSTED'));
 task=(await h.ledger.execute(fixture.owner,workerCmd(task,'checkpoint',{checkpoint:{step:'only_step'}}))).task;
 await assert.rejects(()=>h.ledger.execute(fixture.owner,workerCmd(task,'complete',{result:{outcome:'prepared'}})),rejected('BUDGET_EXHAUSTED'));
 h.advance(1001);await assert.rejects(()=>claim(h,task,'retry'),rejected('BUDGET_EXHAUSTED'));
 const c=harness();for(const name of ['one','two'])await claim(c,(await c.ledger.execute(fixture.owner,create(name))).task,name);
 const third=(await c.ledger.execute(fixture.owner,create('three'))).task;await assert.rejects(()=>claim(c,third),rejected('CONCURRENCY_LIMIT'));
});
test('invalid, corrupt and unavailable storage never become empty successful task lists',async()=>{
 const h=harness();await assert.rejects(()=>h.ledger.execute(fixture.owner,{...create(),owner:'another-owner'}),rejected('INVALID_COMMAND'));
 await assert.rejects(()=>h.ledger.execute(fixture.owner,create('huge',{input:{text:'x'.repeat(20000)}})),rejected('INPUT_TOO_LARGE'));
 h.values.set(scopedKey(fixture.owner),'not-json');await assert.rejects(()=>h.ledger.snapshot(fixture.owner),rejected('CORRUPT_LEDGER'));
 const broken=createLedger({read:async()=>{throw Error('store unavailable');},compareAndSwap:async()=>false});await assert.rejects(()=>broken.snapshot(fixture.owner),/store unavailable/);
 const busy=createLedger({read:async()=>null,compareAndSwap:async()=>false});await assert.rejects(()=>busy.execute(fixture.owner,create()),rejected('BUSY_RECONCILE'));
 const tampered=harness();await tampered.ledger.execute(fixture.owner,create());const raw=JSON.parse(tampered.values.get(scopedKey(fixture.owner)));raw.tasks[0].budget.maxAttempts='unlimited';tampered.values.set(scopedKey(fixture.owner),JSON.stringify(raw));await assert.rejects(()=>tampered.ledger.snapshot(fixture.owner),rejected('CORRUPT_LEDGER'));
});
test('active execution time and idempotent checkpoint receipts enforce independent limits',async()=>{
 const h=harness();let task=(await h.ledger.execute(fixture.owner,create('clock',{budget:{...fixture.budget,maxDurationMs:1000}}))).task;
 task=(await h.ledger.execute(fixture.owner,cmd(task,'claim',{workerId:'worker',leaseMs:3000}))).task;
 const checkpoint=workerCmd(task,'checkpoint',{checkpoint:{step:'saved'}});task=(await h.ledger.execute(fixture.owner,checkpoint)).task;
 assert.equal((await h.ledger.execute(fixture.owner,checkpoint)).replayed,true);assert.equal((await h.ledger.snapshot(fixture.owner)).tasks[0].budget.steps,1);
 h.advance(1001);await assert.rejects(()=>h.ledger.execute(fixture.owner,workerCmd(task,'complete',{result:{outcome:'prepared'}})),rejected('BUDGET_EXHAUSTED'));
});
test('worker registry rejects unregistered adapters and never marks failed preparation as completed',async()=>{
 const h=harness();let task=(await h.ledger.execute(fixture.owner,create())).task;
 const unsupported=createWorker({ledger:h.ledger,workerId:'worker',adapters:{}});assert.equal((await unsupported.run(fixture.owner,task.id)).status,'unsupported_kind');
 const worker=createWorker({ledger:h.ledger,workerId:'worker',adapters:{agenda_fixture:async()=>{throw Error('source failed');}}});assert.equal((await worker.run(fixture.owner,task.id)).status,'blocked');
 task=(await h.ledger.snapshot(fixture.owner)).tasks[0];assert.equal(task.result,null);assert.equal(task.blockedReason,'source_unavailable');
});
