'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../lib/routes/places');
const env={GOOGLE_MAPS_API_KEY:'synthetic-private-key',JAMES_ROUTING_ENABLED:'true'};
async function run({body={query:'Albertsons Hualapai Las Vegas'},query={},authorized=true,status=200,data={places:[]},config=env}={}){
 let call;const handler=createHandler({env:config,authorize:(req,res,options)=>{assert.equal(options.csrf,true);if(!authorized){res.status(401).json({error:'UNAUTHORIZED'});return false;}return true;},fetchImpl:async(url,options)=>{call={url,options};return Response.json(data,{status});}});
 const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.body=data;return this;}};await handler({method:'POST',headers:{'content-type':'application/json'},body,query},res);return {res,call};
}
test('places uses fixed Google endpoint and bounded structured fields without sending a driving origin',async()=>{
 const {res,call}=await run({data:{places:[{id:'fixture',displayName:{text:'Albertsons'},formattedAddress:'Confirmed fixture address',googleMapsUri:'https://maps.google.com/?cid=123',businessStatus:'OPERATIONAL'}]}});
 assert.equal(call.url,'https://places.googleapis.com/v1/places:searchText');const body=JSON.parse(call.options.body);assert.equal(body.pageSize,4);assert.equal(body.textQuery,'Albertsons Hualapai Las Vegas');assert.equal(body.locationBias,undefined);assert.equal(res.body.places[0].name,'Albertsons');assert.equal(res.body.closestVerified,false);assert.doesNotMatch(JSON.stringify(res),/synthetic-private-key/);
});
test('unknown or denied Places permission is explicit and never masquerades as Calendar failure',async()=>{
 for(const [status,reason] of [[403,'places_permission_required'],[429,'provider_limit'],[500,'provider_unavailable']]){const {res}=await run({status,data:{error:{message:'PRIVATE_PROVIDER_INFORMATION'}}});assert.equal(res.body.reason,reason);assert.deepEqual(res.body.places,[]);assert.doesNotMatch(JSON.stringify(res),/PRIVATE_PROVIDER_INFORMATION/);}
 const result=await run({config:{}});assert.equal(result.call,undefined);assert.equal(result.res.body.reason,'maps_configuration_missing');
});
test('rejects account/location injection, controls and unauthenticated queries before provider calls',async()=>{
 for(const options of [{authorized:false},{body:{query:'test',latitude:36}},{query:{owner:'other'}},{body:{query:'a'.repeat(401)}},{body:{query:'test\nsearch'}}]){const {res,call}=await run(options);assert.ok([400,401].includes(res.code));assert.equal(call,undefined);}
});
test('no matches are partial evidence; closed stores and untrusted URLs are not promoted',async()=>{
 assert.equal((await run()).res.body.status,'no_matches');const {res}=await run({data:{places:[{id:'closed',displayName:{text:'Closed'},formattedAddress:'Fixture address',businessStatus:'CLOSED_PERMANENTLY'},{id:'fixture',displayName:{text:'Candidate'},formattedAddress:'Fixture address',googleMapsUri:'https://untrusted.invalid/private'}]}});assert.equal(res.body.places.length,1);assert.equal(res.body.places[0].mapsUrl,null);assert.match(res.body.coverage,/not_exhaustive/);
});
