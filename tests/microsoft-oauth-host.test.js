const assert = require('node:assert/strict');
const test = require('node:test');
const auth = require('../lib/auth.js');
const gateway = require('../api/gateway.js');
const { microsoftRedirectUri } = require('../lib/microsoft/oauth.js');
process.env.JAMES_AUTH_EMAIL = 'michael@example.com';
process.env.JAMES_SESSION_SECRET = 'synthetic-secret-at-least-thirty-two-bytes';
process.env.MICROSOFT_CLIENT_ID = 'synthetic-client';
process.env.KV_REST_API_URL = 'https://kv.example.test';
function response() {
  return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},
    send(v){this.body=v;return this;},json(v){this.body=v;return this;},end(v){this.body=v;return this;},
    redirect(n,v){this.statusCode=n;this.headers.Location=v;return this;}};
}
function request(host, path, query={}, cookie) {
  return {method:'GET',headers:{host,cookie:cookie ?? `${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`},
    query:{path,account:'personal',...query}};
}
for (const host of ['getjames.ai','www.getjames.ai','james-app-seven.vercel.app']) {
  test(`OAuth round trip stays on ${host} and validates state before token exchange`, async () => {
    const connect=response();
    const req=request(host,'api/microsoft/connect',{redirect_uri:'https://attacker.test/callback'});
    req.headers['x-forwarded-host']='attacker.test';
    await gateway(req,connect);
    assert.equal(connect.statusCode,302);
    const params=new URL(connect.headers.Location).searchParams;
    const expected=`https://${host}/api/microsoft/callback`;
    assert.equal(params.get('redirect_uri'),expected);
    const cookies=connect.headers['Set-Cookie'].map(c=>c.split(';')[0]).join('; ');
    assert.match(cookies,/microsoft_oauth_state=/);
    for(const cookie of connect.headers['Set-Cookie']) {
      assert.match(cookie,/HttpOnly; Secure; SameSite=Lax; Path=\//);
      assert.doesNotMatch(cookie,/Domain=/i);
    }
    const original=global.fetch;const calls=[];
    global.fetch=async(url,options)=>{
      calls.push({url,options});
      return {ok:true,async json(){return calls.length===1?{refresh_token:'synthetic-refresh'}:{result:'OK'};}};
    };
    try {
      const invalid=response();
      await gateway(request(host,'api/microsoft/callback',{state:'wrong',code:'synthetic'},cookies),invalid);
      assert.equal(invalid.statusCode,400);assert.equal(calls.length,0);
      const valid=response();
      await gateway(request(host,'api/microsoft/callback',{state:params.get('state'),code:'synthetic'},cookies),valid);
      assert.equal(valid.statusCode,200);assert.equal(calls.length,2);
      assert.equal(calls[0].options.body.get('redirect_uri'),expected);
      assert.match(valid.headers['Set-Cookie'][0],/Max-Age=0/);
    } finally {global.fetch=original;}
  });
}
test('callback host helper and gateway fail closed for untrusted hosts',async()=>{
  assert.throws(()=>microsoftRedirectUri({headers:{host:'attacker.test'}}),/Untrusted/);
  for(const path of ['api/microsoft/connect','api/microsoft/callback']) {
    const res=response();await gateway(request('attacker.test',path),res);
    assert.equal(res.statusCode,403);assert.equal(res.headers['Set-Cookie'],undefined);
  }
});
