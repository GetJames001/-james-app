'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReader}=require('../lib/google/gmail-mail.js');
const {SCOPE}=require('../lib/google/gmail-connect.js');
const {collectReview}=require('../lib/attention/mail-review.cjs');
const at='2026-11-06T18:00:00.000Z';
function previous(provider,id){return {accountId:'owner',revision:1,...collectReview(null,'owner',[{id,subject:'Payment due'}],at,provider)};}
test('Gmail verifies archived, deleted, existing and failed saved messages read-only',async()=>{
 for(const state of ['archived','deleted','existing','failed']){
  const calls=[];
  const reader=createReader({env:{KV_REST_API_URL:'https://kv.invalid',KV_REST_API_TOKEN:'synthetic',GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic'},identity:()=> 'owner',fetchImpl:async(url,options)=>{
   calls.push({url,options});if(url==='https://kv.invalid')return Response.json({result:JSON.stringify({scope:SCOPE,refreshToken:'synthetic'})});
   if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic',scope:SCOPE});
   if(url.includes('/profile'))return Response.json({historyId:'123'});
   if(new URL(url).pathname.endsWith('/messages'))return Response.json({messages:[]});
   assert.match(url,/messages\/abc\?format=metadata/);
   if(state==='deleted')return Response.json({}, {status:404});if(state==='failed')return Response.json({}, {status:403});
   return Response.json({id:'abc',labelIds:state==='archived'?[]:['INBOX'],payload:{headers:[{name:'Subject',value:'Payment due'}]}});
  }});
  if(state==='failed')await assert.rejects(reader({previous:previous('gmail','gmail:abc')}));
  else {const data=await reader({previous:previous('gmail','gmail:abc')});assert.deepEqual(data.reconciliation.removedIds,state==='existing'?[]:['gmail:abc']);assert.equal(data.reconciliation.messages.length,state==='existing'?1:0);}
  assert.equal(calls.filter(c=>c.url.includes('gmail.googleapis.com')&&c.options.method!==undefined).length,0);
 }
});
test('Hotmail verifies Inbox membership without sends, read-state writes or Calendar calls',async()=>{
 const auth=require('../lib/auth.js'),handler=require('../api/microsoft/mail.js');
 process.env.JAMES_AUTH_EMAIL='synthetic@example.test';process.env.JAMES_SESSION_SECRET='synthetic-reconcile-secret-long-enough-1234';process.env.KV_REST_API_URL='https://kv.invalid';
 const original=global.fetch;
 try{for(const status of [200,404,403]){const calls=[];
  global.fetch=async(url,options)=>{calls.push({url,options});if(url==='https://kv.invalid')return Response.json({result:'synthetic'});
   if(url.includes('login.microsoftonline.com'))return Response.json({access_token:'synthetic'});
   if(url.includes('unreadItemCount'))return Response.json({unreadItemCount:0,totalItemCount:0});
   if(url.includes('/messages?'))return Response.json({value:[]});
   assert.match(url,/mailFolders\/inbox\/messages\/abc\?\$select=/);return Response.json(status===200?{id:'abc',subject:'Payment due'}:{},{status});
  };
  const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(data){this.body=data;return this;}};
  await handler({method:'GET',headers:{host:'www.getjames.ai',cookie:auth.SESSION_COOKIE+'='+auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)},query:{account:'personal',reviewCheckIds:'["abc"]'}},res);
  assert.equal(res.code,status===403?500:200);
  if(status!==403)assert.deepEqual(res.body.reconciliation.removedIds,status===404?['abc']:[]);
  assert.equal(calls.filter(c=>c.url.includes('graph.microsoft.com')&&c.options.method!==undefined).length,0);
 }}finally{global.fetch=original;}
});
