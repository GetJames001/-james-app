'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CAS}=require('../lib/customer-activity/storage.cjs');
const {createScheduleProof,configuration,NAME,EXPRESSION,PROJECT,MAX_REQUESTS,DEADLINE_MS,boundedTransport}=require('../lib/task-execution/schedule-transport.cjs');
const {SCHEDULE_BRANCH}=require('../lib/task-execution/preview-proof.cjs');
const {createHandler}=require('../api/proof-schedule.js');
const {createHandler:createOwnerHandler}=require('../lib/routes/hosted-proof.js');
const auth=require('../lib/auth.js'),gateway=require('../api/gateway.js');
const HEAD='a'.repeat(40),START=780000,FIRST=900000,END=2580000;
const env=(extra={})=>({VERCEL_ENV:'preview',VERCEL_PROJECT_ID:PROJECT,VERCEL_GIT_COMMIT_REF:SCHEDULE_BRANCH,VERCEL_GIT_COMMIT_SHA:HEAD,JAMES_HOSTED_PROOF_APPROVED_HEAD:HEAD,JAMES_HOSTED_SCHEDULE_ENABLED:'true',JAMES_HOSTED_PROOF_ENABLED:'true',JAMES_HOSTED_PROOF_ID:'fictional-only',JAMES_HOSTED_PROOF_SCHEDULE_ID:'schedule-fixture',JAMES_HOSTED_PROOF_START_AT:String(START),JAMES_HOSTED_PROOF_END_AT:String(END),KV_REST_API_URL:'https://fixture.example.test',KV_REST_API_TOKEN:'synthetic',...extra});
const metadata=(extra={})=>({name:NAME,namespace:'default',source:'static',expression:EXPRESSION,scheduleId:'schedule-fixture',executionId:'run-one',scheduledAt:new Date(FIRST),...extra});
function fixture(){
 const rows=new Map(),calls=[];let at=START,loseControl=false,failEngine=false,hook=null;
 const fetchImpl=async(url,options)=>{
  assert.equal(url,'https://fixture.example.test');assert.equal(options.redirect,'error');assert.ok(options.signal);
  assert.equal(options.headers.Authorization,'Bearer synthetic');
  if(options.signal.aborted)throw Error('aborted');
  const p=JSON.parse(options.body),key=p[p[0]==='GET'?1:3];calls.push(p);
  assert.match(key,/^james:task-(?:execution|dispatch|notifications|proof-control):v1:[a-f0-9]{64}$/);
  if(hook)await hook(p,key);
  if(failEngine&&!key.includes('proof-control'))throw Error('private storage diagnostic');
  if(p[0]==='GET')return Response.json({result:rows.get(key)??null});
  assert.equal(p[0],'EVAL');assert.equal(p[1],CAS);assert.equal(p[2],1);
  const old=p[4]==='absent'?null:p[5];if((rows.get(key)??null)!==old)return Response.json({result:0});
  rows.set(key,p[6]);
  if(loseControl&&key.includes('proof-control')){loseControl=false;throw Error('lost response');}
  return Response.json({result:1});
 };
 return {rows,calls,fetchImpl,make:(owner='fixture-owner',extra={})=>createScheduleProof({env:env(extra),owner,fetchImpl,now:()=>at}),at:value=>at=value,lose:()=>{loseControl=true;},fail:value=>{failEngine=value;},hook:fn=>{hook=fn;}};
}
function res(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
test('transport caps network starts and aborts a stalled operation at the shared deadline',{timeout:15000},async()=>{
 let calls=0;const bounded=boundedTransport(async()=>{calls++;return Response.json({result:null});});
 try{for(let i=0;i<MAX_REQUESTS;i++)await bounded.fetch('https://fictional.example',{});await assert.rejects(()=>bounded.fetch('https://fictional.example',{}),/PROOF_TRANSPORT_LIMIT/);assert.equal(calls,MAX_REQUESTS);}finally{bounded.close();}
 let aborted=false;const stalled=boundedTransport(async(url,{signal})=>new Promise((resolve,reject)=>{const keepAlive=setTimeout(()=>reject(Error('deadline not enforced')),DEADLINE_MS+1500);signal.addEventListener('abort',()=>{aborted=true;clearTimeout(keepAlive);reject(Error('aborted'));},{once:true});}));
 try{await assert.rejects(()=>stalled.fetch('https://fictional.example',{}),/^Error: aborted$/);assert.equal(aborted,true);await assert.rejects(()=>stalled.fetch('https://fictional.example',{}),/PROOF_TRANSPORT_LIMIT/);}finally{stalled.close();}
});
const eventHeaders=()=>({'ce-specversion':'1.0','ce-type':'com.vercel.schedule.v1beta','ce-source':'/schedules/fixture','ce-id':'run-one','ce-vssscheduledat':new Date(FIRST).toISOString(),'ce-vssscheduleid':'schedule-fixture','ce-vssschedulename':NAME,'ce-vssnamespace':'default','ce-vssschedulesource':'static','ce-vssexpression':EXPRESSION});

test('scheduler configuration binds Preview, project, branch, exact approved head and a two-slot window before I/O',()=>{
 const h=fixture();
 for(const extra of [{VERCEL_ENV:'production'},{VERCEL_PROJECT_ID:'other'},{VERCEL_GIT_COMMIT_REF:'main'},{VERCEL_GIT_COMMIT_SHA:'b'.repeat(40)},{JAMES_HOSTED_PROOF_APPROVED_HEAD:''},{JAMES_HOSTED_SCHEDULE_ENABLED:'false'},{JAMES_HOSTED_PROOF_ENABLED:'false'},{JAMES_HOSTED_PROOF_SCHEDULE_ID:''},{JAMES_HOSTED_PROOF_ID:'../real'},{JAMES_HOSTED_PROOF_END_AT:String(END+1)},{JAMES_HOSTED_PROOF_END_AT:String(FIRST+900000)}])assert.throws(()=>h.make('fixture-owner',extra),/PROOF_DISABLED|INVALID_PROOF_CONFIGURATION/);
 assert.throws(()=>h.make(''),/OWNER_UNAVAILABLE/);assert.equal(h.calls.length,0);
});
test('provider metadata never chooses owner, task, schedule or unrestricted due time',async()=>{
 const h=fixture();h.at(FIRST);
 for(const extra of [{name:'other'},{namespace:'other'},{source:'dynamic'},{expression:'* * * * *'},{scheduleId:'other'},{executionId:'x'.repeat(201)},{scheduledAt:new Date(FIRST+1)},{scheduledAt:new Date(FIRST+1800000)}])await assert.rejects(()=>h.make().run(metadata(extra)),/INVALID_SCHEDULE_EVENT/);
 h.at(FIRST-1);await assert.rejects(()=>h.make().run(metadata()),/INVALID_SCHEDULE_EVENT/);
 h.at(FIRST+120001);await assert.rejects(()=>h.make().run(metadata()),/INVALID_SCHEDULE_EVENT/);
 assert.equal(h.calls.length,0);
});
test('durable arm precedes closed-client runs; fresh compositions preserve blocked independence, resume and duplicates',async()=>{
 const h=fixture();await h.make().arm();let s=await h.make().status();assert.equal(s.armed,true);assert.deepEqual(s.tasks,[]);
 h.at(FIRST);const begin=h.calls.length;assert.equal((await h.make().run(metadata())).status,'checked');assert.ok(h.calls.length-begin<=MAX_REQUESTS);
 s=await h.make().status();assert.deepEqual(s.tasks.map(t=>t.status).sort(),['blocked','completed']);assert.equal(s.notifications[0].state,'queued');assert.equal(s.notifications[0].hasReceipt,false);
 const before=JSON.stringify(s.tasks);assert.equal((await h.make().run(metadata())).status,'duplicate_or_busy');assert.equal(JSON.stringify((await h.make().status()).tasks),before);
 await h.make().resume();h.at(FIRST+900000);
 assert.equal((await h.make().run(metadata({scheduledAt:new Date(FIRST+900000),executionId:'run-two'}))).status,'checked');
 s=await h.make().status();assert.ok(s.tasks.every(t=>t.status==='completed'&&t.outcome==='prepared'));assert.equal(s.notifications.length,2);assert.ok(s.notifications.every(n=>n.state==='queued'&&!n.hasReceipt));
 assert.equal(s.runs.length,2);assert.doesNotMatch(JSON.stringify(s),/fixture-owner|synthetic|token|lease|schedule-fixture|run-one|customer|Alex/);
 assert.equal((await h.make('other-owner').status()).armed,false);assert.equal((await h.make('other-owner').status()).tasks.length,0);
});
test('lost admission acknowledgement, expired invocation lease and fresh worker recover without duplicate preparation',async()=>{
 const h=fixture();await h.make().arm();h.at(FIRST);h.lose();
 await assert.rejects(()=>h.make().run(metadata()),/PROOF_CONTROL_UNAVAILABLE/);
 assert.equal((await h.make().status()).tasks.length,0);assert.equal((await h.make().run(metadata())).status,'duplicate_or_busy');
 h.at(FIRST+20001);assert.equal((await h.make().run(metadata())).status,'checked');
 const s=await h.make().status();assert.equal(s.runs[0].attempts,2);assert.equal(s.tasks.length,2);assert.equal(s.notifications.length,1);
 assert.equal((await h.make().run(metadata())).status,'duplicate_or_busy');
});
test('two attempts per occurrence and two occurrences cap repeated storage failures; execution IDs cannot move between slots',async()=>{
 const h=fixture();await h.make().arm();h.at(FIRST);h.fail(true);
 for(let i=0;i<2;i++)await assert.rejects(()=>h.make().run(metadata()),/PROOF_RUN_UNAVAILABLE/);
 assert.equal((await h.make().run(metadata())).status,'duplicate_or_busy');
 h.at(FIRST+900000);assert.equal((await h.make().run(metadata({scheduledAt:new Date(FIRST+900000)}))).status,'duplicate_or_busy');
 for(let i=0;i<2;i++)await assert.rejects(()=>h.make().run(metadata({scheduledAt:new Date(FIRST+900000),executionId:'run-two'})),/PROOF_RUN_UNAVAILABLE/);
 assert.equal((await h.make().run(metadata({scheduledAt:new Date(FIRST+900000),executionId:'run-two'}))).status,'duplicate_or_busy');
 h.fail(false);const s=await h.make().status();assert.deepEqual(s.runs.map(r=>r.attempts),[2,2]);
});
test('durable stop survives cancellation outage and expiry; no later arm or scheduled dispatch revives it',async()=>{
 const h=fixture();await h.make().arm();h.at(FIRST);await h.make().run(metadata());h.fail(true);
 await assert.rejects(()=>h.make().stop(),/TASK_STORAGE_UNAVAILABLE|DISPATCH_STORAGE_UNAVAILABLE/);
 h.fail(false);assert.equal((await h.make().status()).stopped,true);await assert.rejects(()=>h.make().arm(),/PROOF_STOPPED/);
 h.at(FIRST+900000);assert.equal((await h.make().run(metadata({scheduledAt:new Date(FIRST+900000),executionId:'run-two'}))).status,'not_armed');
 h.at(END);assert.equal((await h.make().stop()).status,'stopped');let s=await h.make().status();assert.ok(s.notifications.every(n=>n.state==='cancelled'));assert.equal(s.schedulerDisabled,false);
 await assert.rejects(()=>h.make().resume(),/PROOF_WINDOW_CLOSED/);
});
test('window expiry during execution stops further engine requests and preserves unavailable outcomes',async()=>{
 const h=fixture();await h.make().arm();h.at(FIRST);let engineCalls=0;
 h.hook(async(p,key)=>{if(!key.includes('proof-control')){engineCalls++;h.at(END);}});
 await assert.rejects(()=>h.make().run(metadata()),/PROOF_RUN_UNAVAILABLE/);assert.equal(engineCalls,1);
});
test('corrupt control or changed configuration cannot reset the durable run cap',async()=>{
 const h=fixture();await h.make().arm();const key=[...h.rows.keys()].find(k=>k.includes('proof-control'));const prior=h.rows.get(key);
 await assert.rejects(()=>h.make('fixture-owner',{JAMES_HOSTED_PROOF_SCHEDULE_ID:'different-schedule'}).status(),/PROOF_CONTROL_UNAVAILABLE/);assert.equal(h.rows.get(key),prior);
 h.rows.set(key,'broken-private-data');await assert.rejects(()=>h.make().status(),/PROOF_CONTROL_UNAVAILABLE/);assert.equal(h.rows.get(key),'broken-private-data');
});
test('private handler uses the pinned SDK, rejects invalid input and never reflects raw header/error content',async()=>{
 let calls=0;const handler=createHandler({service:()=>({run:async m=>{calls++;assert.equal(m.executionId,'run-one');return {status:'checked'};}})});
 let r=res();await handler({method:'POST',headers:eventHeaders()},r);assert.equal(r.code,200);assert.equal(calls,1);
 for(const req of [{method:'GET',headers:eventHeaders()},{method:'POST',headers:{}},{method:'POST',headers:{...eventHeaders(),'ce-type':'private-value'}},{method:'POST',headers:eventHeaders(),body:{owner:'other'}}]){r=res();await handler(req,r);assert.ok([400,405].includes(r.code));assert.doesNotMatch(JSON.stringify(r.body),/private-value|other/);}
 assert.equal(calls,1);
});
test('owner controls expose only arm, stop, resume and redacted status, not arbitrary worker operations',async()=>{
 const h=fixture(),handler=createOwnerHandler({authorize:()=>true,service:()=>h.make()});
 for(const body of [{action:'tick'},{action:'arm',owner:'other'},{action:'create'},{action:'stop',schedule:'other'},[]]){const r=res();await handler({method:'POST',headers:{'content-type':'application/json'},query:{},body},r);assert.equal(r.code,400);}
 assert.equal(h.calls.length,0);
 let r=res();await handler({method:'POST',headers:{'content-type':'application/json'},body:{action:'arm'}},r);assert.equal(r.code,200);assert.deepEqual(r.body,{status:'armed'});
 r=res();await handler({method:'GET',headers:{},query:{owner:'other'}},r);assert.equal(r.code,400);
});
test('real gateway enforces session and CSRF, hides disabled owner controls and never routes the private worker',async()=>{
 const values={...env(),JAMES_AUTH_EMAIL:'fixture@example.test',JAMES_SESSION_SECRET:'synthetic-secret-at-least-thirty-two-characters'},old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 const original=global.fetch;let calls=0;Object.assign(process.env,values);global.fetch=async()=>{calls++;throw Error('live access forbidden');};
 const cookie=auth.SESSION_COOKIE+'='+auth.createSessionToken(values.JAMES_AUTH_EMAIL);
 const req=(path='api/james/hosted-proof',extra={})=>({method:'GET',query:{path},headers:{host:'www.getjames.ai',cookie,...extra}});
 try{
  for(const [request,expected] of [[req(undefined,{cookie:''}),401],[req(undefined,{host:'other.example'}),403],[{...req(undefined,{origin:'https://other.example'}),method:'POST',body:{action:'arm'}},403],[req('api/proof-schedule',eventHeaders()),404],[req('api/proof-schedule.js',eventHeaders()),404]]){const r=res();await gateway(request,r);assert.equal(r.code,expected);}
  process.env.JAMES_HOSTED_SCHEDULE_ENABLED='false';const r=res();await gateway(req(),r);assert.equal(r.code,404);assert.equal(calls,0);
 }finally{global.fetch=original;for(const k of Object.keys(values))old[k]===undefined?delete process.env[k]:process.env[k]=old[k];}
});
