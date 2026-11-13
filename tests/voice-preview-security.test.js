'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {validate,verify}=require('../tools/voice-review/authorize.cjs');
function fixture(){
 const head='a'.repeat(40),base='4012695b5cdde4b5801f4d451d7ae2aefa3b40cd',repo='GetJames001/-james-app',branch='work/voice-wake-20261113',deploymentId='abcdefghijklmnopqrstuvwx';
 const approval={pr:92,head,deploymentId,immutableUrl:'https://james-fixture1-james-cb7a.vercel.app/'};
 const env={ATTEMPT:'2',GITHUB_REPOSITORY:repo,EVENT_REPO:repo,EVENT_BRANCH:branch,EVENT_BASE:base,EVENT_PR:'92',ACTOR:'GetJames001',TRIGGERING_ACTOR:'GetJames001',EVENT_HEAD:head,REVIEW_APPROVAL:JSON.stringify(approval)};
 const status={id:10,context:'Vercel – james-app',state:'success',target_url:'https://vercel.com/james-cb7a/james-app/'+deploymentId};
 const metadata={pr:{number:92,state:'open',head:{sha:head,ref:branch,repo:{full_name:repo}},base:{sha:base}},combined:{sha:head,statuses:[status]},statuses:[{...status,creator:{login:'vercel[bot]'}}]};
 return {env,approval,metadata};
}
test('voice review cannot authorize ordinary CI, wrong actor, base, branch, fork or missing exact approval',()=>{
 const {env}=fixture();assert.equal(validate({...env,ATTEMPT:'1',REVIEW_APPROVAL:''}),null);
 for(const change of [{ATTEMPT:'0'},{ACTOR:'other'},{TRIGGERING_ACTOR:'other'},{EVENT_PR:'91'},{EVENT_REPO:'fork/repo'},{GITHUB_REPOSITORY:'other/repo'},{EVENT_BRANCH:'main'},{EVENT_BASE:'b'.repeat(40)},{EVENT_HEAD:'b'.repeat(40)},{REVIEW_APPROVAL:''}])assert.throws(()=>validate({...env,...change}),/NOT_AUTHORIZED/);
});
test('voice review rejects stale or unauthored deployment mapping and unsafe approved URLs',()=>{
 const {env,metadata,approval}=fixture();assert.equal(verify(env,metadata).head,env.EVENT_HEAD);
 for(const change of [{immutableUrl:'https://attacker.example/'},{immutableUrl:approval.immutableUrl+'?token=x'},{immutableUrl:approval.immutableUrl+'private'},{immutableUrl:'https://james-fixture1-james-cb7a.vercel.app:444/'},{pr:91},{deploymentId:'invalid'},{head:'b'.repeat(40)}])assert.throws(()=>validate({...env,REVIEW_APPROVAL:JSON.stringify({...approval,...change})}));
 for(const mutate of [m=>m.pr.state='closed',m=>m.pr.head.sha='b'.repeat(40),m=>m.pr.base.sha='b'.repeat(40),m=>m.combined.sha='b'.repeat(40),m=>m.combined.statuses[0].state='pending',m=>m.combined.statuses[0].target_url+='wrong',m=>m.statuses[0].creator.login='other',m=>m.statuses[0].id++,m=>m.statuses.push(m.statuses[0])]){const changed=structuredClone(metadata);mutate(changed);assert.throws(()=>verify(env,changed),/NOT_VERIFIED/);}
});
test('voice probe secret is isolated behind the exact reviewed head and manual authorization',()=>{
 const workflow=fs.readFileSync('.github/workflows/voice-preview-security.yml','utf8');
 assert.doesNotMatch(workflow,/pull_request_target|workflow_dispatch|upload-artifact|--debug/);
 assert.match(workflow,/if: needs.authorize.outputs.authorized == 'true'/);
 assert.match(workflow,/ref: \$\{\{ needs.authorize.outputs.head \}\}/);
 assert.equal((workflow.match(/secrets\.JAMES_VERCEL_AUTOMATION_BYPASS/g)||[]).length,1);
 assert.match(workflow,/vars.JAMES_VOICE_REVIEW/);assert.match(workflow,/persist-credentials: false/);
 assert.match(workflow,/::add-mask::\$VERCEL_AUTOMATION_BYPASS_SECRET/);
 assert.ok(workflow.indexOf('authorize.cjs validate')<workflow.indexOf('gh api'));
});
