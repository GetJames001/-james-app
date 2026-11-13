'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../lib/routes/voice.js'),auth=require('../lib/auth.js');
process.env.JAMES_AUTH_EMAIL='voice-fixture@example.test';process.env.JAMES_SESSION_SECRET='voice-test-secret-at-least-thirty-two-characters';
const scope={accountId:'account-fixture',conversationId:'conversation-fixture',generation:1};
function res(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(body){this.body=body;return this},send(body){this.body=body;return this}};}
function req(){return {method:'POST',headers:{host:'www.getjames.ai',origin:'https://www.getjames.ai','content-type':'application/json',cookie:`${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`},body:{sdp:'v=0\r\nsynthetic-only',scope:{...scope},voice:'marin'}};}
test('voice refuses unauthenticated and foreign-origin requests before any provider or storage access',async()=>{
 let calls=0;const handler=createHandler({store:{execute:async()=>{calls++;}},fetchImpl:async()=>{calls++;}});
 for(const kind of ['no_session','foreign']){const request=req(),response=res();if(kind==='no_session')delete request.headers.cookie;else request.headers.origin='https://foreign.example';await handler(request,response);assert.equal(response.code,kind==='no_session'?401:403);assert.equal(calls,0);}
});
test('voice validates current host conversation and bounded input before calling provider',async()=>{
 let calls=0;const handler=createHandler({store:{execute:async()=>({...scope,status:'ended'})},fetchImpl:async()=>{calls++;},env:{OPENAI_API_KEY:'synthetic-only'}});
 const request=req(),response=res();await handler(request,response);assert.equal(response.code,409);assert.equal(calls,0);
 request.body.voice='unapproved-voice';const bad=res();await handler(request,bad);assert.equal(bad.code,400);assert.equal(calls,0);
});
test('voice retains key server-side, uses correlated manual turns and only allowlisted read, review and navigation tools',async()=>{
 let form,headers;const handler=createHandler({store:{execute:async()=>({...scope,status:'ready'})},fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/realtime/calls');form=options.body;headers=options.headers;return {ok:true,text:async()=>'v=0\r\nanswer'}},env:{OPENAI_API_KEY:'synthetic-private-key'}});
 const response=res();await handler(req(),response);assert.equal(response.code,200);assert.equal(response.body,'v=0\r\nanswer');assert.doesNotMatch(response.body,/private-key/);assert.equal(headers.Authorization,'Bearer synthetic-private-key');
 const session=JSON.parse(form.get('session'));assert.equal(session.audio.output.voice,'marin');assert.deepEqual(session.audio.input.noise_reduction,{type:'far_field'});assert.equal(session.audio.input.turn_detection.create_response,false);assert.equal(session.audio.input.turn_detection.interrupt_response,false);
 assert.deepEqual(session.tools.map(t=>t.name),['create_reminder','read_reminders','find_places','read_route','prepare_appointment','read_appointment_review','read_weather','read_briefing','read_calendar','ask_james','open_page']);assert.match(response.headers['Cache-Control'],/no-store/);assert.ok(session.tools.find(t=>t.name==='open_page').parameters.properties.page.enum.includes('wardrobe'));assert.match(session.instructions,/no fixed script/);assert.match(session.instructions,/light, refined British English accent/);assert.match(session.instructions,/dry, understated humour/);assert.match(session.instructions,/Do not claim you read his closet/);
});
test('provider rejection never masquerades as James sign-out or leaks provider details',async()=>{
 for(const status of [401,403,429,500]){const handler=createHandler({store:{execute:async()=>({...scope,status:'ready'})},fetchImpl:async()=>({ok:false,status,text:async()=>'PRIVATE_PROVIDER_DETAIL'}),env:{OPENAI_API_KEY:'synthetic-only'}});const response=res();await handler(req(),response);assert.equal(response.code,502);assert.doesNotMatch(JSON.stringify(response),/PRIVATE_PROVIDER_DETAIL|synthetic-only/);}
});
test('voice distinguishes exhausted quota from rate limiting without exposing provider text',async()=>{
 for(const [code,expected] of [['insufficient_quota','VOICE_PROVIDER_QUOTA'],['credit_balance_exhausted','VOICE_PROVIDER_QUOTA'],['project_spend_limit_exceeded','VOICE_PROVIDER_QUOTA'],['rate_limit_exceeded','VOICE_PROVIDER_RATE_LIMIT'],['unknown_private_detail','VOICE_PROVIDER_LIMIT']]){
  const handler=createHandler({store:{execute:async()=>({...scope,status:'ready'})},fetchImpl:async()=>({ok:false,status:429,text:async()=>JSON.stringify({error:{code,message:'PRIVATE_PROVIDER_DETAIL'}})}),env:{OPENAI_API_KEY:'synthetic-only'}});
  const response=res();await handler(req(),response);assert.deepEqual(response.body,{error:expected});assert.doesNotMatch(JSON.stringify(response),/PRIVATE_PROVIDER_DETAIL|unknown_private_detail|synthetic-only/);
 }
});
