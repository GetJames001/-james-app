'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fork,execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),{once}=require('node:events');
const {createLedger}=require('../lib/task-execution/ledger.cjs');
const {openStore}=require('../tools/task-execution-proof/store.cjs');
const fixture=require('./fixtures/task-execution/inputs.json');
function startWorker(filename,taskId,workerId,mode='finish'){
 const child=fork(path.join(__dirname,'../tools/task-execution-proof/worker.cjs'),[filename,fixture.owner,taskId,workerId,mode],{stdio:['ignore','ignore','pipe','ipc']});
 const events=[];let closed=false;
 child.on('message',event=>events.push(event));child.on('exit',()=>{closed=true;});
 return {child,events,wait(event){return new Promise((resolve,reject)=>{
  const found=events.find(e=>e.event===event);if(found)return resolve(found);
  const timer=setTimeout(()=>done(Error('Proof worker timed out: '+event)),15000);
  function done(error,value){clearTimeout(timer);child.off('message',message);child.off('exit',exit);error?reject(error):resolve(value);}
  function message(value){if(value.event===event)done(null,value);else if(value.event==='failed')done(Error(value.reason));}
  function exit(code){done(Error('Proof worker exited before '+event+': '+code));}
  if(closed)return done(Error('Proof worker already exited'));
  child.on('message',message);child.once('exit',exit);
 });}};
}
test('separate workers survive forced process death while blocked work, receipts and second-client results persist',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'james-task-proof-')),filename=path.join(dir,'fictional.sqlite'),store=openStore(filename),ledger=createLedger(store),children=[];
 const create=(taskId,kind,input)=>({type:'create',operationId:'create-'+taskId,taskId,expectedRevision:0,kind,objective:'Fictional preparation only',input,budget:fixture.budget,requiresApproval:false});
 const agenda=create('agenda','agenda_fixture',fixture.agenda),followup=create('followup','followup_fixture',fixture.followupMissing);
 try{
  await ledger.execute(fixture.owner,agenda);await ledger.execute(fixture.owner,followup);
  const first=startWorker(filename,'agenda','worker-before-crash','hold_after_artifact');children.push(first.child);await first.wait('artifact_written');
  const second=startWorker(filename,'followup','worker-independent');children.push(second.child);assert.equal((await second.wait('finished')).status,'blocked');
  let snapshot=await ledger.snapshot(fixture.owner),a=snapshot.tasks.find(t=>t.id==='agenda'),b=snapshot.tasks.find(t=>t.id==='followup');
  assert.equal(a.status,'running');assert.equal(a.checkpoint.step,'input_checked');assert.equal(b.status,'blocked');assert.equal(b.blockedReason,'missing_input');assert.equal(store.artifactCount(),1);
  const oldFence=a.fence,stopped=once(first.child,'exit');first.child.kill('SIGKILL');await stopped;
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,a.lease.expiresAt-Date.now()+30)));
  const restarted=startWorker(filename,'agenda','worker-after-restart');children.push(restarted.child);assert.equal((await restarted.wait('finished')).status,'completed');assert.ok(restarted.events.some(e=>e.event==='artifact_reconciled'));
  snapshot=await ledger.snapshot(fixture.owner);a=snapshot.tasks.find(t=>t.id==='agenda');b=snapshot.tasks.find(t=>t.id==='followup');
  assert.equal(a.status,'completed');assert.equal(b.status,'blocked','blocked follow-up did not stop agenda completion');assert.ok(a.fence>oldFence);assert.equal(store.artifactCount(),1,'lost worker acknowledgement did not duplicate the artifact');
  const client=path.join(__dirname,'../tools/task-execution-proof/client.cjs');
  const otherClient=JSON.parse((await run(process.execPath,[client,filename,fixture.owner])).stdout);
  assert.equal(otherClient.tasks.find(t=>t.id==='agenda').status,'completed');assert.equal(otherClient.tasks.find(t=>t.id==='followup').status,'blocked');
  const wrongOwner=JSON.parse((await run(process.execPath,[client,filename,'fictional-owner-b'])).stdout);assert.deepEqual(wrongOwner.tasks,[]);
  await ledger.execute(fixture.owner,{type:'resume',operationId:'supply-fictional-input',taskId:b.id,expectedRevision:b.revision,input:fixture.followupReady});
  const resumed=startWorker(filename,'followup','worker-followup-resumed'),duplicate=startWorker(filename,'followup','worker-duplicate-dispatch');children.push(resumed.child,duplicate.child);
  const results=await Promise.all([resumed.wait('finished'),duplicate.wait('finished')]);assert.equal(results.filter(r=>r.status==='completed').length,1,'duplicate worker dispatch cannot complete the same task twice');
  assert.equal((await ledger.execute(fixture.owner,agenda)).replayed,true);assert.equal((await ledger.execute(fixture.owner,followup)).replayed,true);
  assert.equal(store.artifactCount(),2);snapshot=await ledger.snapshot(fixture.owner);assert.equal(snapshot.tasks.length,2);assert.ok(snapshot.tasks.every(t=>t.status==='completed'&&t.result.outcome==='prepared'));
  assert.ok(snapshot.tasks.every(t=>t.budget.reservedCostMicros===0));
  console.log('TASK_PROOF_EVIDENCE',JSON.stringify({tasks:2,blockedTaskIndependent:true,forcedWorkerDeath:true,restartRecovered:true,lostReplyReconciled:true,artifacts:2,duplicateCommandsReplayed:true,separateProcessRead:true,wrongOwnerEmpty:true,providerCalls:0,actualDeviceTest:false,hostedSchedulerTest:false}));
 }finally{
  await Promise.all(children.map(async child=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}));
  store.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});
