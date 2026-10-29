const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const connect=fs.readFileSync(path.join(root,'api/google/connect.js'),'utf8');
const callback=fs.readFileSync(path.join(root,'api/google/callback.js'),'utf8');
const canonical='https://www.getjames.ai/api/google/callback';
test('OAuth initiation and token exchange share canonical callback',()=>{
 for(const source of [connect,callback]){
  assert.ok(source.includes('googleRedirectUri(req)'));
  assert.ok(source.includes('redirect_uri: redirectUri'));
  assert.ok(!source.includes('james-app-seven.vercel.app/api/google/callback'));
 }
});
test('OAuth state cookie and verification remain intact',()=>{
 assert.match(connect,/crypto\.randomBytes\(24\)/);
 assert.match(connect,/google_oauth_state=/);
 assert.match(connect,/HttpOnly; Secure; SameSite=Lax/);
 assert.match(callback,/expectedState/);
 assert.match(callback,/state !== expectedState/);
 assert.match(callback,/Invalid Google authorization state/);
});

const {googleRedirectUri,PRODUCTION_CALLBACK}=require('../lib/google/oauth-redirect.js');
const branch='james-app-git-review-customer-activity-save-20261021-james-cb7a.vercel.app';
const callbackUrl=`https://${branch}/api/google/callback`;
const req={headers:{host:branch}};
const env={VERCEL_ENV:'preview',VERCEL_BRANCH_URL:branch,JAMES_GOOGLE_PREVIEW_CALLBACK_URL:callbackUrl};
test('production callback remains canonical even with preview configuration',()=>{
 assert.equal(PRODUCTION_CALLBACK,canonical);
 assert.equal(googleRedirectUri(req,{...env,VERCEL_ENV:'production'}),canonical);
 assert.equal(googleRedirectUri(req,{}),canonical);
});
test('explicit registered branch callback is shared by preview initiation and exchange',()=>{
 assert.equal(googleRedirectUri(req,env),callbackUrl);
});
test('preview without explicit configuration fails closed rather than using production',()=>{
 for(const missing of ['JAMES_GOOGLE_PREVIEW_CALLBACK_URL','VERCEL_BRANCH_URL']){
  const config={...env};delete config[missing];assert.throws(()=>googleRedirectUri(req,config));
 }
});
test('preview rejects foreign, malformed, production and decorated callback URLs',()=>{
 for(const value of [canonical,'https://attacker.example/api/google/callback',callbackUrl+'?x=1',callbackUrl+'#x',callbackUrl+'/',callbackUrl.replace('https:','http:'),callbackUrl.replace('https://','https://user@')]){
  assert.throws(()=>googleRedirectUri(req,{...env,JAMES_GOOGLE_PREVIEW_CALLBACK_URL:value}));
 }
});
test('request host cannot redirect authorization to a different deployment',()=>{
 for(const host of ['www.getjames.ai','attacker.example','other.vercel.app',undefined]){
  assert.throws(()=>googleRedirectUri({headers:{host,'x-forwarded-host':branch}},env));
 }
});
