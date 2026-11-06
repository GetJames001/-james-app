'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectReview,projectReview,decideReview}=require('../lib/attention/mail-review.cjs');
const {createSnapshotStore}=require('../lib/attention/snapshot-store.cjs');
const {createHandler}=require('../lib/routes/attention-decision.js');
const at='2026-11-06T18:00:00.000Z',later='2026-11-06T19:00:00.000Z',bill={id:'mail',subject:'Payment due',sender:'Fixture',preview:'Please verify'};
const snapshot=(next,revision=1)=>({accountId:'owner',revision,...next});
test('handled is reversible, survives repeated scans and applies only to the reviewed message version',()=>{
 let saved=snapshot(collectReview(null,'owner',[bill],at));const key=projectReview(saved).items[0].reviewKey;
 const before=JSON.stringify(saved.state);saved=snapshot(decideReview(saved,key,'handled',at),2);
 assert.equal(JSON.stringify(saved.state),before,'mail evidence and evaluator state are untouched');assert.equal(projectReview(saved).items.length,0);assert.equal(projectReview(saved,{includeHandled:true}).handledItems.length,1);assert.equal(projectReview(saved).handledItems.length,0,'public projection does not load handled cards');
 saved=snapshot(collectReview(saved,'owner',[bill],'2026-11-06T18:00:05.000Z'),3);assert.equal(projectReview(saved).items.length,0,'refresh cannot resurrect an unchanged handled message');
 const undone=snapshot(decideReview(saved,key,'undo','2026-11-06T18:00:05.000Z'),4);assert.equal(projectReview(undone).items.length,1);assert.equal(projectReview(undone).handledItems.length,0);
 const changed=snapshot(collectReview(saved,'owner',[{...bill,preview:'New deadline, action required'}],later),4);assert.equal(projectReview(changed).items.length,1);assert.notEqual(projectReview(changed).items[0].reviewKey,key);assert.throws(()=>decideReview(changed,key,'handled',later),/REVIEW_CHANGED_RETRY/);
});
test('different providers keep separate handled decisions; unknown records are refused',()=>{
 let saved=snapshot(collectReview(null,'owner',[bill],at));saved=snapshot(collectReview(saved,'owner',[{...bill,id:'gmail:mail'}],at,'gmail'));
 const items=projectReview(saved).items;saved=snapshot(decideReview(saved,items[0].reviewKey,'handled',at));assert.deepEqual(projectReview(saved).items.map(i=>i.id),['gmail:mail']);assert.throws(()=>decideReview(saved,'a'.repeat(64),'handled',at),/REVIEW_CHANGED_RETRY/);
});
test('decision route is owner-scoped, strict POST/same-origin and only writes the existing Attention snapshot',async()=>{
 let raw=null,writes=0;const commands=[];
 const store=createSnapshotStore({maxBytes:1024*1024,command:async parts=>{commands.push(parts);if(parts[0]==='GET')return raw;if(parts[0]!=='EVAL')throw Error();if((parts[4]==='absent'?null:parts[5])!==raw)return 0;raw=parts[6];writes++;return 1;}});
 const owner='owner@example.test',accountId='owner:'+require('node:crypto').createHash('sha256').update(owner).digest('hex');
 const initial=collectReview(null,accountId,[bill],at);await store.save({accountId,expectedRevision:0,...initial});const key=projectReview(await store.load(accountId)).items[0].reviewKey;
 const handler=createHandler({authorize:(req,res,options)=>{assert.equal(options.csrf,req.method==='POST');if(req.headers.origin==='https://james.test')return true;res.status(403).json({});return false;},identity:()=>owner,store,now:()=>later});
 async function request({method='POST',origin='https://james.test',body={reviewKey:key,action:'handled'},query={}}={}){const res={setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};await handler({method,headers:{origin,'content-type':'application/json'},body,query},res);return res;}
 for(const input of [{origin:'https://foreign.test'},{method:'GET'},{body:{reviewKey:key,action:'delete'}},{body:{reviewKey:key,action:'handled',accountId:'other'}},{query:{account:'other'}},{body:'x'.repeat(513)}])assert.ok([400,403,405].includes((await request(input)).code));
 assert.equal(writes,1);assert.equal((await request()).code,200);assert.equal(writes,2);assert.equal(projectReview(await store.load(accountId)).items.length,0);assert.equal((await request({body:{reviewKey:key,action:'undo'}})).code,200);assert.equal(projectReview(await store.load(accountId)).items.length,1);assert.ok(commands.every(parts=>parts[1].startsWith('james:attention:v1:')||parts[0]==='EVAL'));
 assert.equal((await request({body:{reviewKey:'a'.repeat(64),action:'handled'}})).code,409);
});
test('a concurrent scan conflict never silently overwrites new evidence',async()=>{
 const previous=snapshot(collectReview(null,'owner',[bill],at));let writes=0;
 const handler=createHandler({authorize:()=>true,identity:()=> 'owner',store:{load:async()=>previous,save:async()=>{writes++;throw Object.assign(Error(),{code:'REVISION_CONFLICT'});}},now:()=>later});
 const res={setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;}};
 await handler({method:'POST',headers:{'content-type':'application/json'},query:{},body:{reviewKey:projectReview(previous).items[0].reviewKey,action:'handled'}},res);assert.equal(res.code,409);assert.equal(writes,1);assert.equal(projectReview(previous).items.length,1);
});
