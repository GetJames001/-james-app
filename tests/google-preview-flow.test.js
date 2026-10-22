const test=require('node:test');
const assert=require('node:assert/strict');
const auth=require('../lib/auth.js');
const connect=require('../api/google/connect.js');
const callback=require('../api/google/callback.js');
const host='james-app-git-review-customer-activity-save-20261021-james-cb7a.vercel.app';
process.env.VERCEL_ENV='preview';
process.env.VERCEL_BRANCH_URL=host;
process.env.JAMES_GOOGLE_PREVIEW_CALLBACK_URL=`https://${host}/api/google/callback`;
process.env.JAMES_AUTH_EMAIL='synthetic@example.test';
process.env.JAMES_SESSION_SECRET='synthetic-preview-secret-at-least-thirty-two-bytes';
process.env.GOOGLE_CLIENT_ID='synthetic-client';
process.env.GOOGLE_CLIENT_SECRET='synthetic-secret';
process.env.KV_REST_API_URL='https://preview-store.example.test';
process.env.KV_REST_API_TOKEN='synthetic-store-token';
function res(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},send(v){this.body=v;return this},json(v){this.body=v;return this},redirect(n,v){this.statusCode=n;this.location=v;return this}}}
function request(cookie=''){return {method:'GET',headers:{host,cookie},query:{}}}
test('preview initiation and exchange use the same registered callback and isolated store',async()=>{
 const start=res();await connect(request(`${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`),start);
 assert.equal(start.statusCode,302);
 const target=new URL(start.location);
 assert.equal(target.origin,'https://accounts.google.com');
 assert.equal(target.searchParams.get('redirect_uri'),process.env.JAMES_GOOGLE_PREVIEW_CALLBACK_URL);
 assert.equal(target.searchParams.get('scope'),'https://www.googleapis.com/auth/calendar.readonly');
 const state=target.searchParams.get('state');assert.ok(state);
 assert.match(start.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
 const previous=global.fetch;const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>calls.length===1?{refresh_token:'synthetic-refresh'}:{result:'OK'}}};
 try{
  const req=request(`google_oauth_state=${state}`);req.query={state,code:'synthetic-code'};
  const out=res();await callback(req,out);assert.equal(out.statusCode,200);
  assert.equal(calls.length,2);assert.equal(calls[0].options.body.get('redirect_uri'),target.searchParams.get('redirect_uri'));
  assert.equal(calls[1].url,'https://preview-store.example.test');
  assert.deepEqual(JSON.parse(calls[1].options.body),['SET','google:refresh_token','synthetic-refresh']);
  assert.match(out.body,/Google Calendar connected/);
 }finally{global.fetch=previous}
});
test('wrong OAuth state and wrong preview host cause no exchange or store write',async()=>{
 const previous=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('unexpected network')};
 try{
  const bad=request('google_oauth_state=expected');bad.query={state:'different',code:'synthetic'};
  const out=res();await callback(bad,out);assert.equal(out.statusCode,400);
  const other=request('google_oauth_state=expected');other.headers.host='www.getjames.ai';other.query={state:'expected',code:'synthetic'};
  const blocked=res();await callback(other,blocked);assert.equal(blocked.statusCode,503);
  assert.equal(calls,0);
 }finally{global.fetch=previous}
});
