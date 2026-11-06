'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {estimate,readiness}=require('../lib/travel/routing');
const now=Date.parse('2026-11-06T18:00:00Z'),env={JAMES_ROUTING_ENABLED:'true',GOOGLE_MAPS_API_KEY:'synthetic-key'};
const input={origin:{kind:'address',address:'123 Example Street',confirmed:true},destination:'456 Example Avenue',appointmentStart:'2026-11-06T19:00:00Z'};
test('routing stays off without existing configuration and never calls provider',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error();};
 assert.equal(readiness({}).connected,false);
 assert.equal((await estimate(input,{env:{},fetchImpl,now})).reason,'configuration_missing');
 assert.equal((await estimate(input,{env:{GOOGLE_MAPS_API_KEY:'synthetic'},fetchImpl,now})).reason,'disabled');assert.equal(calls,0);
});
test('requires confirmed origin and fresh accurate device point before any paid call',async()=>{
 for(const origin of [{...input.origin,confirmed:false},{kind:'device',latitude:36,longitude:-115,accuracy:10,observedAt:now-300001},{kind:'device',latitude:36,longitude:-115,accuracy:2000,observedAt:now}]){
  assert.equal((await estimate({...input,origin},{env,now,fetchImpl:()=>assert.fail('unexpected provider call')})).reason,'starting_point_required');
 }
});
test('returns bounded current-traffic estimate without changing appointment',async()=>{
 const result=await estimate(input,{env,now,fetchImpl:async(url,options)=>{
  assert.equal(url,'https://routes.googleapis.com/directions/v2:computeRoutes');assert.equal(options.redirect,'error');
  const body=JSON.parse(options.body);assert.equal(body.routingPreference,'TRAFFIC_AWARE');assert.equal(body.origin.address,input.origin.address);
  return Response.json({routes:[{duration:'1200s',staticDuration:'900s',distanceMeters:10000}]});
 }});
 assert.equal(result.estimatedLeaveBy,'2026-11-06T18:30:00.000Z');assert.equal(result.trafficDelaySeconds,300);assert.equal(result.calendarChanged,false);assert.equal(result.trafficBasis,'current_at_request');assert.doesNotMatch(JSON.stringify(result),/synthetic|Example/);
});
test('provider configuration, limits and malformed replies remain safe',async()=>{
 for(const [status,reason] of [[403,'provider_configuration'],[429,'provider_limit'],[500,'provider_unavailable']])assert.equal((await estimate(input,{env,now,fetchImpl:async()=>new Response('private provider details',{status})})).reason,reason);
 assert.equal((await estimate(input,{env,now,fetchImpl:async()=>Response.json({routes:[{duration:'infinity'}]})})).status,'unavailable');
});
const {createHandler}=require('../lib/routes/routing');
test('route endpoint enforces authentication, same-origin POST and bounded input before provider calls',async()=>{
 for(const spec of [{authorized:false,method:'GET',code:401},{method:'DELETE',code:405},{method:'POST',body:{origin:'x',secret:'injected'},code:400},{method:'GET',query:{owner:'other'},code:400}]){
  const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  const handler=createHandler({env,now:()=>now,authorize:(req,res,options)=>{assert.equal(options.csrf,req.method==='POST');if(spec.authorized===false){res.status(401).json({error:'UNAUTHORIZED'});return false;}return true;},fetchImpl:()=>assert.fail('unexpected provider call')});
  await handler({method:spec.method,query:spec.query||{},body:spec.body},res);assert.equal(res.code,spec.code);
 }
});
