'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {empty,customer,activity,validateSnapshot,evolve,scopedKey,makeStore}=require('../lib/customer-activity/records.cjs');
const date='2026-10-21T12:00:00.000Z';
const sam={id:'demo-c1',name:'Fictional Northside Cabinetry',contact:'Alex Example',address:'Imaginary location'};
const visit={id:'event-1',customerId:'demo-c1',occurredAt:date,outcome:'attempted',notes:'No answer at fictional facility',nextAction:'Try calling next week'};
test('customer data is strictly normalized and safely bounded',()=>{
 assert.equal(customer(sam).name,'Fictional Northside Cabinetry');
 assert.throws(()=>customer({...sam,name:''}),/INVALID_NAME/);
 assert.throws(()=>customer({...sam,contact:'x'.repeat(151)}),/INVALID_CONTACT/);
 assert.throws(()=>customer({...sam,id:'x'.repeat(101)}),/INVALID_ID/);
 assert.throws(()=>activity({...visit,notes:'x'.repeat(2001)}),/INVALID_NOTES/);
 assert.throws(()=>activity({...visit,outcome:'fake'}),/INVALID_OUTCOME/);
 assert.throws(()=>activity({...visit,occurredAt:'tomorrow'}),/INVALID_TIMESTAMP/);
});
test('records distinguish attempted stops from confirmed visits, store follow-ups and revision',()=>{
 let r=evolve(empty(),{type:'upsert_customer',expectedRevision:0,customer:sam});
 assert.equal(r.document.revision,1);
 r=evolve(r.document,{type:'record_activity',expectedRevision:1,activity:visit});
 assert.equal(r.document.revision,2);
 assert.equal(r.document.activities[0].outcome,'attempted');
 assert.equal(r.document.activities[0].nextAction,'Try calling next week');
 assert.equal(r.document.activities[0].customerId,sam.id);
 assert.deepEqual(evolve(r.document,{type:'record_activity',expectedRevision:1,activity:visit}),{conflict:true,document:r.document});
 assert.throws(()=>evolve(r.document,{type:'record_activity',expectedRevision:2,activity:visit}),/DUPLICATE_ACTIVITY/);
 const met=evolve(r.document,{type:'record_activity',expectedRevision:2,activity:{...visit,id:'event-2',outcome:'met',notes:'Met manager'}}).document;
 assert.deepEqual(met.activities.map(x=>x.outcome),['attempted','met']);
});
test('unrecognized customer, corrupt snapshots and oversized input fail closed',()=>{
 assert.throws(()=>evolve(empty(),{type:'record_activity',expectedRevision:0,activity:visit}),/CUSTOMER_NOT_FOUND/);
 assert.throws(()=>evolve(empty(),{type:'upsert_customer',expectedRevision:0,customer:{...sam,source:'x'.repeat(70)}}),/INVALID_SOURCE/);
 assert.throws(()=>validateSnapshot({schemaVersion:1,revision:0,customers:[sam,sam],activities:[]}),/DUPLICATE_CUSTOMER/);
 assert.throws(()=>validateSnapshot({schemaVersion:1,revision:0,customers:[],activities:[visit]}),/INVALID_ACTIVITY_REFERENCE/);
 assert.throws(()=>evolve(empty(),{type:'delete_all',expectedRevision:0}),/INVALID_COMMAND/);
});
test('identity-scoped storage rejects stale and concurrent writes',async()=>{
 const backing=new Map();
 const read=async key=>backing.get(key)??null;
 const cas=async(key,expected,next)=>{if((backing.get(key)??null)!==expected)return false;backing.set(key,next);return true;};
 const store=makeStore({read,compareAndSwap:cas});
 const owner='owner:personA',other='owner:personB';
 assert.notEqual(scopedKey(owner),scopedKey(other));
 assert.deepEqual(await store.load(owner),empty());
 let r=await store.commit(owner,{type:'upsert_customer',expectedRevision:0,customer:sam});
 assert.equal(r.ok,true);
 assert.equal((await store.load(owner)).customers.length,1);
 assert.equal((await store.load(other)).customers.length,0);
 assert.deepEqual(await store.commit(owner,{type:'upsert_customer',expectedRevision:0,customer:sam}),{ok:false,conflict:true,revision:1});
 const simultaneous=await Promise.all([
  store.commit(owner,{type:'record_activity',expectedRevision:1,activity:visit}),
  store.commit(owner,{type:'record_activity',expectedRevision:1,activity:{...visit,id:'event-2'}})
 ]);
 assert.equal(simultaneous.filter(x=>x.ok).length,1);
 assert.equal((await store.load(owner)).activities.length,1);
 assert.equal((await store.load(other)).activities.length,0);
});
test('a failed storage transaction never claims success',async()=>{
 const store=makeStore({read:async()=>null,compareAndSwap:async()=>false});
 const result=await store.commit('owner:test',{type:'upsert_customer',expectedRevision:0,customer:sam});
 assert.deepEqual(result,{ok:false,conflict:true,revision:null});
});
test('no network, OAuth, mail, Odoo, Calendar or Task writes are imported',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../lib/customer-activity/records.cjs'),'utf8');
 assert.doesNotMatch(source,/\bfetch\s*\(|\/api\/|process\.env|\/microsoft\/|\/google\/|\/tasks|odoo/i);
});

test('multiple contacts are bounded and activity contact identity is validated by the server',()=>{
 const company={...sam,contacts:[{id:'contact-a',name:'Alex Example'},{id:'contact-b',name:'Jordan Example'}]};
 assert.throws(()=>customer({...company,contacts:[company.contacts[0],company.contacts[0]]}),/DUPLICATE_CONTACT/);
 assert.throws(()=>customer({...company,contacts:Array(51).fill(company.contacts[0])}),/INVALID_CONTACTS/);
 let doc=evolve(empty(),{type:'upsert_customer',expectedRevision:0,customer:company}).document;
 assert.throws(()=>evolve(doc,{type:'record_activity',expectedRevision:1,activity:{...visit,contactId:'unknown',contactName:'Unknown'}}),/CONTACT_NOT_FOUND/);
 const result=evolve(doc,{type:'record_activity',expectedRevision:1,activity:{...visit,contactId:'contact-b',contactName:'Incorrect client name'}});
 assert.equal(result.document.activities[0].contactName,'Jordan Example');
 assert.equal(validateSnapshot(result.document).customers[0].contacts.length,2);
});

test('first new write upgrades the snapshot so older writers fail closed',()=>{
 const old={schemaVersion:1,revision:1,customers:[sam],activities:[]};
 const upgraded=evolve(old,{type:'record_activity',expectedRevision:1,activity:visit}).document;
 assert.equal(old.schemaVersion,1);
 assert.equal(upgraded.schemaVersion,2);
 assert.equal(validateSnapshot(upgraded).activities.length,1);
 assert.throws(()=>validateSnapshot({...upgraded,schemaVersion:3}),/INVALID_SNAPSHOT/);

});

test('timed follow-up survives snapshot normalization and rejects malformed commitments',()=>{
 const {activity}=require('../lib/customer-activity/records.cjs');
 const planned={...visit,nextAction:'Email',nextActionDetails:'Send requested proposal',nextActionAt:'2099-10-23T17:00:00.000Z'};
 assert.equal(activity(planned).nextActionAt,planned.nextActionAt);
 assert.equal(activity(planned).nextActionDetails,planned.nextActionDetails);
 assert.throws(()=>activity({...planned,nextActionAt:'tomorrow'}),/INVALID_NEXT_TIMESTAMP/);
 assert.throws(()=>activity({...planned,nextActionDetails:''}),/INVALID_NEXT_DETAILS/);
 assert.equal(activity(visit).nextAction,visit.nextAction,'legacy notes remain readable');
});
