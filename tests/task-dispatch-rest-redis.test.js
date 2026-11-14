'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),run=promisify(execFile);
const {createPreviewProof,BRANCH}=require('../lib/task-execution/preview-proof.cjs');
const {SCHEDULE_BRANCH}=require('../lib/task-execution/preview-proof.cjs');
const {createScheduleProof,NAME,EXPRESSION,PROJECT}=require('../lib/task-execution/schedule-transport.cjs');
const {schedulePlatformFixture}=require('./helpers/schedule-platform-fixture.cjs');
test('disposable Redis persists the composed pilot across REST transports and keeps notice/owner scopes separate',{skip:!process.env.JAMES_TEST_REDIS_BIN,timeout:30000},async()=>{
 const binary=process.env.JAMES_TEST_REDIS_BIN,cli=path.join(path.dirname(binary),'redis-cli'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'james-dispatch-rest-'));
 const probe=require('node:net').createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(binary,['--bind','127.0.0.1','--port',String(port),'--save','','--appendonly','no','--dir',dir],{stdio:['ignore','pipe','pipe']});let server;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Redis startup timeout')),10000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Redis exited'));});child.stdout.on('data',value=>{if(/ready to accept connections/i.test(value.toString())){clearTimeout(timer);resolve();}});});
  const redis=async parts=>JSON.parse((await run(cli,['-h','127.0.0.1','-p',String(port),'--json',...parts.map(String)])).stdout);
  server=http.createServer((req,res)=>{let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',async()=>{
   try{
    assert.equal(req.headers.authorization,'Bearer synthetic-dispatch-test');const parts=JSON.parse(raw);
    assert.ok(['GET','EVAL'].includes(parts[0]));assert.match(parts[parts[0]==='GET'?1:3],/^james:task-(?:execution|dispatch|notifications|proof-control):v1:[a-f0-9]{64}$/);
    const result=await redis(parts);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));
   }catch{res.statusCode=503;res.end('{}');}
  });});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:BRANCH,JAMES_HOSTED_PROOF_ENABLED:'true',JAMES_HOSTED_PROOF_ID:'redis-fixture',JAMES_HOSTED_PROOF_START_AT:'1000',JAMES_HOSTED_PROOF_END_AT:'20000',KV_REST_API_URL:'http://127.0.0.1:'+server.address().port,KV_REST_API_TOKEN:'synthetic-dispatch-test'};
  const make=(owner='fictional-redis-a')=>createPreviewProof({env,owner,now:()=>1000});
  await make().tick();const before=await make().status();assert.deepEqual(before.tasks.map(t=>t.status).sort(),['blocked','completed']);assert.equal(before.notifications.length,1);
  await make().tick();assert.deepEqual((await make().status()).tasks,before.tasks);assert.equal((await make('fictional-redis-b').status()).tasks.length,0);
  await make().resumeFollowup();await make().tick();const completed=await make().status();assert.ok(completed.tasks.every(t=>t.status==='completed'));assert.equal(completed.notifications.length,2);assert.ok(completed.notifications.every(n=>n.state==='queued'));
  await make().stop();assert.ok((await make().status()).occurrences.every(r=>r.revoked));
  const keys=await redis(['KEYS','*']);assert.equal(keys.length,3);assert.ok(keys.every(k=>/^james:task-(?:execution|dispatch|notifications):v1:[a-f0-9]{64}$/.test(k)));
  // Exercise scheduler admission CAS against actual Redis, including two
  // independent transports racing to claim the same provider execution.
  let at=780000;const scheduledEnv={...env,VERCEL_GIT_COMMIT_REF:SCHEDULE_BRANCH,VERCEL_PROJECT_ID:PROJECT,VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),JAMES_HOSTED_PROOF_APPROVED_HEAD:'a'.repeat(40),JAMES_HOSTED_SCHEDULE_ENABLED:'true',JAMES_HOSTED_PROOF_ID:'schedule-redis',JAMES_HOSTED_PROOF_SCHEDULE_ID:'schedule-fixture',JAMES_HOSTED_PROOF_START_AT:'780000',JAMES_HOSTED_PROOF_END_AT:'2580000',KV_REST_API_URL:'https://fictional-storage.example.test'};
  const platform=schedulePlatformFixture(2580000,()=>at).platform;
  const makeScheduled=()=>createScheduleProof({env:scheduledEnv,owner:'fictional-redis-a',now:()=>at,platform,fetchImpl:async(url,options)=>{assert.equal(url,scheduledEnv.KV_REST_API_URL);return fetch(env.KV_REST_API_URL,options);}});
  const event={name:NAME,namespace:'default',source:'static',expression:EXPRESSION,scheduleId:'schedule-fixture',executionId:'redis-run-one',scheduledAt:new Date(900000)};
  await makeScheduled().arm();at=900000;
  const race=await Promise.all([makeScheduled().run(event),makeScheduled().run(event)]);
  assert.equal(race.filter(r=>r.status==='checked').length,1);assert.equal(race.filter(r=>r.status==='duplicate_or_busy').length,1);
  const scheduled=await makeScheduled().status();assert.equal(scheduled.tasks.length,2);assert.equal(scheduled.runs[0].attempts,1);assert.equal(scheduled.notifications.length,1);assert.equal(scheduled.notifications[0].hasReceipt,false);
  await makeScheduled().stop();at=1800000;assert.equal((await makeScheduled().run({...event,executionId:'redis-run-two',scheduledAt:new Date(at)})).status,'not_armed');
  assert.equal((await redis(['KEYS','*'])).length,7);
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});await assert.rejects(()=>make().status(),/TASK_STORAGE_UNAVAILABLE/);
 }finally{
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
