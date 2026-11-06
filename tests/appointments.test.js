'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReview,validate}=require('../lib/appointments/core');
const {createGoogle,SCOPE,grantKey}=require('../lib/appointments/google');
const {createHandler}=require('../lib/routes/appointments');
const {createHandlers,COOKIE}=require('../lib/appointments/connect');
const now=Date.parse('2026-11-06T20:00:00Z'),details={title:'Dairy Queen test',location:'Confirmed example address, Summerlin, NV',start:'2026-11-07T18:00:00-08:00',end:'2026-11-07T19:00:00-08:00',timeZone:'America/Los_Angeles'};
const env={JAMES_SESSION_SECRET:'synthetic-session-secret-long-enough-for-test',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'fix/calendar-refresh-diagnosis-20261031',VERCEL_BRANCH_URL:'fixture.vercel.app',JAMES_GOOGLE_PREVIEW_CALLBACK_URL:'https://fixture.vercel.app/api/google/callback',GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',KV_REST_API_URL:'https://kv.invalid',KV_REST_API_TOKEN:'synthetic-kv'};
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.body=data;return this;},send(data){this.body=data;return this;}});
const review=options=>createReview({secret:env.JAMES_SESSION_SECRET,owner:'owner',branch:'preview:test',now:()=>now,...options});
test('review requires exact complete future appointment with timezone; rejects invented fields',()=>{
 for(const change of [{end:details.start},{timeZone:'not-a-zone'},{start:'tomorrow at six'},{location:''},{title:''},{attendees:['x']}])assert.throws(()=>validate({...details,...change},now));
 const draft=review().prepare(details);assert.equal(draft.status,'review_required');assert.equal(draft.details.start,'2026-11-08T02:00:00.000Z');assert.equal(review().verify(draft.reviewToken).details.location,details.location);
});
test('signed confirmation rejects tamper, wrong owner/branch and expiry; retries keep event id',()=>{
 const draft=review().prepare(details),id=review().verify(draft.reviewToken).eventId;
 assert.equal(review().verify(draft.reviewToken).eventId,id);assert.match(id,/^[a-f0-9]{64}$/);
 for(const instance of [review({owner:'other'}),review({branch:'production'}),review({now:()=>now+600001})])assert.throws(()=>instance.verify(draft.reviewToken));
 assert.throws(()=>review().verify(draft.reviewToken.replace(/^./,'!')));
});
test('provider inserts only reviewed event, no guests, exact destination; replay never creates duplicate',async()=>{
 let event=null,insertions=0;const commands=[];
 const google=createGoogle({env,owner:'owner',fetchImpl:async(url,options)=>{
  if(url===env.KV_REST_API_URL){commands.push(JSON.parse(options.body));return Response.json({result:JSON.stringify({scope:SCOPE,calendarId:'synthetic-calendar',refreshToken:'synthetic-refresh'})});}
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access',scope:SCOPE});
  assert.equal(new URL(url).hostname,'www.googleapis.com');
  if(options.method==='POST'){insertions++;assert.equal(new URL(url).searchParams.get('sendUpdates'),'none');event=JSON.parse(options.body);assert.equal(event.attendees,undefined);assert.equal(event.location,details.location);return Response.json(event);}
  return event?Response.json(event):Response.json({error:{}},{status:404});
 }});
 const confirmed=review().verify(review().prepare(details).reviewToken);
 assert.equal((await google.create(confirmed)).status,'created');assert.equal((await google.create(confirmed)).status,'created');assert.equal(insertions,1);assert.ok(commands.every(c=>c[0]==='GET'&&c[1]===grantKey(env,'owner')));
});
test('provider timeouts remain unconfirmed and wrong scope never inserts',async()=>{
 for(const scope of [SCOPE,'https://www.googleapis.com/auth/calendar.readonly']){
  let posts=0;const google=createGoogle({env,owner:'owner',fetchImpl:async(url,options)=>{
   if(url===env.KV_REST_API_URL)return Response.json({result:JSON.stringify({scope:SCOPE,calendarId:'test',refreshToken:'fixture'})});
   if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test',scope});
   if(options.method==='POST'){posts++;throw Error('private provider information');}return Response.json({},{status:404});
  }});
  await assert.rejects(google.create(review().verify(review().prepare(details).reviewToken)),new RegExp(scope===SCOPE?'CALENDAR_SAVE_UNCONFIRMED':'CALENDAR_PERMISSION_REQUIRED'));assert.equal(posts,scope===SCOPE?1:0);
 }
});
test('endpoint authenticates and requires same-origin POST; preparation cannot write Calendar',async()=>{
 let writes=0,csrf;
 const handler=createHandler({env,identity:()=> 'owner',now:()=>now,authorize:(req,res,options)=>{csrf=options.csrf;return true;},googleFactory:()=>({grant:async()=>null,create:async()=>{writes++;}})});
 let response=res();await handler({method:'POST',headers:{'content-type':'application/json'},query:{},body:{action:'prepare',details}},response);assert.equal(response.code,200);assert.equal(response.body.status,'review_required');assert.equal(writes,0);assert.equal(csrf,true);
 response=res();await handler({method:'POST',headers:{'content-type':'application/json'},query:{},body:{action:'confirm',reviewToken:response.body?.reviewToken||'bad'}},response);assert.equal(response.code,400);assert.equal(writes,0);
 const denied=createHandler({authorize:(req,res)=>{res.status(401).json({error:'UNAUTHORIZED'});return false;},googleFactory:()=>assert.fail()});response=res();await denied({method:'GET'},response);assert.equal(response.code,401);
});
test('OAuth keeps existing Calendar token untouched, binds same calendar and rejects replay state',async()=>{
 const calls=[],handler=createHandlers({env,identity:()=> 'owner',authorize:()=>true,fetchImpl:async(url,options)=>{
  calls.push({url,options});if(url===env.KV_REST_API_URL){const command=JSON.parse(options.body);if(command[0]==='GET'){assert.equal(command[1],'google:diagnostic:calendar-refresh-20261031:refresh_token');return Response.json({result:'old-refresh'});}assert.equal(command[0],'SET');assert.equal(command[1],grantKey(env,'owner'));return Response.json({result:'OK'});}
  if(url==='https://oauth2.googleapis.com/token'){const exchange=options.body.has('code');return Response.json(exchange?{refresh_token:'new-refresh',access_token:'new-access',scope:SCOPE}:{access_token:'old-access'});}
  return Response.json({id:'same-calendar'});
 }});
 let response=res();await handler.connect({method:'POST',headers:{host:'fixture.vercel.app'}},response);const url=new URL(response.body.authorizationUrl),state=url.searchParams.get('state');assert.ok(url.searchParams.get('scope').includes(SCOPE));assert.ok(response.headers['Set-Cookie'].startsWith(COOKIE+'='));
 response=res();await handler.callback({method:'GET',headers:{host:'fixture.vercel.app',cookie:COOKIE+'='+state},query:{state,code:'synthetic-code'}},response);assert.equal(response.code,200);assert.match(response.body,/connected/);assert.match(response.headers['Set-Cookie'],/Max-Age=0/);
 const before=calls.length;response=res();await handler.callback({method:'GET',headers:{},query:{state,code:'synthetic-code'}},response);assert.equal(response.code,400);assert.equal(calls.length,before);
 assert.doesNotMatch(String(response.body),/synthetic-code|old-refresh|new-refresh/);
});
test('OAuth rejects different Google account without saving grant',async()=>{
 let reads=0,writes=0;const handler=createHandlers({env,identity:()=> 'owner',authorize:()=>true,fetchImpl:async(url,options)=>{
  if(url===env.KV_REST_API_URL){const command=JSON.parse(options.body);if(command[0]==='SET')writes++;return Response.json({result:'old-refresh'});}
  if(url==='https://oauth2.googleapis.com/token')return Response.json({refresh_token:'new-refresh',access_token:'access',scope:SCOPE});
  return Response.json({id:++reads===1?'different-calendar':'original-calendar'});
 }});
 const state='appointment-'+'a'.repeat(48),response=res();await handler.callback({method:'GET',headers:{host:'fixture.vercel.app',cookie:COOKIE+'='+state},query:{state,code:'fixture'}},response);assert.equal(response.code,503);assert.equal(writes,0);assert.match(response.body,/calendar_verification/);
});
