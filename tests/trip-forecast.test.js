'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../lib/routes/trip-forecast');
const place={name:'Bend',admin1:'Oregon',country_code:'US',latitude:44.05,longitude:-121.32,timezone:'America/Los_Angeles'};
const values={weather_code:61,temperature_2m_max:49,temperature_2m_min:30,precipitation_probability_max:70,precipitation_sum:0.2,snowfall_sum:0,wind_speed_10m_max:12,wind_gusts_10m_max:22};
const units={weather_code:'wmo code',temperature_2m_max:'°F',temperature_2m_min:'°F',precipitation_probability_max:'%',precipitation_sum:'inch',snowfall_sum:'cm',wind_speed_10m_max:'mp/h',wind_gusts_10m_max:'mp/h'};
function fixture({results=[place],forecast,authorize=()=>true}={}){
 const calls=[],now=()=>new Date('2026-11-17T17:00:00Z');
 const handler=createHandler({authorize,now,fetchImpl:async input=>{const url=new URL(input);calls.push(url);if(calls.length===1)return {ok:true,json:async()=>({results})};return {ok:true,json:async()=>forecast||({timezone:place.timezone,daily:{time:['2026-11-23'],...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,[v]]))},daily_units:units})};}});
 return {calls,run:async(query={location:'Bend, Oregon',country:'US',date:'2026-11-23'})=>{const res={status(n){this.code=n;return this;},json(body){this.body=body;return this;},setHeader(){},end(){}};await handler({method:'GET',query},res);return res;}};
}
test('trip forecast requests the saved travel date, location and explicit units',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.body.status,'ready');assert.equal(r.body.values.precipitation_probability_max,70);assert.equal(r.body.values.temperature_2m_max,49);assert.equal(r.body.date,'2026-11-23');assert.match(r.body.coverage,/not arrival-hour/);assert.equal(f.calls[0].searchParams.get('name'),'Bend, Oregon');assert.equal(f.calls[1].searchParams.get('start_date'),'2026-11-23');assert.equal(f.calls[1].searchParams.get('end_date'),'2026-11-23');assert.equal(f.calls[1].searchParams.get('wind_speed_unit'),'mph');
});
test('missing permission and invalid input never call external providers',async()=>{
 const denied=fixture({authorize:()=>false});await denied.run();assert.equal(denied.calls.length,0);
 for(const bad of [{location:['Bend'],country:'US',date:'2026-11-23'},{location:'Bend',country:'US',date:'2026-02-30'}]){const f=fixture();assert.equal((await f.run(bad)).code,400);assert.equal(f.calls.length,0);}
});
test('ambiguous, missing and out-of-range destinations never invent forecasts',async()=>{
 for(const [options,status] of [[{results:[]},'location_not_found'],[{results:[place,{...place,admin1:'Other'}]},'ambiguous_location']]){const f=fixture(options);assert.equal((await f.run()).body.status,status);assert.equal(f.calls.length,1);}
 for(const date of ['2026-11-16','2026-12-03']){const f=fixture();assert.equal((await f.run({location:'Bend, Oregon',country:'US',date})).body.status,'outside_forecast_horizon');assert.equal(f.calls.length,1);}
});
test('missing fields are partial, a wrong date or malformed result is unavailable',async()=>{
 const partial={timezone:place.timezone,daily:{time:['2026-11-23'],weather_code:[61],temperature_2m_max:[49],temperature_2m_min:[30]},daily_units:units};
 const r=await fixture({forecast:partial}).run();assert.equal(r.body.status,'partial');assert.ok(r.body.missing.includes('snowfall_sum'));assert.equal(r.body.values.snowfall_sum,undefined);
 partial.daily.time=['2026-11-22'];const bad=await fixture({forecast:partial}).run();assert.equal(bad.code,502);assert.equal(bad.body.status,'unavailable');
});
