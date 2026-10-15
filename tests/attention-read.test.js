'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const candidate=path.resolve(__dirname,'..');
function make({authorized=true,status=200,payload={result:null},raw,headers={}}={}){
 const calls=[],file=path.join(candidate,'lib/routes/attention.js');
 const context={module:{exports:{}},process:{env:{KV_REST_API_URL:'https://storage.example.test',KV_REST_API_TOKEN:'synthetic-token'}},AbortSignal,Date,TextDecoder,fetch:async(url,options)=>{calls.push({url,options});return new Response(raw===undefined?JSON.stringify(payload):raw,{status,headers});},require:p=>p==='node:crypto'?require(p):p==='../auth.js'?{configuredIdentity:()=> 'owner@example.test',requireAuth:(req,res)=>{if(!authorized){res.status(401).json({error:'UNAUTHORIZED'});return null;}return {sub:'owner'};}}:require(path.resolve(path.dirname(file),p))};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
 return {handler:context.module.exports,calls};
}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(x){this.body=x;return this;},end(){this.ended=true;return this;}};}
test('candidate route reuses existing storage configuration with GET-only namespace',async()=>{const x=make(),r=response();await x.handler({method:'GET',query:{path:'api/attention'}},r);assert.equal(r.code,200);assert.equal(r.body.status,'not_checked');assert.equal(x.calls.length,1);const command=JSON.parse(x.calls[0].options.body);assert.equal(command[0],'GET');assert.match(command[1],/^james:attention:v1:[a-f0-9]{64}$/);});
test('candidate unauthorized route performs no storage or mailbox access',async()=>{const x=make({authorized:false}),r=response();await x.handler({method:'GET'},r);assert.equal(r.code,401);assert.equal(x.calls.length,0);});
test('candidate POST does not scan, write or invoke model',async()=>{const x=make(),r=response();await x.handler({method:'POST'},r);assert.equal(r.code,405);assert.equal(x.calls.length,0);});
test('candidate account controls rejected before storage read',async()=>{const x=make(),r=response();await x.handler({method:'GET',query:{path:'api/attention',account:'work'}},r);assert.equal(r.code,400);assert.equal(x.calls.length,0);});
test('candidate storage errors never return successful empty state',async()=>{for(const config of [{status:503},{payload:{error:'offline'}},{payload:{result:'broken'}}]){const x=make(config),r=response();await x.handler({method:'GET'},r);assert.equal(r.code,503);assert.equal(r.body.error,'ATTENTION_UNAVAILABLE');}});
test('candidate HEAD respects no-body behavior',async()=>{const x=make(),r=response();await x.handler({method:'HEAD'},r);assert.equal(r.code,200);assert.equal(r.body,undefined);assert.equal(r.ended,true);});
test('candidate HEAD storage failures have no response body',async()=>{
 const x=make({status:503}),r=response();await x.handler({method:'HEAD'},r);assert.equal(r.code,503);assert.equal(r.body,undefined);assert.equal(r.ended,true);
});

test('oversized declared storage response fails closed',async()=>{
 const x=make({headers:{'content-length':String(8*1024*1024+1)}}),r=response();await x.handler({method:'GET'},r);assert.equal(r.code,503);
});
test('chunked oversized storage response fails closed without content length',async()=>{
 const x=make({raw:' '.repeat(8*1024*1024+1)}),r=response();await x.handler({method:'GET'},r);assert.equal(r.code,503);
});
test('malformed JSON and invalid UTF8 storage responses fail closed',async()=>{
 for(const raw of ['not JSON',new Uint8Array([255])]){const x=make({raw}),r=response();await x.handler({method:'GET'},r);assert.equal(r.code,503);}
});
test('storage credentials cannot follow a redirect',async()=>{
 const x=make(),r=response();await x.handler({method:'GET'},r);assert.equal(x.calls[0].options.redirect,'error');
});
function savedSnapshot(){
 const accountId='owner:'+require('node:crypto').createHash('sha256').update('owner@example.test').digest('hex');
 const policy={freshnessMs:3600000,unansweredAfterMs:0,dueSoonWithinMs:86400000,cooldownMs:0,quietHours:{enabled:false,timeZone:'UTC',startHour:22,endHour:8}};
 const at='2026-10-15T18:00:00Z';
 const result=require('../lib/attention/evaluator.cjs').evaluateAttention({accountId,scans:[],policy,evaluatedAt:at});
 return {schemaVersion:1,accountId,revision:1,state:result.nextState,policy,coverage:[],provenance:[{internal:'synthetic-only-evidence'}]};
}
test('valid account-scoped snapshot projects only display fields',async()=>{
 const snapshot=savedSnapshot(),x=make({payload:{result:JSON.stringify(snapshot)}}),r=response();
 await x.handler({method:'GET'},r);assert.equal(r.code,200);assert.equal(r.body.status,'available');assert.equal(r.body.revision,1);
 for(const field of ['state','policy','provenance','accountId','reminderCandidates'])assert.equal(field in r.body,false);
 assert.equal(JSON.stringify(r.body).includes('synthetic-only-evidence'),false);
});
test('foreign owner snapshot fails closed rather than returning another account data',async()=>{
 const snapshot=savedSnapshot();snapshot.accountId='other-owner';const x=make({payload:{result:JSON.stringify(snapshot)}}),r=response();
 await x.handler({method:'GET'},r);assert.equal(r.code,503);assert.equal(r.body.error,'ATTENTION_UNAVAILABLE');
});
test('valid JSON with oversized stored snapshot is rejected by the separate value limit',async()=>{
 const snapshot=savedSnapshot();snapshot.provenance=[{text:'x'.repeat(1024*1024)}];
 const x=make({payload:{result:JSON.stringify(snapshot)}}),r=response();await x.handler({method:'GET'},r);assert.equal(r.code,503);
});
test('untrusted client policy and scan controls never reach storage',async()=>{
 for(const query of [{policy:'all'},{scan:true},{accountId:'other'},{model:'paid'}]){
  const x=make(),r=response();await x.handler({method:'GET',query},r);assert.equal(r.code,400);assert.equal(x.calls.length,0);
 }
});
