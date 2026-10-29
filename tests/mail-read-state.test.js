const assert = require('node:assert/strict');
const test = require('node:test');
const auth = require('../lib/auth.js');
const gateway = require('../api/gateway.js');
process.env.JAMES_AUTH_EMAIL = 'michael@example.com';
process.env.JAMES_SESSION_SECRET = 'test-session-secret-that-is-at-least-thirty-two-bytes';
process.env.KV_REST_API_URL = 'https://kv.example.test';
process.env.KV_REST_API_TOKEN = 'synthetic-kv-token';
process.env.MICROSOFT_CLIENT_ID = 'synthetic-client';

function request(method = 'PATCH', body = { messageId: 'synthetic/id+=', isRead: true }, extra = {}) {
  return { method, query: { path: 'api/microsoft/mail', account: 'personal', ...extra.query }, body,
    headers: { host: 'www.getjames.ai', origin: 'https://www.getjames.ai',
      cookie: `${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`, ...extra.headers } };
}
function response() {
  return { statusCode: 200, headers: {}, body: null,
    setHeader(k,v) { this.headers[k] = v; }, status(v) { this.statusCode = v; return this; },
    json(v) { this.body = v; return this; }, send(v) { this.body = v; return this; },
    end(v) { this.body = v; return this; }, redirect(s,l) { this.statusCode=s; this.headers.Location=l; return this; } };
}
function reply(data, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return data; } }; }
async function run(req, replies = []) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    assert.ok(replies.length, 'no unexpected provider call');
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  try { const res = response(); await gateway(req, res); return { res, calls }; }
  finally { global.fetch = original; }
}
const stored = () => reply({ result: 'synthetic-refresh' });
const token = () => reply({ access_token: 'synthetic-access', scope: 'Mail.ReadWrite Mail.Send' });

test('real gateway requires authentication, trusted host and same-origin PATCH before provider access', async () => {
  for (const [headers, status] of [
    [{ cookie: '' }, 401], [{ origin: 'https://attacker.example' }, 403],
    [{ origin: undefined }, 403], [{ host: 'attacker.example' }, 403]
  ]) {
    const { res, calls } = await run(request('PATCH', undefined, { headers }));
    assert.equal(res.statusCode, status); assert.equal(calls.length, 0);
    assert.equal(res.headers['X-Application-Gateway'], 'enforced');
    assert.match(res.headers['Cache-Control'], /no-store/);
  }
});

test('unsupported methods fail closed through gateway', async () => {
  for (const method of ['PUT','DELETE','HEAD','OPTIONS']) {
    const { res, calls } = await run(request(method));
    assert.equal(res.statusCode, 405); assert.equal(res.headers.Allow, 'GET, POST, PATCH');
    assert.equal(calls.length, 0);
  }
});

test('PATCH rejects Work, invalid account, invalid shapes and extra mutation fields before provider access', async () => {
  for (const query of [{ account: 'work' }, { account: 'other' }]) {
    const { res, calls } = await run(request('PATCH', undefined, { query }));
    assert.equal(res.statusCode,400); assert.equal(calls.length,0);
  }
  for (const body of [null, [], 'string', {}, { messageId:'a' }, {messageId:'a',isRead:'true'},
    {messageId:1,isRead:true}, {messageId:'',isRead:true}, {messageId:'.',isRead:true}, {messageId:'..',isRead:true}, {messageId:'a\n',isRead:true},
    {messageId:'a'.repeat(2049),isRead:true}, {messageId:'a',isRead:true,subject:'unsafe'},
    {messageId:'a',isRead:true,replyText:'unsafe'}]) {
    const { res, calls } = await run(request('PATCH',body));
    assert.equal(res.statusCode,400); assert.equal(calls.length,0);
  }
});

for (const isRead of [true, false]) test(`PATCH confirms isRead=${isRead} and fresh inbox count; only isRead reaches Graph`, async () => {
  const { res, calls } = await run(request('PATCH',{ messageId:'synthetic/id+=',isRead }),
    [stored(),token(),reply({id:'synthetic/id+=',isRead}),reply({unreadItemCount:32})]);
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.body,{ok:true,account:'personal',messageId:'synthetic/id+=',isRead,unreadCount:32,unreadCountVerified:true});
  assert.equal(calls[2].url,'https://graph.microsoft.com/v1.0/me/messages/synthetic%2Fid%2B%3D');
  assert.equal(calls[2].options.method,'PATCH'); assert.deepEqual(JSON.parse(calls[2].options.body),{isRead});
  assert.match(calls[1].options.body.get('scope'), /Mail.ReadWrite/);
  assert.match(calls[3].url,/mailFolders\/inbox\?\$select=unreadItemCount$/);
});

test('missing consent and Graph permission failures explicitly request reconnection without leaking provider details', async () => {
  for (const replies of [
    [reply({result:null})], [stored(),reply({error:'invalid_grant',error_description:'private-provider-detail'},400)],
    [stored(),reply({access_token:'synthetic',scope:'Mail.Read'})],
    [stored(),token(),reply({error:{message:'private-provider-detail'}},403)],
    [stored(),token(),reply({error:{message:'private-provider-detail'}},401)],
    [stored(),token(),{ok:false,status:403,async json(){throw new Error('invalid JSON');}}]
  ]) {
    const {res} = await run(request(),replies);
    assert.equal(res.statusCode,403); assert.equal(res.body.error,'MAIL_PERMISSION_REQUIRED');
    assert.doesNotMatch(JSON.stringify(res.body),/private-provider-detail|synthetic-refresh/);
  }
});

test('mutation fails closed unless Graph confirms requested read state', async () => {
  for (const result of [reply({error:'provider'},500),reply({isRead:false}),reply({}),new Error('private-provider-detail')]) {
    const {res,calls} = await run(request(),[stored(),token(),result]);
    assert.equal(res.statusCode,502); assert.equal(res.body.ok,false); assert.equal(calls.length,3);
    assert.doesNotMatch(JSON.stringify(res.body),/private-provider-detail/);
  }
});

test('confirmed mutation survives count failure without inventing unread count', async () => {
  for (const count of [reply({error:'provider'},503),reply({}),reply({unreadItemCount:-1}),
    reply({unreadItemCount:'32'}),new Error('private-provider-detail')]) {
    const {res} = await run(request(),[stored(),token(),reply({isRead:true}),count]);
    assert.equal(res.statusCode,200); assert.equal(res.body.isRead,true);
    assert.equal(res.body.unreadCount,null); assert.equal(res.body.unreadCountVerified,false);
  }
});

test('rotated refresh token is safely persisted before mutation; failed save prevents Graph PATCH', async () => {
  for (const saveOk of [true,false]) {
    const replies=[stored(),reply({access_token:'synthetic',refresh_token:'synthetic-rotated',scope:'Mail.ReadWrite'}),
      reply({result:saveOk?'OK':null},saveOk?200:500)];
    if(saveOk) replies.push(reply({isRead:true}),reply({unreadItemCount:0}));
    const {res,calls} = await run(request(),replies);
    assert.deepEqual(JSON.parse(calls[2].options.body),['SET','microsoft:personal:refresh_token','synthetic-rotated']);
    assert.equal(res.statusCode,saveOk?200:502); assert.equal(calls.length,saveOk?5:3);
  }
});

test('PATCH deadline terminates even an uncooperative provider and aborts request', async () => {
  const originalFetch=global.fetch; const originalTimer=global.setTimeout;
  let signal;
  global.fetch=async (_,options) => { signal=options.signal; return new Promise(()=>{}); };
  global.setTimeout=(callback) => originalTimer(callback,0);
  try {
    const res=response(); await gateway(request(),res);
    assert.equal(res.statusCode,504); assert.equal(res.body.error,'MAIL_REQUEST_TIMEOUT'); assert.equal(signal.aborted,true);
  } finally { global.fetch=originalFetch; global.setTimeout=originalTimer; }
});

test('GET stays read-only and existing GET/POST refresh scopes remain unchanged', async () => {
  const get=await run(request('GET'),[stored(),token(),reply({unreadItemCount:4,totalItemCount:8}),reply({value:[]})]);
  assert.equal(get.res.statusCode,200);
  assert.equal(get.calls[1].options.body.get('scope'),'openid profile offline_access User.Read Mail.Read Mail.Send');
  assert.ok(get.calls.slice(2).every(call=>!call.options.method || call.options.method==='GET'));
  const post=await run(request('POST',{messageId:'synthetic',replyText:'synthetic reply'}),[stored(),token(),reply({})]);
  assert.equal(post.res.statusCode,200); assert.equal(post.res.body.sent,true);
  assert.equal(post.calls[1].options.body.get('scope'),'openid profile offline_access User.Read Mail.Read Mail.Send');
  assert.deepEqual(JSON.parse(post.calls[2].options.body),{comment:'synthetic reply'});
});

test('Personal connect and callback request Mail.ReadWrite while Work scopes are preserved', async () => {
  for(const account of ['personal','work']) {
    const connected=await run(request('GET',{}, {query:{path:'api/microsoft/connect',account}}));
    assert.equal(connected.res.statusCode,302);
    const scope=new URL(connected.res.headers.Location).searchParams.get('scope');
    assert.equal(scope,`openid profile offline_access User.Read ${account==='personal'?'Mail.ReadWrite':'Mail.Read'} Mail.Send`);
    const callback=await run(request('GET',{}, {query:{path:'api/microsoft/callback',code:'synthetic',state:'state'},
      headers:{cookie:`microsoft_oauth_state=state; microsoft_oauth_account=${account}`}}),
      [reply({refresh_token:'synthetic-refresh'}),reply({result:'OK'})]);
    assert.equal(callback.res.statusCode,200);
    assert.equal(callback.calls[0].options.body.get('scope'), account==='personal'
      ?'openid profile offline_access User.Read Mail.ReadWrite Mail.Send'
      :'openid profile offline_access User.Read Mail.Read');
  }
});
