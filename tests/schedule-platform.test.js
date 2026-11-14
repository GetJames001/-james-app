'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SchedulesClient}=require('@vercel/schedules');
const {createSchedulePlatform,TIMEOUT_MS,MAX_BYTES}=require('../lib/task-execution/schedule-platform.cjs');
const {PROJECT,NAME,EXPRESSION}=require('../lib/task-execution/schedule-transport.cjs');
const END=2580000;
const snapshot=(extra={})=>({scheduleId:'fixture-id',projectId:PROJECT,name:NAME,namespace:'default',source:'static',expression:{type:'cron',cron:EXPRESSION},timezone:'UTC',jitter:1,target:{type:'function',function:'api/proof-schedule'},state:'active',activeUntil:END,...extra});
function fixture(extra={},mode='normal'){
 let current=snapshot(extra);const calls=[];
 const manager=createSchedulePlatform({config:{scheduleId:'fixture-id',end:END},project:PROJECT,name:NAME,expression:EXPRESSION,now:()=>900000,clientFactory:options=>new SchedulesClient({...options,token:'synthetic-test-token'}),fetchImpl:async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,'https://vercel-schedules.com');assert.equal(u.search,'?namespace=default');assert.equal(options.redirect,'error');assert.ok(options.signal);assert.equal(options.headers.get('Authorization'),'Bearer synthetic-test-token');calls.push({path:u.pathname,method:options.method});
  if(options.method==='POST'){
   assert.equal(u.pathname,'/v1/schedules/'+NAME+'/disable');assert.equal(options.body,undefined);
   if(mode==='rejected')return new Response('private provider detail',{status:403});
   if(mode!=='still-active')current={...current,state:'inactive'};delete current.activeUntil;
   if(mode==='lost-reply')throw Error('lost acknowledgement');
  }
  return Response.json(current);
 }});
 return {manager,calls};
}
test('real SDK uses only exact GET/disable paths and confirms shutdown with fresh GET',async()=>{
 const h=fixture();assert.equal((await h.manager.inspect()).bounded,true);const stopped=await h.manager.stop();assert.equal(stopped.state,'inactive');assert.equal(stopped.activeUntil,null);
 assert.deepEqual(h.calls.map(c=>c.method),['GET','GET','POST','GET']);
 const inactive=fixture({state:'inactive',activeUntil:undefined});assert.equal((await inactive.manager.stop()).state,'inactive');assert.deepEqual(inactive.calls.map(c=>c.method),['GET']);
});
test('wrong schedule identity or shape never reaches a mutation',async()=>{
 for(const extra of [{scheduleId:'other'},{projectId:'other'},{name:'other'},{namespace:'other'},{source:'dynamic'},{expression:{type:'cron',cron:'* * * * *'}},{timezone:'America/Los_Angeles'},{jitter:15},{target:{type:'path',path:'/api/real'}},{target:{type:'function',function:'api/proof-schedule',service:'other'}},{state:'deleted'},{activeUntil:'2580000'},{state:'inactive'}]){
  const h=fixture(extra);assert.equal((await h.manager.stop()).state,'unknown');assert.deepEqual(h.calls.map(c=>c.method),['GET']);
 }
});
test('lost disable reply is reconciled; rejection or remaining active state is never reported inactive',async()=>{
 assert.equal((await fixture({},'lost-reply').manager.stop()).state,'inactive');
 for(const mode of ['rejected','still-active'])assert.notEqual((await fixture({},mode).manager.stop()).state,'inactive');
});
test('only the exact finite future deadline qualifies for worker execution; indefinite schedules may still be stopped',async()=>{
 for(const activeUntil of [undefined,END+1,END-1,899999])assert.equal((await fixture({activeUntil}).manager.inspect()).bounded,false);
 const h=fixture({activeUntil:undefined});assert.equal((await h.manager.stop()).state,'inactive');
});
test('oversized, invalid and provider-error bodies stay redacted and bounded',async()=>{
 for(const response of [()=>new Response('x'.repeat(MAX_BYTES+1)),()=>new Response('not JSON'),()=>new Response('private-token-diagnostic',{status:500})]){
  const manager=createSchedulePlatform({config:{scheduleId:'fixture-id',end:END},project:PROJECT,name:NAME,expression:EXPRESSION,clientFactory:options=>new SchedulesClient({...options,token:'synthetic'}),fetchImpl:async()=>response()});
  assert.deepEqual(await manager.inspect(),{state:'unknown',activeUntil:null,bounded:false,verifiedAt:null});
 }
});
test('deadline aborts hanging management calls without a late disable',{timeout:TIMEOUT_MS+1500},async()=>{
 let aborted=false,calls=0;
 const manager=createSchedulePlatform({config:{scheduleId:'fixture-id',end:END},project:PROJECT,name:NAME,expression:EXPRESSION,clientFactory:options=>new SchedulesClient({...options,token:'synthetic'}),fetchImpl:async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}));}});
 assert.equal((await manager.stop()).state,'unknown');assert.equal(aborted,true);assert.equal(calls,1);
});

test('finite enable uses the pinned SDK expiry, fresh inactive read and confirmed readback',async()=>{
 for(const lostReply of [false,true]){
  let current=snapshot({state:'inactive',activeUntil:undefined});const calls=[];
  const manager=createSchedulePlatform({config:{scheduleId:'fixture-id',start:780000,end:END},project:PROJECT,name:NAME,expression:EXPRESSION,now:()=>900000,clientFactory:o=>new SchedulesClient({...o,token:'synthetic'}),fetchImpl:async(url,options)=>{
   calls.push(options.method);assert.equal(options.redirect,'error');
   if(options.method==='POST'){
    assert.equal(new URL(url).pathname,'/v1/schedules/'+NAME+'/enable');
    assert.deepEqual(JSON.parse(options.body),{until:END});current=snapshot();
    if(lostReply)throw Error('lost enable acknowledgement');
   }return Response.json(current);
  }});
  assert.equal((await manager.enableBounded()).bounded,true);assert.deepEqual(calls,['GET','POST','GET']);
  assert.equal((await manager.enableBounded()).state,'unknown');assert.deepEqual(calls,['GET','POST','GET','GET']);
 }
});
test('finite enable refuses invalid windows, unknown identity and bad acknowledgement without extension',async()=>{
 for(const config of [{start:0,end:END},{start:END,end:END},{start:1000000,end:END},{start:780000,end:899999},{start:NaN,end:END}]){
  let calls=0;const manager=createSchedulePlatform({config:{scheduleId:'fixture-id',...config},project:PROJECT,name:NAME,expression:EXPRESSION,now:()=>900000,clientFactory:o=>new SchedulesClient({...o,token:'synthetic'}),fetchImpl:async()=>{calls++;return Response.json(snapshot());}});
  assert.equal((await manager.enableBounded()).state,'unknown');assert.equal(calls,0);
 }
 for(const mismatch of [true,false]){
  const methods=[];const manager=createSchedulePlatform({config:{scheduleId:'fixture-id',start:780000,end:END},project:PROJECT,name:NAME,expression:EXPRESSION,now:()=>900000,clientFactory:o=>new SchedulesClient({...o,token:'synthetic'}),fetchImpl:async(url,options)=>{
   methods.push(options.method);return Response.json(snapshot({state:'inactive',activeUntil:undefined,...(mismatch?{projectId:'other'}:{})}));
  }});
  assert.equal((await manager.enableBounded()).state,'unknown');assert.deepEqual(methods,mismatch?['GET']:['GET','POST','GET']);
 }
});
