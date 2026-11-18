'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validTrip,tripDirections}=require('../travel');
const trip={title:'Outbound Oregon drive',start:'2026-11-22',mode:'driving',stops:['Old Sunday Reno stay canceled. Optional return stay in Reno.'],drivingLegs:[
 {label:'Outbound via CA-58 and I-5',origin:'Las Vegas, NV',destination:'Eugene, OR',waypoints:['CA-58, Bakersfield, CA','I-5, California','I-5, Oregon']}
]};
test('explicit route wins over narrative and title parsing, and round-trips as saved JSON',()=>{
 const saved=JSON.parse(JSON.stringify(trip));assert.equal(validTrip(saved),true);
 const legs=tripDirections(saved);assert.equal(legs.length,1);
 const url=new URL(legs[0].url);assert.equal(url.origin,'https://www.google.com');
 assert.equal(url.searchParams.get('waypoints'),trip.drivingLegs[0].waypoints.join('|'));
 assert.equal(url.searchParams.get('travelmode'),'driving');assert.equal(url.searchParams.get('api'),'1');
 assert.equal(legs[0].liveTrafficVerified,false);assert.match(legs[0].basis,/recalculates/);
 assert.equal(JSON.stringify(legs).includes('Reno'),false);
});
test('invalid explicit routes fail closed instead of reviving the old route',()=>{
 for(const drivingLegs of [null,[],{},[{}],[{...trip.drivingLegs[0],waypoints:['a','b','c','d']}],[{...trip.drivingLegs[0],origin:'a|b'}],[{...trip.drivingLegs[0],destination:'x\nY'}],[{...trip.drivingLegs[0],label:' '}],[{...trip.drivingLegs[0],origin:'😀'.repeat(100),destination:'😀'.repeat(100)}]]){
   const bad={...trip,drivingLegs};assert.equal(validTrip(bad),false);assert.deepEqual(tripDirections(bad),[]);
 }
});
test('structured locations cannot become executable or third-party links',()=>{
 const odd={...trip,drivingLegs:[{label:'<script>alert(1)</script>',origin:'javascript:alert(1)',destination:'https://evil.example/?a=b&x=1'}]};
 assert.equal(validTrip(odd),true);const url=new URL(tripDirections(odd)[0].url);
 assert.equal(url.origin,'https://www.google.com');assert.equal(url.searchParams.get('destination'),odd.drivingLegs[0].destination);
});
test('omitting explicit legs retains legacy trips unchanged',()=>{
 const old={...trip,title:'Las Vegas to Eugene'};delete old.drivingLegs;
 assert.equal(validTrip(old),true);assert.equal(tripDirections(old).length,1);
});
test('explicit itinerary cover and guide do not parse canceled or return stops',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../travel'),'utf8');
 assert.match(source,/for\(const line of trip\.drivingLegs \? \[\] : trip\.stops\)/);
 assert.match(source,/for\(const stop of trip\.drivingLegs \? \[\] : trip\.stops\)/);
 assert.match(source,/trip\.drivingLegs\.map\(leg=>leg\.label\)/);
});

test('travel presentation stays concise without exposing map addresses in city guide',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../travel'),'utf8');
 assert.equal(source.includes("item.append(tag('p', 'Saved route waypoints"),false);
 assert.match(source,/const end=trip\?\.destinationCity\|\|trip\?\.title/);
});
