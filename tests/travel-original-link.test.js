'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createStore}=require('../lib/travel/mail-trip-store.cjs');
const {render}=require('../lib/travel/mail-trip.cjs');
const {fixture,candidate}=require('./helpers/travel-link-fixture.cjs');
test('original content-ID Briefing link survives adoption, pickup and a fresh store',async()=>{
 const db=fixture(),before=[db.files.get(db.oregon),db.files.get('bytes:'+db.oregon)];
 const originalLink='#travel/'+db.chicago;
 await createStore({command:db.command,environment:'preview'}).upsert('qa@example.invalid',candidate);
 await createStore({command:db.command,environment:'preview'}).upsert('qa@example.invalid',{...candidate,at:2,values:{start:candidate.values.start,destination:'Chicago',pickup:'Terminal 2'}});
 assert.equal(db.files.size,4);assert.equal(db.files.has(candidate.id),false);
 const id=originalLink.slice(8),trip=JSON.parse(Buffer.from(db.files.get('bytes:'+id),'base64'));
 assert.deepEqual(trip.stops,['Chicago',...candidate.values.flights,'Pickup: Terminal 2']);
 assert.deepEqual([db.files.get(db.oregon),db.files.get('bytes:'+db.oregon)],before);
});
test('ambiguous legacy copies are not silently combined',async()=>{
 const db=fixture();db.seed(render(candidate.values),'other.james-trip.json');const before=[...db.files];
 await assert.rejects(createStore({command:db.command,environment:'preview'}).upsert('qa@example.invalid',candidate),/TRAVEL_IDENTITY_CONFLICT/);
 assert.deepEqual([...db.files],before);
});
test('matching destination and dates cannot adopt a different flight itinerary',async()=>{
 const db=fixture(),before=db.files.get('bytes:'+db.chicago);
 await createStore({command:db.command,environment:'preview'}).upsert('qa@example.invalid',{...candidate,values:{...candidate.values,flights:['Different flight']}});
 assert.equal(db.files.get('bytes:'+db.chicago),before);assert.equal(db.files.size,6);
});

test('first enriched confirmation retains original link without a preparatory replay',async()=>{
 const db=fixture(),oregon=[db.files.get(db.oregon),db.files.get('bytes:'+db.oregon)];
 const enriched={...candidate,at:2,values:{...candidate.values,hotel:'Sample hotel',pickup:'Terminal 2'}};
 const store=()=>createStore({command:db.command,environment:'preview'});
 assert.equal(await store().upsert('qa@example.invalid',enriched),'updated');
 assert.equal(db.files.size,4);
 assert.equal(db.files.has(candidate.id),false);
 assert.deepEqual(JSON.parse(Buffer.from(db.files.get('bytes:'+db.chicago),'base64')),render(enriched.values));
 assert.equal(await store().upsert('qa@example.invalid',enriched),'unchanged');
 assert.deepEqual([db.files.get(db.oregon),db.files.get('bytes:'+db.oregon)],oregon);
});

test('enrichment cannot choose between an original and a partially enriched legacy copy',async()=>{
 const db=fixture();db.seed(render({...candidate.values,hotel:'Sample hotel'}),'other.james-trip.json');
 const before=[...db.files];
 await assert.rejects(createStore({command:db.command,environment:'preview'}).upsert('qa@example.invalid',{
  ...candidate,at:2,values:{...candidate.values,hotel:'Sample hotel',pickup:'Terminal 2'}
 }),/TRAVEL_IDENTITY_CONFLICT/);
 assert.deepEqual([...db.files],before);
});

