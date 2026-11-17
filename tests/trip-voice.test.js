'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {tripDirections}=require('../travel');
const trip={title:'Las Vegas to Eugene',start:'2026-11-22',end:'2026-11-23',route:'https://driveweatherapp.com/download?data=fixture',stops:['Nov 22: Leave Northwest Las Vegas. Stay overnight at Peppermill Resort Spa Casino in Reno.','Nov 23: Check out of Reno, continue via Klamath Falls, and stop in Bend for 3 hours.','Planned destination: 123 Example Lane, Eugene, OR 97408.']};
test('map legs retain intermediate stops and user destination without claiming GPS or traffic',()=>{
 const legs=tripDirections(trip);assert.equal(legs.length,4);
 assert.deepEqual(legs.map(l=>new URL(l.url).searchParams.get('destination')),['Reno','Klamath Falls','Bend','123 Example Lane, Eugene, OR 97408']);
 assert.equal(new URL(legs[0].url).searchParams.get('origin'),'Las Vegas');
 for(const leg of legs){assert.equal(new URL(leg.url).searchParams.get('api'),'1');assert.equal(leg.liveTrafficVerified,false);assert.match(leg.basis,/Maps chooses roads/);}
 assert.deepEqual(tripDirections({...trip,route:'',mode:'flight'}),[]);
});
test('voice reads saved trips off the Travel page, shares pending reads and retains honest failure states',async()=>{
 let lists=0,reads=0,fail=false,invalid=false,release;
 const section={classList:{contains:()=>false},querySelectorAll:()=>[]};
 const window={addEventListener(){}};
 const context=vm.createContext({URL,URLSearchParams,Date,console,window,location:{hash:''},document:{getElementById:id=>id==='travelCards'?{}:id==='travel'?section:null,addEventListener(){}}});
 vm.runInContext(fs.readFileSync(require.resolve('../travel'),'utf8'),context);
 context.list=async()=>{lists++;if(fail)throw Error();await new Promise(r=>release=r);return {files:[{id:'saved-trip',name:'itinerary.james-trip.json'},...(invalid?[{id:'invalid-trip',name:'invalid.james-trip.json'}]:[])]};};
 context.read=async id=>{reads++;return {text:async()=>JSON.stringify(id==='saved-trip'?trip:{title:'broken'})};};
 vm.runInContext('mountTravel({list,read})',context);
 assert.equal(window.jamesTripCalendar.snapshot().status,'not_loaded');
 const a=window.jamesTripCalendar.read(),b=window.jamesTripCalendar.read();assert.equal(lists,1);release();await Promise.all([a,b]);assert.equal(reads,1);
 const result=window.jamesTripCalendar.snapshot();assert.equal(result.status,'ready');assert.equal(result.trips[0].start,'2026-11-22');assert.equal(result.trips[0].directions.length,4);assert.equal(result.trips[0].driveWeather.connected,false);assert.equal(JSON.stringify(result).includes('data=fixture'),false);
 fail=true;assert.equal((await window.jamesTripCalendar.read()).status,'stale');assert.equal(window.jamesTripCalendar.snapshot().trips.length,1);
 fail=false;invalid=true;const partial=window.jamesTripCalendar.read();release();assert.equal((await partial).status,'partial');assert.equal(reads,2,'cached immutable file plus invalid new file');
});
