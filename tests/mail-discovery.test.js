'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {discover}=require('../lib/attention/mail-discovery.cjs');
const {collectReview,projectReview,decideReview}=require('../lib/attention/mail-review.cjs');
const at='2026-11-06T18:00:00.000Z',later='2026-11-06T18:00:11.000Z';
const mail=id=>({id,subject:'Payment due',preview:'Statement details'}),save=next=>({accountId:'owner',revision:1,...next});
test('latest page always wins while saved older cursor advances and completes',async()=>{
 const prior={provenance:[{collector:'test',discovery:{cursor:'25',failed:false,lastCompletedAt:null}}]};let used;
 const next=await discover(prior,'test',{messages:[{...mail('latest'),preview:'Newest'},mail('new')],nextCursor:'25'},async cursor=>{used=cursor;return {messages:[{...mail('latest'),preview:'Old'},mail('old')],nextCursor:null};},at);
 assert.equal(used,'25');assert.equal(next.messages.length,3);assert.equal(next.messages.find(m=>m.id==='latest').preview,'Newest');assert.equal(next.discovery.lastCompletedAt,at);assert.equal(next.discovery.cursor,null);
});
test('failed older page preserves latest and restarts traversal without claiming completion',async()=>{
 const prior={provenance:[{collector:'test',discovery:{cursor:'50',lastCompletedAt:null}}]};
 const next=await discover(prior,'test',{messages:[mail('new')],nextCursor:'25'},async()=>{throw Error('Provider unavailable');},at);
 assert.deepEqual(next.messages,[mail('new')]);assert.equal(next.discovery.failed,true);assert.equal(next.discovery.cursor,'25');assert.equal(next.discovery.lastCompletedAt,null);
});
test('handled content is removed after Undo while unchanged fingerprint remains suppressed',()=>{
 let snapshot=save(collectReview(null,'owner',[mail('a')],at));
 const key=projectReview(snapshot).items[0].reviewKey;snapshot=save(decideReview(snapshot,key,'handled',at));
 const within=save(collectReview(snapshot,'owner',[],at));assert.equal(within.state.scans[0].pages[0][0].mail.preview,'Statement details');
 snapshot=save(collectReview(snapshot,'owner',[],later));const event=snapshot.state.scans[0].pages[0][0];assert.equal(event.id,key);assert.deepEqual(event.mail,{id:'a',reviewHandled:true});assert.doesNotMatch(JSON.stringify(snapshot),/Statement details|Payment due/);
 snapshot=save(collectReview(snapshot,'owner',[mail('a')],later));assert.equal(projectReview(snapshot).items.length,0);
});
test('routine non-suggestion mail does not accumulate beyond current page',()=>{
 let snapshot=null;
 for(let n=0;n<20;n++)snapshot=save(collectReview(snapshot,'owner',Array.from({length:25},(_,i)=>({id:n+'-'+i,subject:'General news',preview:'A routine newsletter'})),at));
 assert.equal(snapshot.state.scans[0].pages.flat().length,25);assert.equal(projectReview(snapshot).items.length,0);
});
test('discovery cursors are saved internally but projected coverage contains no cursor',()=>{
 const snapshot=save(collectReview(null,'owner',[mail('a')],at,'gmail',null,null,{cursor:'private-page-token',failed:false,lastCompletedAt:null}));
 assert.doesNotMatch(JSON.stringify(projectReview(snapshot)),/private-page-token/);assert.equal(projectReview(snapshot).sources.gmail.discovery.inProgress,true);
});
test('public Gmail response excludes all internal checkpoints and reconciliation IDs',async()=>{
 const handler=require('../lib/google/gmail-mail.js').createHandler({authorize:()=>true,reader:async()=>({connected:true,messages:[],checkpoint:{nextCursor:'private-page-token'},discovery:{cursor:'private-page-token'},reconciliation:{removedIds:['private-id']},nextCursor:'private-page-token'})});
 const res={setHeader(){},status(){return this;},json(value){this.body=value;}};await handler({method:'GET',query:{},headers:{}},res);assert.deepEqual(res.body,{connected:true,messages:[]});
});
test('Gmail advances older pages even when latest mailbox history is unchanged',async()=>{
 const {createReader}=require('../lib/google/gmail-mail.js'),{SCOPE}=require('../lib/google/gmail-connect.js');const calls=[];
 const reader=createReader({env:{KV_REST_API_URL:'https://kv.invalid'},identity:()=> 'owner',fetchImpl:async(url,options)=>{
  calls.push(url);if(url==='https://kv.invalid')return Response.json({result:JSON.stringify({scope:SCOPE,refreshToken:'synthetic'})});
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'synthetic'});
  const u=new URL(url);if(u.pathname.endsWith('/profile'))return Response.json({historyId:'100'});
  if(u.pathname.endsWith('/messages'))return Response.json(u.searchParams.get('pageToken')==='older'?{messages:[{id:'b'}]}:{messages:[{id:'a'}],nextPageToken:'older'});
  const id=u.pathname.split('/').at(-1);return Response.json({id,labelIds:['INBOX'],payload:{headers:[{name:'Subject',value:'Payment due'}]}});
 }});
 const first=await reader();let snapshot=save(collectReview(null,'owner',first.messages,at,'gmail',first.checkpoint,null,first.discovery));
 const second=await reader({previous:snapshot});assert.deepEqual(second.messages.map(m=>m.id).sort(),['gmail:a','gmail:b']);assert.equal(second.discovery.cursor,null);assert.ok(second.discovery.lastCompletedAt);
 assert.equal(calls.filter(url=>url.includes('pageToken=older')).length,1);assert.equal(calls.filter(url=>url.includes('/messages/a?')).length,1,'latest metadata stays cached');
});
test('handling more than300 messages retains compact suppression without exhausting active capacity',()=>{
 let snapshot=null;
 for(let n=0;n<310;n++){
  const time=new Date(Date.parse(at)+n*11000).toISOString();
  snapshot=save(collectReview(snapshot,'owner',[mail(String(n))],time));
  const key=projectReview(snapshot).items.find(item=>item.id===String(n)).reviewKey;
  snapshot=save(decideReview(snapshot,key,'handled',time));
 }
 assert.equal(projectReview(snapshot).items.length,0);assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<250000);
});
test('one source reaching capacity does not prevent the other account from updating',async()=>{
 let snapshot=null;const accountId='owner:'+require('node:crypto').createHash('sha256').update('owner').digest('hex');
 for(let n=0;n<12;n++)snapshot=save(collectReview(snapshot,accountId,Array.from({length:25},(_,i)=>mail(n+'-'+i)),at));
 let saved;const handler=require('../lib/routes/attention-scan.js').createHandler({authorize:()=>true,identity:()=> 'owner',now:()=>later,store:{load:async()=>snapshot,save:async input=>{saved=save(input);return {snapshot:saved};}},readMail:async()=>({connected:true,messages:[mail('overflow')]}),readGmail:async()=>({connected:true,messages:[mail('gmail:new')]})});
 const res={setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;}};await handler({method:'POST',headers:{'content-type':'application/json'},query:{},body:{}},res);
 assert.equal(res.code,200);assert.equal(res.body.partial,true);assert.equal(res.body.sources.hotmail,'capacity_limited');assert.equal(projectReview(saved).sources.hotmail.capacityLimited,true);assert.ok(projectReview(saved).items.some(item=>item.id==='gmail:new'));
});
