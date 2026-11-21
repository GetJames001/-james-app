'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../lib/routes/task-execution.js');
const {createLedger}=require('../lib/task-execution/ledger.cjs');
const auth=require('../lib/auth.js'),gateway=require('../api/gateway.js');
const fixture=require('./fixtures/task-execution/inputs.json');
function res(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(value){this.body=value;return this;},end(){return this;}};}
const command=(id='agenda')=>({type:'create',operationId:'create-'+id,taskId:id,expectedRevision:0,kind:'agenda_fixture',objective:'Prepare fictional agenda',input:fixture.agenda,budget:fixture.budget,requiresApproval:false});
function setup(){let owner='fixture-owner-a',reads=0;const rows=new Map(),ledger=createLedger({read:async key=>{reads++;return rows.get(key)??null;},compareAndSwap:async(key,old,next)=>{if((rows.get(key)??null)!==old)return false;rows.set(key,next);return true;}}),handler=createHandler({ledger,authorize:()=>true,identity:()=>owner,enabled:true});return {ledger,handler,owner:value=>owner=value,reads:()=>reads};}
const post=body=>({method:'POST',headers:{'content-type':'application/json'},query:{},body});
test('owner-derived API reads persist across clients; caller cannot select another account',async()=>{
 const h=setup();let r=res();await h.handler(post(command()),r);assert.equal(r.code,201);assert.equal(r.body.task.status,'queued');assert.doesNotMatch(JSON.stringify(r.body),/lease|approval|fixture-owner|events/);
 r=res();await createHandler({ledger:h.ledger,authorize:()=>true,identity:()=> 'fixture-owner-a',enabled:true})({method:'GET',query:{},headers:{}},r);assert.equal(r.body.tasks.length,1);
 h.owner('fixture-owner-b');r=res();await h.handler({method:'GET',query:{},headers:{}},r);assert.deepEqual(r.body.tasks,[]);
 r=res();await h.handler({method:'GET',query:{taskId:'agenda'},headers:{}},r);assert.equal(r.code,404);
 h.owner('fixture-owner-a');r=res();await h.handler({...post(command()),query:{owner:'fixture-owner-b'}},r);assert.equal(r.code,400);
 r=res();await h.handler(post({...command(),owner:'fixture-owner-b'}),r);assert.equal(r.code,400);
});
test('worker completion, lease and approval commands plus paid or arbitrary kinds are not user APIs',async()=>{
 const h=setup();for(const type of ['claim','checkpoint','complete','reserve','approve']){const r=res();await h.handler(post({...command(),type}),r);assert.equal(r.code,403);}
 for(const patch of [{kind:'purchase'},{requiresApproval:true},{budget:{...fixture.budget,maxCostMicros:1}}]){const r=res();await h.handler(post({...command(),...patch}),r);assert.equal(r.code,403);}
 assert.equal(h.reads(),0);
});
test('API reconciles duplicate create after later progress without returning the stale queued snapshot',async()=>{
 const h=setup();let r=res();const c=command();await h.handler(post(c),r);let task=(await h.ledger.snapshot('fixture-owner-a')).tasks[0];
 task=(await h.ledger.execute('fixture-owner-a',{type:'claim',operationId:'claim',taskId:task.id,expectedRevision:task.revision,workerId:'worker',leaseMs:3000})).task;
 await h.ledger.execute('fixture-owner-a',{type:'complete',operationId:'done',taskId:task.id,expectedRevision:task.revision,workerId:'worker',fence:task.fence,result:{outcome:'prepared',text:'Fictional agenda ready'}});
 r=res();await h.handler(post(c),r);assert.equal(r.code,200);assert.equal(r.body.replayed,true);assert.equal(r.body.operationTaskRevision,1);assert.equal(r.body.task.status,'completed');assert.ok(r.body.task.revision>1);
 r=res();await h.handler(post({...c,objective:'Changed request'}),r);assert.equal(r.code,409);
});
test('malformed requests, storage errors and disabled feature return bounded non-sensitive responses',async()=>{
 const h=setup();for(const [request,code] of [[post('bad-json'),400],[{...post(command()),headers:{}},415],[post('x'.repeat(20000)),413],[post([]),400],[{method:'PUT',query:{},headers:{}},405]]){const r=res();await h.handler(request,r);assert.equal(r.code,code);}
 let reads=0;const failing={snapshot:async()=>{reads++;throw Error('secret upstream body');},execute:async()=>{throw Error('secret upstream body');}};
 let r=res();await createHandler({ledger:failing,authorize:()=>true,identity:()=> 'owner',enabled:false})({method:'GET',query:{},headers:{}},r);assert.equal(r.code,404);assert.equal(reads,0);
 r=res();await createHandler({ledger:failing,authorize:()=>true,identity:()=> 'owner',enabled:true})({method:'GET',query:{},headers:{}},r);assert.equal(r.code,503);assert.deepEqual(r.body,{error:'TASKS_UNAVAILABLE'});
});
test('real gateway enforces authentication and same-origin writes before storage; no Preview flag enables Production',async()=>{
 const keys=['JAMES_AUTH_EMAIL','JAMES_SESSION_SECRET','JAMES_TASK_EXECUTION_PREVIEW_ENABLED','VERCEL_ENV','VERCEL_GIT_COMMIT_REF','KV_REST_API_URL','KV_REST_API_TOKEN'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const original=global.fetch;let calls=0;
 Object.assign(process.env,{JAMES_AUTH_EMAIL:'fixture@example.test',JAMES_SESSION_SECRET:'synthetic-secret-for-task-api-auth-fixture',JAMES_TASK_EXECUTION_PREVIEW_ENABLED:'true',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'work/agent-systems-first-proof-20261112',KV_REST_API_URL:'https://redis.example.test',KV_REST_API_TOKEN:'synthetic'});
 const cookie=auth.SESSION_COOKIE+'='+auth.createSessionToken('fixture@example.test');
 process.env.JAMES_AUTH_EMAIL='different@example.test';const foreignCookie=auth.SESSION_COOKIE+'='+auth.createSessionToken('different@example.test');process.env.JAMES_AUTH_EMAIL='fixture@example.test';
 const req=(headers={},method='GET')=>({method,query:{path:'api/james/task-execution'},headers:{host:'www.getjames.ai',cookie,...headers},body:command()});
 global.fetch=async()=>{calls++;throw Error('No live database calls allowed');};
 try{
  for(const [request,code] of [[req({cookie:''}),401],[req({cookie:foreignCookie}),401],[req({origin:'https://attacker.example'},'POST'),403],[req({host:'attacker.example'}),403]]){const r=res();await gateway(request,r);assert.equal(r.code,code);}
  assert.equal(calls,0);
  for(const patch of [{VERCEL_ENV:'production'},{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'some-other-branch'},{VERCEL_GIT_COMMIT_REF:'work/agent-systems-first-proof-20261112',JAMES_TASK_EXECUTION_PREVIEW_ENABLED:'false'}]){Object.assign(process.env,patch);const r=res();await gateway(req(),r);assert.equal(r.code,404);}
  assert.equal(calls,0);
 }finally{global.fetch=original;for(const key of keys)old[key]===undefined?delete process.env[key]:process.env[key]=old[key];}
});
