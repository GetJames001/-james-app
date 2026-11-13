'use strict';
// Lead-owned independent checks. Builder tests cover its own implementation;
// these use separate stores/processes and exercise the published contracts.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{fork}=require('node:child_process');
const {createLedger}=require('../lib/task-execution/ledger.cjs');
const {createWorker}=require('../lib/task-execution/worker.cjs');
const {createTriggers}=require('../lib/task-execution/triggers.cjs');
const {createDispatcher}=require('../lib/task-execution/dispatcher.cjs');
const {createNotificationOutbox}=require('../lib/task-execution/notification-outbox.cjs');
const {openStore}=require('../tools/task-execution-proof/store.cjs');
const fixture=require('./fixtures/task-execution/inputs.json');
function memory(){const map=new Map();return{map,read:async key=>map.get(key)??null,compareAndSwap:async(key,old,next)=>{if((map.get(key)??null)!==old)return false;map.set(key,next);return true;}};}
function registration(id,at=1000,kind='agenda_fixture',input=fixture.agenda){return{id,version:1,at,timeZone:'America/Los_Angeles',enabled:true,command:{kind,objective:'Fictional scheduled '+id,input,budget:fixture.budget,requiresApproval:false}};}
test('lead: due occurrences isolate blocked work, preserve current results on duplicate trigger, and respect owner boundaries',async()=>{
 const store=memory();let at=999,artifacts=0;const now=()=>at,ledger=createLedger({...store,now}),triggers=createTriggers({...store,now}),outbox=createNotificationOutbox({...store,now});
 const adapter=async({task})=>{if(task.kind==='followup_fixture')throw Object.assign(Error('missing'),{code:'MISSING_INPUT'});artifacts++;return{outcome:'prepared',artifact:{text:'Fictional result'}};};
 const worker=createWorker({ledger,workerId:'lead-qa',adapters:{agenda_fixture:adapter,followup_fixture:adapter}}),dispatcher=createDispatcher({triggers,ledger,worker,outbox,now});
 await triggers.register('qa-a',registration('agenda'));await triggers.register('qa-a',registration('followup',1000,'followup_fixture',{}));
 await dispatcher.tick('qa-a');assert.equal((await ledger.snapshot('qa-a')).tasks.length,0,'future occurrence must not run early');
 at=1000;await dispatcher.tick('qa-a');const before=await ledger.snapshot('qa-a');assert.equal(before.tasks.length,2);assert.deepEqual(before.tasks.map(t=>t.status).sort(),['blocked','completed']);assert.equal(artifacts,1);
 await triggers.register('qa-a',registration('agenda'));await dispatcher.tick('qa-a');assert.equal(artifacts,1);assert.deepEqual((await ledger.snapshot('qa-a')).tasks,before.tasks);
 assert.equal((await ledger.snapshot('qa-b')).tasks.length,0);assert.equal((await triggers.snapshot('qa-b')).records.length,0);assert.equal((await outbox.snapshot('qa-b')).records.length,0);
 assert.ok([...store.map.keys()].every(k=>/^james:task-(?:execution|dispatch|notifications):v1:[a-f0-9]{64}$/.test(k)),'isolated namespaces only');
});
test('lead: committed create with lost acknowledgement reconciles without resetting or duplicating the task',async()=>{
 const base=memory();let lost=true,at=1000,runs=0;
 const ledger=createLedger({read:base.read,compareAndSwap:async(key,old,next)=>{const committed=await base.compareAndSwap(key,old,next);if(committed&&lost){lost=false;throw Error('lost write response');}return committed;},now:()=>at});
 const triggers=createTriggers({...base,now:()=>at}),outbox=createNotificationOutbox({...base,now:()=>at}),worker=createWorker({ledger,workerId:'lost-ack-worker',adapters:{agenda_fixture:async()=>{runs++;return{outcome:'prepared',artifact:{text:'One preparation'}};}}}),dispatcher=createDispatcher({ledger,triggers,worker,outbox,now:()=>at,retryDelayMs:1000});
 await triggers.register('qa-owner',registration('lost-ack'));await dispatcher.tick('qa-owner');assert.equal((await ledger.snapshot('qa-owner')).tasks.length,1);
 at+=1001;await dispatcher.tick('qa-owner');assert.equal((await ledger.snapshot('qa-owner')).tasks.length,1);assert.equal((await ledger.snapshot('qa-owner')).tasks[0].status,'completed');assert.equal(runs,1);
});
test('lead: unknown notification outcomes reconcile before resend and cancellation tombstone blocks late enqueue',async()=>{
 const store=memory();let at=1000,sends=0,reconciles=0;const make=()=>createNotificationOutbox({...store,now:()=>at,retryDelayMs:1000});let outbox=make();
 const message={id:'notification-one',taskId:'task-one',inputVersion:1,summary:'Fictional preparation is ready'};await outbox.enqueue('qa-owner',message);
 await outbox.deliver('qa-owner',{send:async()=>{sends++;throw Error('reply lost');},reconcile:async()=>{throw Error('must not reconcile a new send');}});
 assert.equal((await outbox.snapshot('qa-owner')).records[0].state,'unknown');at+=1001;outbox=make();
 await outbox.deliver('qa-owner',{send:async()=>{sends++;return{status:'delivered'};},reconcile:async id=>{assert.equal(id,message.id);reconciles++;return{status:'delivered',receiptId:'fictional-provider-receipt'};}});
 assert.equal(sends,1);assert.equal(reconciles,1);assert.equal((await outbox.snapshot('qa-owner')).records[0].state,'delivered');
 await outbox.suppressTask('qa-owner','task-cancelled');await outbox.enqueue('qa-owner',{...message,id:'late-notification',taskId:'task-cancelled'}).catch(()=>{});
 await outbox.deliver('qa-owner',{send:async()=>{sends++;return{status:'delivered'};},reconcile:async()=>({status:'unknown'})});assert.equal(sends,1,'cancelled work cannot create a late notification');
});
test('lead: cancellation racing a delayed create leaves no runnable preparation or notification',async()=>{
 const store=memory(),base=createLedger(store),triggers=createTriggers(store),outbox=createNotificationOutbox(store);let release,entered,runs=0;
 const wait=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const ledger={snapshot:base.snapshot,execute:async(owner,command)=>{if(command.type==='create'){entered();await wait;}return base.execute(owner,command);}};
 const worker=createWorker({ledger,workerId:'cancel-race-worker',adapters:{agenda_fixture:async()=>{runs++;return{outcome:'prepared',artifact:{text:'must not run'}};}}}),dispatcher=createDispatcher({ledger,triggers,worker,outbox,maxTickMs:5000});
 await triggers.register('qa-owner',registration('cancel-race',Date.now()));const pending=dispatcher.tick('qa-owner');await started;await dispatcher.cancel('qa-owner','cancel-race');release();await pending;await dispatcher.tick('qa-owner');
 const tasks=(await ledger.snapshot('qa-owner')).tasks;assert.equal(tasks.length,1);assert.equal(tasks[0].status,'cancelled');assert.equal(runs,0);assert.equal((await outbox.snapshot('qa-owner')).records.length,0);
});
test('lead: notification outage during historical cancellation reconciliation cannot freeze unrelated preparation',async()=>{
 const base=memory();let unavailable=false,runs=0;
 const store={compareAndSwap:base.compareAndSwap,read:async key=>{if(unavailable&&key.startsWith('james:task-notifications:'))throw Error('notification store unavailable');return base.read(key);}},ledger=createLedger(store),triggers=createTriggers(store),outbox=createNotificationOutbox(store);
 const worker=createWorker({ledger,workerId:'outage-independent-worker',adapters:{agenda_fixture:async()=>{runs++;return{outcome:'prepared',artifact:{text:'Unrelated work completed'}};}}}),dispatcher=createDispatcher({ledger,triggers,worker,outbox});
 await triggers.register('qa-owner',registration('historical-cancel',Date.now()));await dispatcher.cancel('qa-owner','historical-cancel');await triggers.register('qa-owner',registration('independent',Date.now()));unavailable=true;
 await assert.doesNotReject(()=>dispatcher.tick('qa-owner'));assert.equal(runs,1);assert.equal((await ledger.snapshot('qa-owner')).tasks[0].status,'completed');
});
test('lead: persisted delivery without a receipt is corruption rather than confirmed notification',async()=>{
 const store=memory(),outbox=createNotificationOutbox(store);await outbox.enqueue('qa-owner',{id:'receipt-required',taskId:'task-one',inputVersion:1,summary:'Fictional result'});
 const key=[...store.map.keys()].find(k=>k.startsWith('james:task-notifications:')),raw=JSON.parse(store.map.get(key));raw.records[0].state='delivered';store.map.set(key,JSON.stringify(raw));
 await assert.rejects(()=>outbox.snapshot('qa-owner'),/CORRUPT_DISPATCH_STORE/);
});
test('lead: final-attempt crash reconciles authoritative completion and queues its notification without another execution',async()=>{
 const store=memory();let at=1000,runs=0;const ports={...store,now:()=>at},ledger=createLedger(ports),triggers=createTriggers(ports),outbox=createNotificationOutbox(ports),owner='qa-owner';
 const registered=await triggers.register(owner,registration('last-attempt')),claimed=await triggers.claim(owner,registered.occurrence.occurrenceId,{leaseMs:500,maxAttempts:1});await ledger.execute(owner,claimed.command);
 const worker=createWorker({ledger,workerId:'last-attempt-worker',adapters:{agenda_fixture:async()=>{runs++;return{outcome:'prepared',artifact:{text:'Authoritative completed result'}};}}});await worker.run(owner,claimed.taskId);
 at+=501;await createDispatcher({ledger,triggers,worker,outbox,now:()=>at,maxAttempts:1}).tick(owner);
 assert.equal((await triggers.snapshot(owner)).records[0].state,'completed');assert.equal((await ledger.snapshot(owner)).tasks[0].status,'completed');assert.equal(runs,1);assert.equal((await outbox.snapshot(owner)).records.length,1);
});
test('lead: scheduled dispatch survives real worker process death and recovers one persisted artifact without a browser',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'james-dispatch-independent-')),filename=path.join(dir,'proof.sqlite'),owner='fictional-dispatch-owner',store=openStore(filename),children=[];
 const ledger=createLedger(store),triggers=createTriggers(store),outbox=createNotificationOutbox(store);
 function child(mode,startAt){const worker=fork(path.join(__dirname,'../tools/task-execution-proof/dispatcher-harness.cjs'),[filename,owner,mode,String(startAt)],{stdio:['ignore','ignore','pipe','ipc']});children.push(worker);const events=[];let closed=false;worker.on('message',event=>events.push(event));worker.on('exit',()=>{closed=true;});return{worker,events,closed:()=>closed};}
 async function until(check,timeout=8000){const started=Date.now();while(!await check()){if(Date.now()-started>timeout)throw Error('Independent dispatcher proof timed out');await new Promise(resolve=>setTimeout(resolve,20));}}
 try{
  const startAt=Date.now()+1000;await triggers.register(owner,registration('agenda',startAt));await triggers.register(owner,registration('followup',startAt,'followup_fixture',{}));
  const before=createDispatcher({triggers,ledger,outbox,now:()=>startAt-1,worker:{run:async()=>{throw Error('early execution');}}});await before.tick(owner);assert.equal((await ledger.snapshot(owner)).tasks.length,0);
  const first=child('hold_after_artifact',startAt);await until(()=>first.events.some(e=>e.event==='artifact_written'));assert.ok(first.events.find(e=>e.event==='due_tick').at>=startAt);await until(async()=>(await ledger.snapshot(owner)).tasks.some(t=>t.status==='blocked'));
  first.worker.kill('SIGKILL');await until(first.closed);assert.equal(store.artifactCount(),1);await new Promise(resolve=>setTimeout(resolve,3200));
  const second=child('finish',Date.now());await until(()=>second.events.some(e=>e.event==='finished'||e.event==='failed'));assert.ok(second.events.some(e=>e.event==='finished'));assert.ok(second.events.some(e=>e.event==='artifact_reconciled'));
  const result=await createLedger(store).snapshot(owner);assert.equal(result.tasks.length,2);assert.deepEqual(result.tasks.map(t=>t.status).sort(),['blocked','completed']);assert.equal(store.artifactCount(),1);assert.equal((await outbox.snapshot(owner)).records.length,1);
  const third=child('finish',Date.now());await until(()=>third.events.some(e=>e.event==='finished'));assert.equal(store.artifactCount(),1);assert.equal((await outbox.snapshot(owner)).records.length,1);
  console.log('DISPATCHER_PROCESS_EVIDENCE',JSON.stringify({scheduledAtRespected:true,independentBlockedTask:true,forcedProcessDeath:true,restartRecovered:true,artifacts:1,duplicateTickNoDuplicate:true,durableNotificationQueued:true,providerCalls:0,browserRequired:false,actualDeviceTest:false,hostedSchedulerTest:false}));
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
