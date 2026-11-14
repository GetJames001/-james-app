const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../lib/auth.js');
const handler = require('../api/tasks.js');

process.env.JAMES_AUTH_EMAIL = 'taskpad-fixture@example.test';
process.env.JAMES_SESSION_SECRET = 'taskpad-fixture-secret-at-least-thirty-two-bytes';
process.env.KV_REST_API_URL = 'https://storage.example.test';
process.env.KV_REST_API_TOKEN = 'fictional-token';
delete process.env.VERCEL_ENV;
const originalFetch = global.fetch;
test.after(() => { global.fetch = originalFetch; });
const task = id => ({ id, title: `Fictional ${id}`, domain: 'personal', status: 'open', extra: { preserve: true } });
function request(method, body, headers = {}) {
  return { method, body, headers: {
    host: 'www.getjames.ai', origin: 'https://www.getjames.ai',
    cookie: `${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`, ...headers
  } };
}
async function call(method = 'GET', body, headers) {
  const res = { code: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; },
    status(n) { this.code = n; return this; }, json(value) { this.body = value; return this; } };
  await handler(request(method, body, headers), res);
  return res;
}
function fixture(raw = null, hook = () => {}) {
  const state = { raw, commands: [] };
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://storage.example.test');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const parts = JSON.parse(options.body); state.commands.push(parts);
    const override = await hook(parts, state);
    if (override) return override;
    if (parts[0] === 'GET') return Response.json({ result: state.raw });
    assert.equal(parts[0], 'EVAL'); assert.equal(parts[2], 1); assert.equal(parts[3], 'james:tasks');
    const matches = parts[4] === 'absent' ? state.raw === null : state.raw === parts[5];
    if (matches) state.raw = parts[6];
    return Response.json({ result: matches ? 1 : 0 });
  };
  return state;
}

test('missing storage is a genuinely empty list; save preserves the legacy array and unknown fields', async () => {
  const state = fixture(); const first = await call();
  assert.equal(first.code, 200); assert.deepEqual(first.body.tasks, []);
  assert.match(first.body.revision, /^[a-f0-9]{64}$/);
  assert.match(first.headers['Cache-Control'], /no-store/);
  const records = [task('A')];
  const saved = await call('POST', { tasks: records, revision: first.body.revision });
  assert.equal(saved.code, 200); assert.equal(saved.body.saved, true);
  assert.deepEqual(JSON.parse(state.raw), records); assert.notEqual(saved.body.revision, first.body.revision);
  assert.deepEqual((await call()).body.tasks, records);
});

test('a stale second device cannot erase an addition from the first device', async () => {
  const state = fixture(JSON.stringify([task('original')]));
  const a = (await call()).body, b = (await call()).body;
  const changed = [...a.tasks, task('A')];
  assert.equal((await call('POST', { tasks: changed, revision: a.revision })).code, 200);
  const rejected = await call('POST', { tasks: [...b.tasks, task('B')], revision: b.revision });
  assert.equal(rejected.code, 409); assert.equal(rejected.body.saved, undefined);
  assert.deepEqual(JSON.parse(state.raw), changed);
  assert.equal(state.commands.filter(c => c[0] === 'EVAL').length, 1);
});

test('atomic comparison rejects a writer racing after the read and before the commit', async () => {
  const newer = [task('concurrent')];
  const state = fixture(JSON.stringify([task('original')]), parts => {
    if (parts[0] === 'EVAL') state.raw = JSON.stringify(newer);
  });
  const first = (await call()).body;
  assert.equal((await call('POST', { tasks: [task('mine')], revision: first.revision })).code, 409);
  assert.deepEqual(JSON.parse(state.raw), newer);
});

test('HTTP 200 storage errors, invalid envelopes and non-confirming write results never report saved', async () => {
  for (const result of [{ error: 'upstream-secret' }, { error: '', result: 1 }, {}, { result: 'OK' }, { result: null }]) {
    const state = fixture(JSON.stringify([task('original')]), parts => parts[0] === 'EVAL' ? Response.json(result) : null);
    const first = (await call()).body;
    const res = await call('POST', { tasks: [task('changed')], revision: first.revision });
    assert.equal(res.code, 503); assert.deepEqual(res.body, { error: 'TASKS_UNAVAILABLE' });
    assert.deepEqual(JSON.parse(state.raw), [task('original')]);
  }
});

test('corrupt, wrong-shaped, duplicated or oversized saved data stays untouched and unavailable', async () => {
  for (const raw of ['{bad', '', 'null', '{}', '[null]', JSON.stringify([task('A'), task('A')]), ' '.repeat(1024*1024+1)]) {
    const state = fixture(raw); const res = await call();
    assert.equal(res.code, 503); assert.equal(res.body.tasks, undefined); assert.equal(state.raw, raw);
    const write = await call('POST', { tasks: [task('replacement')], revision: 'a'.repeat(64) });
    assert.equal(write.code, 503); assert.equal(state.commands.filter(c => c[0] === 'EVAL').length, 0);
  }
});

test('invalid input, missing revision and excessive sizes are rejected before any storage request', async () => {
  const state = fixture();
  for (const tasks of [null, {}, [null], [{ id: 'a', title: '' }], [task('a'), task('a')],
    [{ ...task('a'), title: 'a'.repeat(2001) }], Array.from({ length: 2001 }, (_,i) => task(String(i))),
    [{ ...task('a'), extra: 'a'.repeat(1024*1024) }]]) {
    assert.equal((await call('POST', { tasks, revision: 'a'.repeat(64) })).code, 400);
  }
  assert.equal((await call('POST', '{bad')).code, 400);
  assert.equal((await call('POST', 'a'.repeat(1024*1024+257))).code, 413);
  assert.equal((await call('POST', { tasks: [] })).code, 428);
  assert.equal(state.commands.length, 0);
});

test('Preview is read-only even with a valid owner and revision; no live write opt-in exists', async () => {
  const state = fixture(JSON.stringify([task('saved')]));
  process.env.VERCEL_ENV = 'preview';
  try {
    const first = (await call()).body; assert.equal(first.writable, false);
    state.commands.length = 0;
    const res = await call('POST', { tasks: [], revision: first.revision });
    assert.equal(res.code, 403); assert.equal(res.body.error, 'TASKS_PREVIEW_READ_ONLY');
    assert.equal(state.commands.length, 0); assert.deepEqual(JSON.parse(state.raw), [task('saved')]);
  } finally { delete process.env.VERCEL_ENV; }
});

test('session, CSRF and method gates run before storage', async () => {
  const state = fixture();
  assert.equal((await call('GET', undefined, { cookie: '' })).code, 401);
  assert.equal((await call('POST', { tasks: [] }, { origin: 'https://attacker.example' })).code, 403);
  const res = await call('DELETE'); assert.equal(res.code, 405); assert.equal(res.headers.Allow, 'GET, POST');
  assert.equal(state.commands.length, 0);
});

test('storage network, HTTP, truncated-body and declared-size failures remain unavailable', async () => {
  for (const fail of [() => { throw Error('private connection info'); },
    () => new Response('private upstream body', { status: 500 }),
    () => new Response('{"result":'),
    () => new Response('{}', { headers: { 'content-length': String(9*1024*1024) } })]) {
    global.fetch = async () => fail(); const res = await call();
    assert.equal(res.code, 503); assert.deepEqual(res.body, { error: 'TASKS_UNAVAILABLE' });
  }
});
