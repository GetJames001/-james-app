'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function handler(){
 const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync('lib/routes/attention-scan.js','utf8'),{module:mod,Buffer,process:{env:{}},console,require(path){
  if(path==='node:crypto')return require(path);
  if(path==='../auth.js')return {privateNoStore(){},requireAuth(){return true;},configuredIdentity(){return 'a';}};
  if(path==='../attention/snapshot-store.cjs')return {createSnapshotStore(){return {};}};
  if(path==='../attention/storage-response.cjs')return {};
  if(path==='../attention/mail-review.cjs')return {collectReview(){return {state:{scans:[]},policy:{},coverage:[],provenance:[]};},collectFailure(){return {};}};
  if(path==='../google/gmail-mail.js')return {createReader(){return ()=>{};}};
  if(path==='../attention/review-alert.cjs')return {};
  if(path==='../travel/qa-replay-job.cjs')return {createReplay(){return null;}};
  throw Error(path);
 }});
 return mod.exports.createHandler;
}
function response(){return {statusCode:200,body:null,setHeader(){},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};}
const request={method:'POST',headers:{'content-type':'application/json'},body:{},query:{}};
function setup(options={}){let saved=false;return {run:handler()({authorize:()=>true,identity:()=> 'a',store:{async load(){return null;},async save(){saved=true;return {snapshot:{revision:1,state:{scans:[]}}};}},readMail:async()=>({connected:true,messages:[]}),...options}),get saved(){return saved;}};}
test('scan does not write Travel by default',async()=>{const s=setup(),res=response();await s.run(request,res);assert.equal(res.body.travel.status,'not_enabled');assert.ok(s.saved);});
test('verified sync hook executes after review commit with owner and snapshot',async()=>{let args;const s=setup({syncTravel:async(...a)=>{assert.ok(s.saved);args=a;return {created:1};}}),res=response();await s.run(request,res);assert.equal(args[0],'a');assert.equal(args[1].revision,1);assert.equal(res.body.travel.created,1);});
test('travel failure is explicit partial status, not false success',async()=>{const s=setup({syncTravel:async()=>{throw Error('x');}}),res=response();await s.run(request,res);assert.equal(res.body.travel.status,'unavailable');assert.equal(res.body.partial,true);});
test('unauthenticated call never invokes sync',async()=>{let called=false;const s=setup({authorize:()=>false,syncTravel:async()=>{called=true;}});await s.run(request,response());assert.equal(called,false);assert.equal(s.saved,false);});
test('queue persistence precedes snapshot, and queue failure cannot advance the cursor',async()=>{
 const first=setup({prepareTravel:async()=>{assert.equal(first.saved,false);}});
 const ok=response();await first.run(request,ok);assert.ok(first.saved);assert.equal(ok.statusCode,200);
 const second=setup({prepareTravel:async()=>{throw Error('queue failed');}}),bad=response();
 await second.run(request,bad);assert.equal(second.saved,false);assert.equal(bad.statusCode,503);assert.equal(bad.body.stage,'prepare_travel');
});
