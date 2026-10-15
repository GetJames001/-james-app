'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const crypto=require('node:crypto');
const exec=promisify(execFile);
const {createSnapshotStore,evaluateAndSaveSnapshot}=require('../lib/attention/snapshot-store.cjs');
const container=process.env.ATTENTION_TEST_REDIS_CONTAINER;
if(!/^[a-f0-9]{12,64}$/.test(container||''))throw Error('Explicit disposable CI Redis container required');
const at='2026-10-14T12:00:00Z';
const policy={freshnessMs:3600000,unansweredAfterMs:0,dueSoonWithinMs:86400000,cooldownMs:0,quietHours:{enabled:false,timeZone:'UTC',startHour:22,endHour:8}};
async function command(args){
 const {stdout}=await exec('docker',['exec',container,'redis-cli','--json',...args],{timeout:10000,maxBuffer:2000000});
 return JSON.parse(stdout);
}
function input(store,accountId){return {store,accountId,expectedRevision:0,scans:[{id:'s1',source:['microsoft','synthetic'],at,sequence:1,complete:true,extractionComplete:true,checkpoint:'good',pages:[[{id:'request',source:['microsoft','synthetic'],thread:'thread',action:'Review synthetic estimate',at,kind:'request',owner:'user',ownershipEvidence:{reference:'synthetic://owner'},evidence:{reference:'https://example.test/mail',quote:'Review synthetic estimate'},extraction:{complete:true,confident:true},automated:false,deadline:{precision:'none'}}]]}],policy,evaluatedAt:at,coverage:[{label:'Synthetic window only',mailboxWide:false}],provenance:[{synthetic:true,scanId:'s1'}]};}
function setup(wrap=x=>x,maxBytes=1000000){const accountId='synthetic-'+crypto.randomUUID();return {accountId,store:createSnapshotStore({command:wrap(command),maxBytes})};}
test('real Redis persists the complete snapshot with no expiry',async()=>{const {store,accountId}=setup();await evaluateAndSaveSnapshot(input(store,accountId));const s=await store.load(accountId);assert.equal(s.revision,1);assert.equal(s.state.accountId,accountId);const key='james:attention:v1:'+crypto.createHash('sha256').update(accountId).digest('hex');assert.equal(await command(['TTL',key]),-1);assert.equal(await store.load('synthetic-other'),null);});
test('real Lua atomically rejects competing revisions',async()=>{const {store,accountId}=setup();const first=input(store,accountId);const results=await Promise.allSettled([evaluateAndSaveSnapshot(first),evaluateAndSaveSnapshot({...first,coverage:[{label:'Competing synthetic window',mailboxWide:false}]})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'REVISION_CONFLICT');assert.equal((await store.load(accountId)).revision,1);});
test('lost acknowledgement recovers actual committed bytes without another write',async()=>{let writes=0;const {store,accountId}=setup(real=>async args=>{const result=await real(args);if(args[0]==='EVAL'){writes++;throw Error('Synthetic lost acknowledgement');}return result;});const result=await evaluateAndSaveSnapshot(input(store,accountId));assert.equal(result.acknowledgement,'recovered_by_read');assert.equal(writes,1);assert.equal((await store.load(accountId)).revision,1);});
test('precommit connection failure never creates an empty fallback',async()=>{let writes=0;const {store,accountId}=setup(real=>async args=>{if(args[0]==='EVAL'){writes++;throw Error('Synthetic dropped write');}return real(args);});await assert.rejects(evaluateAndSaveSnapshot(input(store,accountId)),{code:'COMMIT_OUTCOME_UNKNOWN'});assert.equal(writes,1);assert.equal(await store.load(accountId),null);});
test('partial scan retains known obligation in actual persisted snapshot',async()=>{const {store,accountId}=setup();await evaluateAndSaveSnapshot(input(store,accountId));const x=input(store,accountId);x.expectedRevision=1;x.scans=[{id:'s2',source:['microsoft','synthetic'],at,sequence:2,pages:[],complete:false,extractionComplete:false,error:'HTTP_503'}];const result=await evaluateAndSaveSnapshot(x);assert.equal(result.result.attentionItems.length,1);assert.equal(result.result.sourceHealth[0].checkpoint,'good');assert.equal((await store.load(accountId)).revision,2);});
test('oversized snapshot leaves real stored bytes unchanged',async()=>{const {store,accountId}=setup();await evaluateAndSaveSnapshot(input(store,accountId));const before=await store.load(accountId);const smaller=createSnapshotStore({command,maxBytes:Buffer.byteLength(JSON.stringify(before))+100});const x=input(smaller,accountId);x.expectedRevision=1;x.provenance=[{synthetic:true,body:'x'.repeat(2000)}];await assert.rejects(evaluateAndSaveSnapshot(x),{code:'INVALID_STORED_BYTES'});assert.deepEqual(await store.load(accountId),before);});
