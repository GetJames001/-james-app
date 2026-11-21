'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createStorage}=require('../lib/task-execution/storage.cjs'),{createLedger,scopedKey}=require('../lib/task-execution/ledger.cjs');
const {CAS}=require('../lib/customer-activity/storage.cjs');
const fixture=require('./fixtures/task-execution/inputs.json');
const create=()=>({type:'create',operationId:'create-agenda',taskId:'agenda',expectedRevision:0,kind:'agenda_fixture',objective:'Fictional agenda',input:fixture.agenda,budget:fixture.budget,requiresApproval:false});
function rest(){const rows=new Map(),calls=[];let lost=false;const fetchImpl=async(url,options)=>{
 assert.equal(url,'https://kv.example.test');assert.equal(options.headers.Authorization,'Bearer synthetic');assert.equal(options.redirect,'error');assert.ok(options.signal);const c=JSON.parse(options.body);calls.push(c);
 if(c[0]==='GET')return Response.json({result:rows.get(c[1])??null});
 assert.equal(c[0],'EVAL');assert.equal(c[1],CAS);assert.equal(c[2],1);const actual=rows.get(c[3])??null;const expected=c[4]==='absent'?null:c[5];if(actual!==expected)return Response.json({result:0});rows.set(c[3],c[6]);if(lost){lost=false;throw Error('Lost acknowledgement');}return Response.json({result:1});
 };return {rows,calls,fetchImpl,lose:()=>{lost=true;}};}
const options=h=>({url:'https://kv.example.test',token:'synthetic',fetchImpl:h.fetchImpl});
test('existing REST/CAS storage keeps separate owners and real operation replay across adapter instances',async()=>{
 const h=rest(),first=createLedger(createStorage(options(h))),second=createLedger(createStorage(options(h)));
 const race=await Promise.all([first.execute('fixture-a',create()),second.execute('fixture-a',create())]);assert.equal(race.filter(r=>r.replayed).length,1);assert.equal((await second.snapshot('fixture-a')).tasks.length,1);assert.equal((await second.snapshot('fixture-b')).tasks.length,0);
 assert.ok(h.calls.every(c=>/^james:task-execution:v1:[a-f0-9]{64}$/.test(c[c[0]==='GET'?1:3])));assert.equal(h.rows.has('james:tasks'),false);
});
test('lost REST write acknowledgement is reconciled by the same durable operation receipt',async()=>{
 const h=rest(),ledger=createLedger(createStorage(options(h)));h.lose();await assert.rejects(()=>ledger.execute('fixture-a',create()),/TASK_STORAGE_UNAVAILABLE/);
 assert.equal((await ledger.execute('fixture-a',create())).replayed,true);assert.equal((await ledger.snapshot('fixture-a')).tasks.length,1);
});
test('storage rejects arbitrary keys, missing configuration and invalid envelope/result types',async()=>{
 const h=rest(),store=createStorage(options(h));await assert.rejects(()=>store.read('james:tasks'),/TASK_STORAGE_UNAVAILABLE/);await assert.rejects(()=>store.compareAndSwap(scopedKey('owner'),null,'x'.repeat(2*1024*1024+1)),/TASK_STORAGE_UNAVAILABLE/);assert.equal(h.calls.length,0);
 await assert.rejects(()=>createStorage({fetchImpl:h.fetchImpl}).read(scopedKey('owner')),/TASK_STORAGE_UNAVAILABLE/);
 for(const response of [()=>Response.json({result:false}),()=>Response.json({error:'private upstream error'}),()=>new Response('malformed'),()=>new Response('',{headers:{'content-length':String(9*1024*1024)}}),()=>Response.json({result:null},{status:503})])await assert.rejects(()=>createStorage({url:'https://kv.example.test',token:'synthetic',fetchImpl:async()=>response()}).read(scopedKey('owner')),/TASK_STORAGE_UNAVAILABLE/);
 const invalidCAS=createStorage({url:'https://kv.example.test',token:'synthetic',fetchImpl:async()=>Response.json({result:true})});await assert.rejects(()=>invalidCAS.compareAndSwap(scopedKey('owner'),null,'{}'),/TASK_STORAGE_UNAVAILABLE/);
});
