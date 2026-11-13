'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createLedger}=require('../lib/task-execution/ledger.cjs');
const {createWorker}=require('../lib/task-execution/worker.cjs');
const {createTriggers}=require('../lib/task-execution/triggers.cjs');
const {createDispatcher}=require('../lib/task-execution/dispatcher.cjs');
const {createNotificationOutbox}=require('../lib/task-execution/notification-outbox.cjs');
const {scopedDispatchKey}=require('../lib/task-execution/dispatch-store.cjs');
const fixture=require('./fixtures/task-execution/inputs.json');
function harness(){const values=new Map();let at=100000;const ports={read:async key=>values.get(key)??null,compareAndSwap:async(key,old,next)=>{if((values.get(key)??null)!==old)return false;values.set(key,next);return true;},now:()=>at};const ledger=createLedger(ports),triggers=createTriggers(ports),outbox=createNotificationOutbox({...ports,retryDelayMs:10});return {values,ports,ledger,triggers,outbox,advance:ms=>at+=ms};}
const registration=(id,overrides={})=>({id,version:1,at:100100,timeZone:'America/Los_Angeles',enabled:true,command:{kind:'agenda_fixture',objective:'Fictional agenda '+id,input:fixture.agenda,budget:fixture.budget,requiresApproval:false},...overrides});
const error=code=>e=>e.code===code;
test('scheduled registrations are due once, owner scoped, exact replayed and permanently revocable',async()=>{
 const h=harness(),r=registration('one');const first=await h.triggers.register('owner-a',r);assert.equal(first.replayed,false);assert.equal((await h.triggers.register('owner-a',r)).replayed,true);
 assert.equal((await h.triggers.snapshot('owner-b')).records.length,0);
 await assert.rejects(()=>h.triggers.register('owner-a',{...r,at:r.at+1}),error('REGISTRATION_REUSED'));
 await assert.rejects(()=>h.triggers.register('owner-a',{...r,owner:'owner-b'}),error('INVALID_REGISTRATION'));
 await assert.rejects(()=>h.triggers.register('owner-a',{...r,id:'bad',command:{...r.command,kind:'email_send'}}),error('PREPARATION_ONLY'));
 assert.equal(await h.triggers.claim('owner-a','one:1',{leaseMs:1000,maxAttempts:4}),null);h.advance(101);
 const claim=await h.triggers.claim('owner-a','one:1',{leaseMs:1000,maxAttempts:4});assert.equal(claim.attempts,1);
 await h.triggers.revoke('owner-a','one');assert.equal(await h.triggers.current('owner-a',claim),false);assert.equal((await h.triggers.finish('owner-a',claim,'completed')).status,'superseded');
 await assert.rejects(()=>h.triggers.register('owner-a',{...r,version:2}),error('REGISTRATION_REVOKED'));
 assert.equal((await h.triggers.register('owner-a',r)).occurrence.state,'cancelled');
});
test('two independent tasks progress concurrently and a blocked task can resume with changed input version',async()=>{
 const h=harness();let release;const gate=new Promise(resolve=>release=resolve);let entered=0;
 const worker=createWorker({ledger:h.ledger,workerId:'fixture-worker',adapters:{agenda_fixture:async({task})=>{entered++;if(task.input.slow)await gate;return {outcome:'prepared',artifact:{title:task.objective}};},followup_fixture:async({task})=>{if(!task.input.customer)throw Object.assign(Error('missing'),{code:'MISSING_INPUT'});return {outcome:'prepared',artifact:{title:'Fictional draft'}};}}});
 const a=registration('slow',{command:{...registration('slow').command,input:{slow:true}}}),b=registration('blocked',{command:{...registration('blocked').command,kind:'followup_fixture',input:{}}});
 await h.triggers.register('owner',a);const block=await h.triggers.register('owner',b);h.advance(101);
 const dispatcher=createDispatcher({...h,worker,now:h.ports.now,maxTickMs:1000});const ticking=dispatcher.tick('owner');await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(entered,1);assert.equal((await h.ledger.snapshot('owner')).tasks.find(t=>t.id===block.occurrence.taskId).status,'blocked');release();await ticking;
 assert.equal((await h.ledger.snapshot('owner')).tasks.filter(t=>t.status==='completed').length,1);assert.equal((await h.outbox.snapshot('owner')).records.length,1);
 let task=(await h.ledger.snapshot('owner')).tasks.find(t=>t.id===block.occurrence.taskId);await h.ledger.execute('owner',{type:'resume',operationId:'explicit-resume',taskId:task.id,expectedRevision:task.revision,input:{customer:'Alex Example'}});await dispatcher.tick('owner');
 task=(await h.ledger.snapshot('owner')).tasks.find(t=>t.id===task.id);assert.equal(task.status,'completed');assert.equal(task.inputVersion,2);assert.equal((await h.outbox.snapshot('owner')).records.length,2);
 await dispatcher.tick('owner');assert.equal((await h.ledger.snapshot('owner')).tasks.length,2);assert.equal((await h.outbox.snapshot('owner')).records.length,2);
});
test('expired dispatcher leases fence stale completion and deterministic create receipts reconcile lost ACK',async()=>{
 const h=harness();const r=await h.triggers.register('owner',registration('lost'));h.advance(101);let drop=true;
 const ledger={...h.ledger,execute:async(...args)=>{const result=await h.ledger.execute(...args);if(drop&&args[1].type==='create'){drop=false;throw Error('lost ACK');}return result;}};
 const worker=createWorker({ledger:h.ledger,workerId:'worker',adapters:{agenda_fixture:async()=>({outcome:'prepared',artifact:{title:'Fictional agenda'}})}});
 const dispatcher=createDispatcher({...h,ledger,worker,now:h.ports.now,retryDelayMs:10});await dispatcher.tick('owner');assert.equal((await h.ledger.snapshot('owner')).tasks.length,1);h.advance(11);await dispatcher.tick('owner');assert.equal((await h.ledger.snapshot('owner')).tasks[0].status,'completed');
 const q=await h.triggers.register('owner',registration('lease',{at:h.ports.now()}));const old=await h.triggers.claim('owner',q.occurrence.occurrenceId,{leaseMs:500,maxAttempts:3});h.advance(501);const next=await h.triggers.claim('owner',q.occurrence.occurrenceId,{leaseMs:500,maxAttempts:3});assert.ok(next.fence>old.fence);assert.equal((await h.triggers.finish('owner',old,'completed')).status,'superseded');assert.equal(await h.triggers.current('owner',next),true);
});
test('notification unknown outcomes reconcile before any resend and cancellation never erases confirmed delivery',async()=>{
 const h=harness(),m={id:'notice',taskId:'task',inputVersion:1,summary:'Fictional preparation ready'};let sends=0,reconciles=0;
 await h.outbox.enqueue('owner',m);assert.equal((await h.outbox.enqueue('owner',m)).replayed,true);
 await h.outbox.deliver('owner',{send:async()=>{sends++;throw Error('reply lost');},reconcile:async()=>{throw Error('must not reconcile before send');}});
 assert.equal((await h.outbox.snapshot('owner')).records[0].state,'unknown');h.advance(11);
 await h.outbox.deliver('owner',{send:async()=>{sends++;return {status:'delivered'};},reconcile:async id=>{assert.equal(id,'notice');reconciles++;return {status:'delivered',receiptId:'fictional-provider-receipt'};}});
 assert.equal(sends,1);assert.equal(reconciles,1);assert.equal((await h.outbox.snapshot('owner')).records[0].state,'delivered');
 await h.outbox.suppressTask('owner','task');assert.equal((await h.outbox.snapshot('owner')).records[0].state,'delivered');assert.equal((await h.outbox.enqueue('owner',{...m,id:'later'})).status,'suppressed');
});
test('known not-delivered permits a bounded later retry, malformed reconciliation stays unknown and cancellation suppresses pending work',async()=>{
 const h=harness(),m={id:'retry',taskId:'task',inputVersion:1,summary:'Fictional result'};let sends=0;
 await h.outbox.enqueue('owner',m);const notifier={send:async()=>{sends++;return {status:'not_delivered'};},reconcile:async()=>({status:'not_delivered'})};await h.outbox.deliver('owner',notifier);h.advance(11);await h.outbox.deliver('owner',notifier);h.advance(11);await h.outbox.deliver('owner',notifier);h.advance(11);await h.outbox.deliver('owner',notifier);assert.equal(sends,3);assert.equal((await h.outbox.snapshot('owner')).records[0].state,'failed');
 const r=await h.triggers.register('owner',registration('cancel'));const dispatcher=createDispatcher({...h,worker:{run:async()=>assert.fail('cancelled worker cannot run')},now:h.ports.now});assert.equal((await dispatcher.cancel('owner','cancel')).status,'cancelled');h.advance(100);await dispatcher.tick('owner');assert.equal((await h.ledger.snapshot('owner')).tasks.length,0);assert.equal((await h.outbox.enqueue('owner',{id:'cancel-notice',taskId:r.occurrence.taskId,inputVersion:1,summary:'Never send'})).status,'suppressed');
});
test('tampered persisted registration, unavailable store and unbounded inputs fail closed',async()=>{
 const h=harness();await h.triggers.register('owner',registration('one'));const key=scopedDispatchKey('owner','dispatch'),d=JSON.parse(h.values.get(key));d.records[0].command.input={changed:true};h.values.set(key,JSON.stringify(d));await assert.rejects(()=>h.triggers.snapshot('owner'),error('CORRUPT_DISPATCH_STORE'));
 const unavailable=createTriggers({read:async()=>{throw Error('storage unavailable');},compareAndSwap:async()=>false});await assert.rejects(()=>unavailable.snapshot('owner'),/storage unavailable/);
 await assert.rejects(()=>h.triggers.register('owner',registration('bad',{timeZone:'not/a/timezone'})),error('INVALID_TIMEZONE'));
 await assert.rejects(()=>h.triggers.register('owner',registration('paid',{command:{...registration('paid').command,budget:{...fixture.budget,maxCostMicros:1}}})),error('PREPARATION_ONLY'));
});
test('missing notification receipts and failed reconciliation never manufacture a delivery',async()=>{
 const h=harness(),m={id:'receipt-check',taskId:'task',inputVersion:1,summary:'Fictional result'};await h.outbox.enqueue('owner',m);let sendCount=0;
 await h.outbox.deliver('owner',{send:async()=>{sendCount++;return {status:'delivered'};},reconcile:async()=>({status:'not_delivered'})});assert.equal((await h.outbox.snapshot('owner')).records[0].state,'unknown');
 h.advance(11);await h.outbox.deliver('owner',{send:async()=>assert.fail('must reconcile first'),reconcile:async()=>({status:'delivered',receiptId:''})});assert.equal((await h.outbox.snapshot('owner')).records[0].state,'unknown');
 h.advance(11);await h.outbox.deliver('owner',{send:async()=>assert.fail('must reconcile first'),reconcile:async()=>({status:'unknown'})});h.advance(11);await h.outbox.deliver('owner',{send:async()=>assert.fail('budget must stop'),reconcile:async()=>assert.fail('budget must stop')});assert.equal(sendCount,1);assert.equal((await h.outbox.snapshot('owner')).records[0].attempts,3);assert.equal((await h.outbox.snapshot('owner')).records[0].state,'unknown');
 const corrupt=JSON.parse(h.values.get(scopedDispatchKey('owner','notifications')));corrupt.records[0].summary='Changed';h.values.set(scopedDispatchKey('owner','notifications'),JSON.stringify(corrupt));await assert.rejects(()=>h.outbox.snapshot('owner'),error('CORRUPT_DISPATCH_STORE'));
});
test('dispatch wait deadline is bounded while the underlying adapter must cooperate',async()=>{
 const h=harness();await h.triggers.register('owner',registration('timeout'));h.advance(101);let aborted=false;
 const slow=createDispatcher({...h,now:h.ports.now,maxTickMs:20,retryDelayMs:10,worker:{run:async(_owner,_id,{signal})=>{signal.addEventListener('abort',()=>aborted=true);await new Promise(()=>{});}}});
 const started=Date.now();await slow.tick('owner');assert.equal(aborted,true);assert.ok(Date.now()-started<500);assert.equal((await h.triggers.snapshot('owner')).records[0].state,'retry');
});
test('expired notification send is reconciled by a new outbox instance and its late reply is fenced',async()=>{
 const h=harness(),m={id:'slow-notice',taskId:'task',inputVersion:1,summary:'Fictional result'};await h.outbox.enqueue('owner',m);let release;
 const slow=h.outbox.deliver('owner',{send:async()=>new Promise(resolve=>release=resolve),reconcile:async()=>assert.fail('first send')});await new Promise(resolve=>setImmediate(resolve));h.advance(3001);
 const restored=createNotificationOutbox({...h.ports,retryDelayMs:10});await restored.deliver('owner',{send:async()=>assert.fail('expired send must reconcile'),reconcile:async()=>({status:'delivered',receiptId:'authoritative-fictional-receipt'})});
 const before=await restored.snapshot('owner');assert.equal(before.records[0].state,'delivered');release({status:'delivered',receiptId:'stale-receipt'});assert.equal((await slow)[0].status,'superseded');assert.equal((await restored.snapshot('owner')).records[0].receiptDigest,before.records[0].receiptDigest);
});
test('notification enqueue outage is independent of later preparation dispatch',async()=>{
 const h=harness(),worker=createWorker({ledger:h.ledger,workerId:'worker',adapters:{agenda_fixture:async()=>({outcome:'prepared',artifact:{title:'Fictional agenda'}})}}),brokenOutbox={...h.outbox,enqueue:async()=>{throw Error('notification store unavailable');}};
 const dispatcher=createDispatcher({...h,outbox:brokenOutbox,worker,now:h.ports.now});await h.triggers.register('owner',registration('one'));h.advance(101);await dispatcher.tick('owner');
 await h.triggers.register('owner',registration('two',{at:h.ports.now()}));const result=await dispatcher.tick('owner');assert.equal((await h.ledger.snapshot('owner')).tasks.filter(t=>t.status==='completed').length,2);assert.ok(result.notifications.some(n=>n.status==='unavailable'));assert.equal((await h.outbox.snapshot('owner')).records.length,0);
});
test('notification-store outage neither reopens settled cancellation nor blocks unrelated preparation, and late task cancellation stays pending until suppression verifies',async()=>{
 const h=harness(),normalWorker=createWorker({ledger:h.ledger,workerId:'worker',adapters:{agenda_fixture:async()=>({outcome:'prepared',artifact:{title:'Fictional agenda'}})}}),dispatcher=createDispatcher({...h,worker:normalWorker,now:h.ports.now});
 await h.triggers.register('owner',registration('settled'));assert.equal((await dispatcher.cancel('owner','settled')).status,'cancelled');
 let notificationDown=true;const brokenOutbox=createNotificationOutbox({...h.ports,read:async key=>{if(notificationDown&&key.includes('task-notifications'))throw Error('notification store unavailable');return h.ports.read(key);}});
 await h.triggers.register('owner',registration('independent'));h.advance(101);const isolated=createDispatcher({...h,outbox:brokenOutbox,worker:normalWorker,now:h.ports.now});await isolated.tick('owner');assert.equal((await h.ledger.snapshot('owner')).tasks.filter(t=>t.status==='completed').length,1);
 const late=await h.triggers.register('owner',registration('late',{at:h.ports.now()}));await h.triggers.claim('owner',late.occurrence.occurrenceId,{leaseMs:1000,maxAttempts:4});
 const cancel=await isolated.cancel('owner','late');assert.equal(cancel.status,'reconcile_required');assert.equal((await h.triggers.snapshot('owner')).records.find(r=>r.id==='late').cancellationPending,true);
 await h.ledger.execute('owner',late.occurrence.command);const tick=await isolated.tick('owner');assert.equal((await h.ledger.snapshot('owner')).tasks.find(t=>t.id===late.occurrence.taskId).status,'cancelled');assert.ok(tick.cancellations.some(c=>c.status==='reconcile_required'&&c.taskStatus==='cancelled'&&c.notificationStatus==='unavailable'));
 notificationDown=false;await isolated.tick('owner');assert.equal((await h.triggers.snapshot('owner')).records.find(r=>r.id==='late').cancellationPending,false);assert.ok((await h.outbox.snapshot('owner')).suppressed.includes(late.occurrence.taskId));
});
test('forged persisted delivery without receipt evidence and positive delivery attempt fails closed',async()=>{
 const h=harness();await h.outbox.enqueue('owner',{id:'forged',taskId:'task',inputVersion:1,summary:'Fictional result'});const key=scopedDispatchKey('owner','notifications'),original=h.values.get(key),d=JSON.parse(original);d.records[0].state='delivered';h.values.set(key,JSON.stringify(d));await assert.rejects(()=>h.outbox.snapshot('owner'),error('CORRUPT_DISPATCH_STORE'));
 d.records[0].receiptDigest='a'.repeat(64);h.values.set(key,JSON.stringify(d));await assert.rejects(()=>h.outbox.snapshot('owner'),error('CORRUPT_DISPATCH_STORE'));
 h.values.set(key,original);await h.outbox.deliver('owner',{send:async()=>({status:'unknown',receiptId:'not-delivery-evidence'}),reconcile:async()=>({status:'unknown'})});assert.equal((await h.outbox.snapshot('owner')).records[0].receiptDigest,null);
});
test('last-attempt worker completion before dispatcher acknowledgement recovers under a new fence without another worker execution',async()=>{
 const h=harness();let executions=0;const worker=createWorker({ledger:h.ledger,workerId:'worker',adapters:{agenda_fixture:async()=>{executions++;return {outcome:'prepared',artifact:{title:'One fictional artifact'}};}}});
 const r=await h.triggers.register('owner',registration('last'));h.advance(101);const lost=await h.triggers.claim('owner',r.occurrence.occurrenceId,{leaseMs:500,maxAttempts:1});await h.ledger.execute('owner',lost.command);assert.equal((await worker.run('owner',lost.taskId)).status,'completed');
 // Crash here: core completion exists, but trigger completion was not recorded.
 h.advance(501);const restored=createDispatcher({...h,worker,now:h.ports.now,maxAttempts:1,leaseMs:500});await restored.tick('owner');const current=(await h.triggers.snapshot('owner')).records[0];assert.equal(current.state,'completed');assert.equal(current.attempts,1);assert.ok(current.fence>lost.fence);assert.equal(executions,1);assert.equal((await h.outbox.snapshot('owner')).records.length,1);
 await restored.tick('owner');assert.equal(executions,1);assert.equal((await h.outbox.snapshot('owner')).records.length,1);
});
test('reconciliation never adopts a matching task created without the deterministic original operation receipt',async()=>{
 const h=harness();const r=await h.triggers.register('owner',registration('foreign-receipt'));h.advance(101);await h.ledger.execute('owner',{...r.occurrence.command,operationId:'different-create-operation'});
 const worker=createWorker({ledger:h.ledger,workerId:'external-fixture',adapters:{agenda_fixture:async()=>({outcome:'prepared',artifact:{title:'Unrelated preparation'}})}});await worker.run('owner',r.occurrence.taskId);
 const dispatcher=createDispatcher({...h,worker:{run:async()=>assert.fail('cannot adopt foreign task')},now:h.ports.now,maxAttempts:1});await dispatcher.tick('owner');assert.equal((await h.triggers.snapshot('owner')).records[0].state,'failed');assert.equal((await h.outbox.snapshot('owner')).records.length,0);
});
test('dispatch and notification audit IDs are unique and duplicated persisted audit evidence fails closed',async()=>{
 const h=harness();await h.triggers.register('owner',registration('audit'));await h.triggers.revoke('owner','audit');const dispatchKey=scopedDispatchKey('owner','dispatch'),d=JSON.parse(h.values.get(dispatchKey));assert.equal(new Set(d.audit.map(a=>a.eventId)).size,d.audit.length);d.audit.push({...d.audit[0]});h.values.set(dispatchKey,JSON.stringify(d));await assert.rejects(()=>h.triggers.snapshot('owner'),error('CORRUPT_DISPATCH_STORE'));
 await h.outbox.enqueue('owner',{id:'audit-notice',taskId:'task',inputVersion:1,summary:'Fictional result'});await h.outbox.suppressTask('owner','task');const noticeKey=scopedDispatchKey('owner','notifications'),n=JSON.parse(h.values.get(noticeKey));assert.equal(new Set(n.audit.map(a=>a.eventId)).size,n.audit.length);n.audit.push({...n.audit[0]});h.values.set(noticeKey,JSON.stringify(n));await assert.rejects(()=>h.outbox.snapshot('owner'),error('CORRUPT_DISPATCH_STORE'));
});
