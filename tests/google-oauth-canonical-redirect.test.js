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
  assert.ok(source.includes(canonical));
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
