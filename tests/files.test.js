const assert = require('node:assert/strict');
const test = require('node:test');
const { createSessionToken, SESSION_COOKIE } = require('../lib/auth.js');
const files = require('../lib/routes/files.js');

test('Files round trips bytes across sessions and protects the account boundary', async t => {
  process.env.JAMES_AUTH_EMAIL = 'files-fixture@example.test';
  process.env.JAMES_SESSION_SECRET = 'fictional-files-test-session-secret';
  process.env.KV_REST_API_URL = 'https://files-fixture.invalid';
  const accounts = new Map();
  t.mock.method(global, 'fetch', async (_url, options) => {
    const [command, ...args] = JSON.parse(options.body);
    const key = command === 'EVAL' ? args[2] : args[0];
    if (!accounts.has(key)) accounts.set(key, new Map());
    const rows = accounts.get(key);
    let result;
    if (command === 'EVAL' && args.length === 7) {
      rows.set(args[3], args[4]);
      rows.set('bytes:' + args[3], args[5]);
      result = 1;
    } else if (command === 'EVAL') {
      result = [...rows].filter(([id]) => id.length === 64).map(([,value]) => value);
    } else if (command === 'HMGET') {
      result = args.slice(1).map(field => rows.get(field) ?? null);
    } else {
      assert.equal(command, 'HDEL');
      result = args.slice(1).filter(field => rows.delete(field)).length;
    }
    return Response.json({ result });
  });

  async function request(method, { id, body, auth = true, origin = 'https://www.getjames.ai' } = {}) {
    const req = { method, body, query: { id }, headers: {
      host: 'www.getjames.ai', origin, 'content-type': 'application/json',
      ...(auth ? { cookie: SESSION_COOKIE + '=' + createSessionToken(process.env.JAMES_AUTH_EMAIL) } : {})
    }};
    const res = {
      setHeader() {},
      status(code) { this.code = code; return this; },
      json(payload) { this.body = payload; return this; },
      end() { return this; }
    };
    await files(req, res);
    return res;
  }

  const body = { name: 'sample.pdf', type: 'application/pdf', lastModified: 1, content: 'Zml4dHVyZQ==' };
  assert.equal((await request('GET', { auth: false })).code, 401);
  assert.equal((await request('POST', { body, origin: 'https://foreign.example' })).code, 403);
  assert.equal(accounts.size, 0);
  const saved = await request('POST', { body });
  assert.equal(saved.code, 200);
  const { id } = saved.body.file;
  assert.deepEqual((await request('GET')).body.files, [saved.body.file]);
  assert.equal((await request('GET', { id })).body.file.content, body.content);
  process.env.JAMES_AUTH_EMAIL = 'different-fixture@example.test';
  assert.equal((await request('GET', { id })).code, 404);
  process.env.JAMES_AUTH_EMAIL = 'files-fixture@example.test';
  assert.equal((await request('DELETE', { id })).code, 204);
  assert.deepEqual((await request('GET')).body.files, []);
});
