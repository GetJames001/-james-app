'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectReview,projectReview}=require('../lib/attention/mail-review.cjs');
const {createSnapshotStore}=require('../lib/attention/snapshot-store.cjs');
const {createHandler}=require('../lib/routes/attention-scan.js');
const {evaluateAttention}=require('../lib/attention/evaluator.cjs');
const at='2026-11-05T20:00:00.000Z',later='2026-11-05T21:00:00.000Z';
const bill={id:'mail-bill',subject:'Payment due',sender:'Fixture',preview:'Verify this statement.',receivedDateTime:at};
function snapshot(next){return {accountId:'owner',revision:1,...next};}
test('collection persists uncertain evidence without inventing obligations or whole-mailbox coverage',()=>{
 const next=collectReview(null,'owner',[bill,{id:'unknown',subject:'An unrecognized message'}],at),saved=snapshot(next),view=projectReview(saved);
 const evaluated=evaluateAttention({accountId:'owner',previousState:next.state,scans:[],policy:next.policy,evaluatedAt:at});
 assert.equal(evaluated.attentionItems.length,0);assert.equal(evaluated.tasksCreated,0);assert.equal(evaluated.sourceMutations,0);assert.equal(evaluated.sourceHealth[0].canClaimNoActions,false);assert.equal(evaluated.needsReview.length,2);
 assert.equal(view.inventoryCount,2);assert.equal(view.items.length,1);assert.equal(view.mailboxWide,false);assert.equal(view.semanticReviewComplete,false);assert.match(next.coverage[0].label,/Gmail.*not scanned/);
});
test('rechecks compact envelopes but retain earlier unseen candidates and ignore read-state changes',()=>{
 const old=snapshot(collectReview(null,'owner',[bill],at));
 const next=collectReview(old,'owner',[{...bill,isRead:true},{id:'new',subject:'Your flight confirmation'}],later),view=projectReview(snapshot(next));
 assert.equal(next.state.scans.length,1);assert.equal(view.inventoryCount,2);assert.equal(view.items.length,2);
 const empty=collectReview(snapshot(next),'owner',[],later);assert.equal(projectReview(snapshot(empty)).items.length,2,'an empty latest page cannot resolve previously observed items');
});
test('existing other sources and unresolved state are preserved through collector updates',()=>{
 const previous=snapshot(collectReview(null,'owner',[bill],at));
 const other={...previous.state.scans[0],id:'other',source:['fixture','other-account'],pages:[[]]};
 previous.state.scans.push(other);previous.coverage.push({label:'Other saved source',mailboxWide:false});
 const next=collectReview(previous,'owner',[],later);assert.ok(next.state.scans.some(scan=>scan.id==='other'));assert.ok(next.coverage.some(c=>c.label==='Other saved source'));
 assert.equal(projectReview(snapshot(next)).items[0].id,bill.id);
});
function fixture(){
 let raw=null,mailReads=0,writes=0,broken=false;
 const store=createSnapshotStore({maxBytes:1024*1024,command:async parts=>{if(parts[0]==='GET')return raw;assert.equal(parts[0],'EVAL');if(raw!== (parts[4]==='absent'?null:parts[5]))return 0;raw=parts[6];writes++;return 1;}});
 const handler=createHandler({authorize:(req,res)=>{if(req.headers.origin!=='https://james.test'){res.status(403).json({error:'FORBIDDEN'});return false;}return true;},identity:()=> 'owner@example.test',store,now:()=>at,readMail:async()=>{mailReads++;if(broken)throw Error();return {connected:true,messages:[bill]};}});
 async function request({method='POST',origin='https://james.test',query={},body={}}={}){const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.body=data;return this;}};await handler({method,headers:{origin,'content-type':'application/json'},query,body},res);return res;}
 return {request,fail(){broken=true;},counts:()=>({mailReads,writes}),raw:()=>raw,store};
}
test('scan is authorized, account-scoped, bounded and saved with existing optimistic-concurrency store',async()=>{
 const f=fixture();assert.equal((await f.request({origin:'https://foreign.test'})).code,403);assert.equal((await f.request({query:{accountId:'other'}})).code,400);assert.equal((await f.request({body:{messages:[bill]}})).code,400);assert.equal((await f.request({method:'GET'})).code,405);assert.deepEqual(f.counts(),{mailReads:0,writes:0});
 assert.equal((await f.request()).code,200);assert.deepEqual(f.counts(),{mailReads:1,writes:1});const raw=f.raw();assert.doesNotMatch(raw,/owner@example.test/);f.fail();assert.equal((await f.request()).code,503);const view=projectReview(JSON.parse(f.raw()));assert.equal(view.items[0].id,bill.id,'provider failures do not erase the saved review');assert.equal(view.stale,true);
});
test('capacity refuses growth without deleting earlier inventory',()=>{
 const many=Array.from({length:25},(_,i)=>({...bill,id:'m'+i}));let saved=null;
 for(let batch=0;batch<12;batch++)saved=snapshot(collectReview(saved,'owner',many.map(m=>({...m,id:m.id+'-'+batch})),at));
 const before=JSON.stringify(saved);assert.throws(()=>collectReview(saved,'owner',[{...bill,id:'overflow'}],later),/CAPACITY/);assert.equal(JSON.stringify(saved),before);
});
test('live gateway rejects unsigned and foreign-origin scan requests before mailbox or storage access',async()=>{
 const gateway=require('../api/gateway.js');let calls=0;const original=global.fetch;
 global.fetch=async()=>{calls++;throw Error('Unexpected provider access');};
 try{
  for(const headers of [{host:'www.getjames.ai',origin:'https://www.getjames.ai'},{host:'www.getjames.ai',origin:'https://foreign.test',cookie:'james_session=invalid'}]){
   const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.body=data;return this;}};
   await gateway({method:'POST',headers:{...headers,'content-type':'application/json'},query:{path:'api/attention/scan'},body:{}},res);assert.ok([401,403].includes(res.code));
  }assert.equal(calls,0);
 }finally{global.fetch=original;}
});
