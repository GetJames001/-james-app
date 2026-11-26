'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fromVerifiedAA, extract} = require('../lib/travel/mail-trip.cjs');
const {createStore,sync} = require('../lib/travel/mail-trip-store.cjs');
const {validTrip} = require('../travel.js');

const sender = 'recruiter@example.invalid';
const owner = 'traveler@example.invalid';
const body = [
 'Confirmation code: TEST42', 'Thursday, December 3, 2026', '[airplane]',
 '[https://www.aa.com/content/images/email/cne/dots-76px.png]',
 'LAS', 'Las Vegas', '2:09 PM', 'AA 3015', '[destination]', 'ORD', "Chicago O'Hare", '7:58 PM',
 'Friday, December 4, 2026', '[airplane]', 'ORD', "Chicago O'Hare", '3:00 PM',
 'AA 3081', '[destination]', 'LAS', 'Las Vegas', '5:16 PM'
].join('\r\n');

test('Chicago acceptance replay: two inboxes, one itinerary, verified follow-up, no data loss', async () => {
 const files=new Map([['existing-itinerary','not modified']]);
 const command=async ([op,...args])=>{
  if(op==='HKEYS') return [...files.keys()];
  if(op==='HGET') return files.get(args[1])??null;
  assert.equal(op,'EVAL');
  const [,,key,id,old,metadata,content]=args;
  assert.match(key,/^james:files:v1:preview:/);
  if ((files.get(id)??'')!==old)return -1;
  files.set(id,metadata);
  files.set('bytes:'+id,content);
  return 1;
 };
 const store=createStore({command,environment:'preview'});
 const messages=['gmail','outlook'].map((inbox,i)=>({inbox,body,receivedDateTime:'2026-11-19T21:04:0'+i+'Z',authenticatedSender:sender}));
 const verified=()=>messages.map(m=>fromVerifiedAA(m,[sender])).filter(Boolean);
 const [candidate,other]=verified();
 assert.equal(candidate.id,other.id);
 await sync({},owner,store,verified);
 const followup=extract({
  subject:'Itinerary updated',receivedDateTime:'2026-11-23T21:00:00Z',
  preview:['Provider: AA','Booking reference: TEST42','Trip start: 2026-12-03','Trip end: 2026-12-04','Destination: ORD','Hotel: Synthetic QA Hotel','Pickup: Terminal 2'].join('\n')
 });
 assert.equal(followup.id,candidate.id);
 // This callback is an explicitly trusted synthetic fixture, not production
 // preview parsing. Provider authentication for live followups is separate.
 await sync({},owner,store,()=>[followup]);
 await sync({},owner,store,verified);
 assert.equal(files.size,3);
 assert.equal(files.get('existing-itinerary'),'not modified');
 const trip=JSON.parse(Buffer.from(files.get('bytes:'+candidate.id),'base64'));
 assert.ok(validTrip(trip));
 assert.equal(trip.start,'2026-12-03');
 assert.equal(trip.end,'2026-12-04');
 assert.equal(trip.stops.length,5);
 assert.match(trip.stops[1],/AA 3015.*2:09 PM.*7:58 PM/);
 assert.match(trip.stops[2],/AA 3081.*3:00 PM.*5:16 PM/);
 assert.deepEqual(trip.stops.slice(3),['Hotel: Synthetic QA Hotel','Pickup: Terminal 2']);
 assert.ok(!JSON.stringify(trip).includes('TEST42'));
});
