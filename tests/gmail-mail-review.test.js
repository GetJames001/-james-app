'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReader,createHandler}=require('../lib/google/gmail-mail.js');
const {SCOPE,tokenKey}=require('../lib/google/gmail-connect.js');
const {collectReview,collectFailure,projectReview}=require('../lib/attention/mail-review.cjs');
const {createHandler:createScan}=require('../lib/routes/attention-scan.js');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'fixture',GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',KV_REST_API_URL:'https://store.invalid',KV_REST_API_TOKEN:'synthetic-kv'};
const at='2026-11-06T17:00:00.000Z',later='2026-11-06T18:00:00.000Z';
function fixture({missing=false,failMessage=false,badList=false}={}){const calls=[];let historyId='123';const reader=createReader({env,identity:()=> 'owner',fetchImpl:async(url,options)=>{calls.push({url,options});
 if(url===env.KV_REST_API_URL){assert.deepEqual(JSON.parse(options.body),['GET',tokenKey(env,'owner')]);return Response.json({result:missing?null:JSON.stringify({scope:SCOPE,refreshToken:'synthetic-refresh',email:'private@example.test'})});}
 if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access',scope:SCOPE});
 const u=new URL(url);if(u.pathname.endsWith('/profile'))return Response.json({historyId});assert.equal(u.origin,'https://gmail.googleapis.com');assert.equal(options.method,undefined);
 if(u.pathname.endsWith('/messages')){assert.equal(u.searchParams.get('maxResults'),'25');assert.equal(u.searchParams.get('labelIds'),'INBOX');assert.equal(u.searchParams.get('includeSpamTrash'),'false');return Response.json({messages:badList?[{id:'../foreign'}]:[{id:'abc'}],nextPageToken:'opaque-private-cursor'});}
 if(failMessage)throw Error('Private provider text');
 assert.equal(u.pathname,'/gmail/v1/users/me/messages/abc');
 return Response.json({id:'abc',snippet:'Please confirm your interview.',internalDate:String(Date.parse(at)),labelIds:['INBOX','IMPORTANT','STARRED'],payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'Interview invitation'},{name:'From',value:'Fixture sender'}],body:{data:Buffer.from('<script>untrusted()</script> Plain message.').toString('base64url')}}});
 }});return {reader,calls,setHistory:value=>{historyId=value;}};}
test('Gmail Inbox uses only separate saved grant, bounded metadata reads and no writes',async()=>{
 const f=fixture(),data=await f.reader();assert.equal(data.messages.length,1);assert.equal(data.messages[0].id,'gmail:abc');assert.equal(data.hasMore,true);assert.equal(data.mailboxWide,false);assert.equal(data.messages[0].bodyText,undefined);assert.equal(f.calls.length,5);assert.doesNotMatch(JSON.stringify(data),/synthetic-|private@example|opaque-private/);
 assert.equal(f.calls.filter(c=>c.url===env.KV_REST_API_URL).length,1);
});
test('Gmail original is plain text and does not fetch attachments or mutate read state',async()=>{
 const f=fixture(),data=await f.reader({messageId:'abc'});assert.match(data.message.bodyText,/<script>/);assert.equal(f.calls.length,3);assert.equal(new URL(f.calls[2].url).searchParams.get('format'),'full');assert.equal(data.bodyLimited,true);
});
test('missing connection stays disconnected; malformed or incomplete Inbox cannot claim a complete page',async()=>{
 const f=fixture({missing:true});assert.deepEqual(await f.reader(),{connected:false,messages:[]});assert.equal(f.calls.length,1);
 for(const options of [{failMessage:true},{badList:true}]){const f=fixture(options);await assert.rejects(f.reader());}
});
test('read route refuses unsigned, write methods and user-selected mailbox or unsafe message IDs',async()=>{
 let calls=0;const handler=createHandler({authorize:(req,res)=>{if(req.headers.cookie==='fixture')return true;res.status(401).json({});return false;},reader:async()=>{calls++;return {connected:true,messages:[]};}});
 for(const [method,cookie,query,status] of [['GET','',{},401],['POST','fixture',{},405],['GET','fixture',{account:'other'},400],['GET','fixture',{messageId:'../foreign'},400],['GET','fixture',{messageId:['abc']},400],['GET','fixture',{},200]]){
 const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};await handler({method,headers:{cookie},query},res);assert.equal(res.code,status);
 }assert.equal(calls,1);
});
const snapshot=next=>({accountId:'owner',revision:1,...next});
const bill={id:'shared',subject:'Payment due',sender:'Fixture',preview:'Verify source'};
test('Gmail and Hotmail retain distinct identities and saved evidence across checks and failure',()=>{
 const old=snapshot(collectReview(null,'owner',[bill],at)),next=snapshot(collectReview(old,'owner',[{...bill,id:'gmail:shared'}],later,'gmail'));
 const view=projectReview(next);assert.equal(view.inventoryCount,2);assert.deepEqual(view.items.map(i=>i.id),['shared','gmail:shared']);assert.equal(view.sources.gmail.checkedAt,later);assert.equal(view.sources.hotmail.checkedAt,at);
 const failed=snapshot(collectFailure(next,'owner',later,'gmail'));assert.equal(projectReview(failed).items.length,2);assert.equal(projectReview(failed).sources.gmail.stale,true);assert.equal(projectReview(failed).sources.hotmail.stale,false);
 const restored=snapshot(collectReview(failed,'owner',[],later,'gmail'));assert.equal(projectReview(restored).items.length,2);assert.equal(projectReview(restored).sources.gmail.stale,false);
});
test('one failed mailbox does not erase candidates or stop the other source from saving',async()=>{
 for(const failed of ['hotmail','gmail']){
 let saved=null;const store={load:async()=>null,save:async input=>{saved=snapshot(input);return {snapshot:saved};}};
 const handler=createScan({authorize:()=>true,identity:()=> 'owner',store,now:()=>at,readMail:async()=>{if(failed==='hotmail')throw Error();return {connected:true,messages:[bill]};},readGmail:async()=>{if(failed==='gmail')throw Error();return {connected:true,messages:[{...bill,id:'gmail:abc'}]};}});
 const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};await handler({method:'POST',headers:{'content-type':'application/json'},query:{},body:{}},res);assert.equal(res.code,200);assert.equal(res.body.partial,true);assert.equal(res.body.sources[failed],'unavailable');assert.equal(projectReview(saved).items.length,1);assert.equal(projectReview(saved).sources[failed].stale,true);
 }
});

test('unchanged Gmail history reuses verified page metadata without rereading 25 message details',async()=>{
 const f=fixture(),first=await f.reader();assert.equal(f.calls.length,5);
 const previous=snapshot(collectReview(null,'owner',first.messages,at,'gmail',first.checkpoint));
 const second=await f.reader({previous});assert.equal(f.calls.length,8);assert.deepEqual(second.messages,first.messages);assert.deepEqual(second.checkpoint,first.checkpoint);f.setHistory('124');const changed=await f.reader({previous});assert.equal(f.calls.length,13);assert.equal(changed.checkpoint.historyId,'124','new mailbox history forces fresh metadata reads');
});
