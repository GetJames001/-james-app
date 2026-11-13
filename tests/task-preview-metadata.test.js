'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifyPreviewMetadata}=require('../tools/task-execution-proof/verify-preview-metadata.cjs');
const fixture=()=>{const status={id:123,context:'Vercel – james-app',state:'success',target_url:'https://vercel.com/james-cb7a/james-app/A12345678901234567890'};return{head:'a'.repeat(40),deploymentId:'A12345678901234567890',immutableUrl:'https://james-example123-james-cb7a.vercel.app/',branchUrl:'https://james-app-git-work-hosted-preparation-proof-20261113-james-cb7a.vercel.app/',combined:{sha:'a'.repeat(40),statuses:[{...status}]},statuses:[{...status,creator:{login:'vercel[bot]'}}]};};
test('verified exact-head Vercel status binds the reviewed deployment mapping',()=>{const r=verifyPreviewMetadata(fixture());assert.equal(r.head,'a'.repeat(40));assert.equal(r.urls.split(',').length,2);});
test('stale commit, wrong project, wrong deployment and non-Vercel authors cannot authorize',()=>{
 for(const mutate of [f=>f.combined.sha='b'.repeat(40),f=>f.statuses[0].creator.login='GetJames001',f=>f.combined.statuses[0].context='Vercel – james-isolated-qa-1bd8f93',f=>f.combined.statuses[0].target_url+='other',f=>f.combined.statuses[0].state='pending',f=>f.combined.statuses.push({...f.combined.statuses[0]}),f=>f.statuses[0].id=124,f=>f.statuses[0].target_url+='other']){const f=fixture();mutate(f);assert.throws(()=>verifyPreviewMetadata(f),/PREVIEW_MAPPING_NOT_VERIFIED/);}
});
test('unreviewed hosts and credential-bearing or malformed URLs fail closed',()=>{
 for(const key of ['immutableUrl','branchUrl'])for(const value of ['http://james-example123-james-cb7a.vercel.app/','https://evil.example/','https://secret@james-example123-james-cb7a.vercel.app/','https://james-example123-james-cb7a.vercel.app/?token=x','https://james-example123-james-cb7a.vercel.app/#fragment','https://james-example123-james-cb7a.vercel.app/path']){const f=fixture();f[key]=value;assert.throws(()=>verifyPreviewMetadata(f));}
 const f=fixture();f.immutableUrl=f.branchUrl;assert.throws(()=>verifyPreviewMetadata(f));
});
