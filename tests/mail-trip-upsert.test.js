'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {extract,merge,candidates}=require('../lib/travel/mail-trip.cjs');
const {createStore,sync}=require('../lib/travel/mail-trip-store.cjs');
const {validTrip}=require('../travel.js');
const message=(extra='',at='2026-11-20T12:00:00Z')=>({subject:'Itinerary confirmed',receivedDateTime:at,preview:'Provider: Example Air\nBooking reference: TEST42\nTrip start: 2026-12-03\nTrip end: 2026-12-04\nDestination: Chicago\n'+extra});
function memory(){
 const hashes=new Map();let commits=0;
 return {hashes,get commits(){return commits;},async command([op,...args]){
  if(op==='HKEYS')return [...(hashes.get(args[0])?.keys()||[])];
  if(op==='HGET')return hashes.get(args[0])?.get(args[1])||null;
  assert.equal(op,'EVAL');const [,n,key,id,old,next,content]=args;assert.equal(n,1);
  const h=hashes.get(key)||new Map();hashes.set(key,h);
  if((h.get(id)||'')!==old)return -1;
  if(!h.has(id)&&h.size>=40)return 0;
  h.set(id,next);h.set('bytes:'+id,content);commits++;return 1;
 }};
}
test('strict extract accepts only complete explicit itinerary facts',()=>{
 assert.ok(extract(message()));
 for(const m of [{...message(),preview:'Fly to Chicago next week'}, {...message(),sourceFolder:'Spam'}, {...message(),preview:message().preview+'Provider: Other'}, {...message(),receivedDateTime:'bad'}, {...message(),preview:message().preview.replace('2026-12-03','2026-02-30')}])assert.equal(extract(m),null);
});
test('same booking across two provider inboxes creates one compatible file',async()=>{
 const db=memory(),store=createStore({command:db.command,environment:'preview'});
 const snapshot={state:{scans:[{source:['microsoft','personal-inbox-review'],pages:[[{mail:{...message(),id:'outlook-a'}}]]},{source:['google','gmail-inbox-review'],pages:[[{mail:{...message(),id:'gmail-b'}}]]}]}};
 assert.equal(candidates(snapshot).length,2);
 assert.deepEqual(await sync(snapshot,'person@example.invalid',store,candidates),{created:1,updated:0,unchanged:1});
 const h=[...db.hashes.values()][0];assert.equal(h.size,2);
 const trip=JSON.parse(Buffer.from(h.get('bytes:'+extract(message()).id),'base64'));
 assert.ok(validTrip(trip));assert.equal(trip.title,'Chicago trip');
});
test('hotel and pickup updates retain ID; stale mail cannot revert fields',async()=>{
 const db=memory(),store=createStore({command:db.command,environment:'preview'});
 const original=extract(message('Hotel: Old Hotel\nPickup: Terminal 1'));
 const hotel=extract(message('Hotel: New Hotel','2026-11-20T13:00:00Z'));
 const pickup=extract(message('Pickup: Terminal 2','2026-11-20T14:00:00Z'));
 assert.equal(original.id,hotel.id);assert.equal(hotel.id,pickup.id);
 for(const c of [original,hotel,pickup,original])await store.upsert('person@example.invalid',c);
 const h=[...db.hashes.values()][0];assert.equal(h.size,2);
 const t=JSON.parse(Buffer.from(h.get('bytes:'+original.id),'base64'));
 assert.deepEqual(t.stops,['Chicago','Hotel: New Hotel','Pickup: Terminal 2']);
});
test('updates preserve unrelated files and isolate owners and environments',async()=>{
 const db=memory(),preview=createStore({command:db.command,environment:'preview'}),prod=createStore({command:db.command,environment:'production'});
 const c=extract(message());await preview.upsert('one@example.invalid',c);
 const h=[...db.hashes.values()][0];h.set('unrelated','untouched');h.set('bytes:unrelated','untouched');
 await preview.upsert('one@example.invalid',extract(message('Hotel: New')));
 assert.equal(h.get('unrelated'),'untouched');assert.equal(h.get('bytes:unrelated'),'untouched');
 await preview.upsert('two@example.invalid',c);await prod.upsert('one@example.invalid',c);assert.equal(db.hashes.size,3);
});
test('concurrent booking updates retry atomic conflict, no lost fields or duplicates',async()=>{
 const db=memory(),store=createStore({command:db.command,environment:'preview'});
 await Promise.all([store.upsert('person@example.invalid',extract(message('Hotel: New Hotel'))),store.upsert('person@example.invalid',extract(message('Pickup: Terminal 2','2026-11-20T14:00:00Z')))]);
 const h=[...db.hashes.values()][0];assert.equal(h.size,2);
 const trip=JSON.parse(Buffer.from(h.get('bytes:'+extract(message()).id),'base64'));
 assert.ok(trip.stops.includes('Hotel: New Hotel'));assert.ok(trip.stops.includes('Pickup: Terminal 2'));
});
test('capacity errors do not remove records; no unverified scan sources',async()=>{
 const db=memory(),store=createStore({command:db.command,environment:'preview'});await store.upsert('a',extract(message()));
 const h=[...db.hashes.values()][0];for(let i=0;i<38;i++)h.set('other-'+i,'x');
 const other=extract({...message(),preview:message().preview.replace('TEST42','TEST43')});
 await assert.rejects(store.upsert('a',other),/FILES_LIMIT_REACHED/);assert.equal(h.size,40);
 assert.deepEqual(candidates({state:{scans:[{source:['other','unknown'],pages:[[{mail:message()}]]}]}}),[]);
});
test('equal-time conflicts retain existing value',()=>{
 const a=extract(message('Hotel: First')),b=extract(message('Hotel: Second'));
 assert.equal(merge(merge(null,a),b).trip.stops[1],'Hotel: First');
});
test('reused booking with unrelated date or destination requires review',async()=>{
 const db=memory(),store=createStore({command:db.command,environment:'preview'});await store.upsert('a',extract(message()));
 for(const preview of [message().preview.replace('Chicago','Seattle'),message().preview.replace('2026-12-03','2026-12-02')])await assert.rejects(store.upsert('a',extract({...message(),preview})),/TRAVEL_IDENTITY_CONFLICT/);
 assert.equal([...db.hashes.values()][0].size,2);
});
test('AA full-body adapter requires separately provider-verified sender allowlist',()=>{
 const {fromVerifiedAA}=require('../lib/travel/mail-trip.cjs');
 const body='Confirmation code: TEST42\nThursday, December 3, 2026\n[airplane]\nLAS\nLas Vegas\n2:09 PM\nAA 3015\n[destination]\nORD\nChicago O Hare\n7:58 PM\nFriday, December 4, 2026\n[airplane]\nORD\nChicago O Hare\n3:00 PM\nAA 3081\n[destination]\nLAS\nLas Vegas\n5:16 PM';
 const msg={body,receivedDateTime:'2026-11-20T12:00:00Z',authenticatedSender:'recruiter@example.invalid'};
 assert.equal(fromVerifiedAA(msg,[]),null);
 assert.equal(fromVerifiedAA({...msg,authenticatedSender:undefined},['recruiter@example.invalid']),null);
 assert.equal(fromVerifiedAA({...msg,sourceFolder:'Spam'},['recruiter@example.invalid']),null);
 const c=fromVerifiedAA(msg,['recruiter@example.invalid']);assert.ok(c);assert.ok(validTrip(merge(null,c).trip));assert.ok(c.values.flights[0].includes('2026-12-03'));assert.ok(c.values.flights[1].includes('AA 3081'));
});
test('candidate identity/path injection rejected before storage calls',async()=>{
 let called=false;const store=createStore({command:async()=>{called=true;},environment:'preview'});
 await assert.rejects(store.upsert('a',{...extract(message()),id:'bytes:other'}),/INVALID_MAIL_TRIP/);assert.equal(called,false);
});

test('sync refuses unverified reader rather than accepting preview facts',async()=>{await assert.rejects(sync({},'a',{}),/VERIFIED_TRAVEL_READER_REQUIRED/);});
