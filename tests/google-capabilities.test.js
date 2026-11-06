'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../lib/google/capabilities.js');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'fix/calendar-refresh-diagnosis-20261031',GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',KV_REST_API_URL:'https://kv.invalid',KV_REST_API_TOKEN:'synthetic-kv'};
async function run(scope,{authorized=true,method='GET',query={}}={}){
 const calls=[],handler=createHandler({env,authorize:(req,res)=>{if(authorized)return true;res.status(401).json({error:'UNAUTHORIZED'});return false;},fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(calls.length===1?{result:'synthetic-refresh'}:{access_token:'synthetic-access',...(scope===undefined?{}:{scope})});}});
 const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.body=data;return this;}};
 await handler({method,headers:{},query},res);return {res,calls};
}
test('access audit refuses auth/method/query controls before provider or storage access',async()=>{
 for(const options of [{authorized:false},{method:'POST'},{query:{account:'other'}}]){const {res,calls}=await run('',options);assert.ok([401,405,400].includes(res.code));assert.equal(calls.length,0);}
});
test('existing Calendar-only grant is distinguished from direct Gmail permission without exposing tokens',async()=>{
 const {res,calls}=await run('https://www.googleapis.com/auth/calendar.readonly');assert.equal(res.code,200);assert.equal(res.body.calendarRead,'granted');assert.equal(res.body.gmailRead,'not_granted');assert.equal(res.body.gmailSend,'not_checked');assert.doesNotMatch(JSON.stringify(res),/synthetic/);assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[0].options.body),['GET','google:diagnostic:calendar-refresh-20261031:refresh_token']);assert.equal(calls[1].options.body.has('scope'),false,'audit never requests broader permissions');
});
test('already granted Gmail reading can be detected and missing scope metadata remains unknown',async()=>{
 assert.equal((await run('https://www.googleapis.com/auth/gmail.readonly')).res.body.gmailRead,'granted');assert.equal((await run()).res.body.gmailRead,'unknown');
});
