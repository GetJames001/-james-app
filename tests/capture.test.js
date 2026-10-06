const assert = require('node:assert/strict');
const test = require('node:test');
const auth = require('../lib/auth.js');
const schema = require('../lib/capture-schema.js');
const { createCaptureHandler, KEY_PREFIX, MUTATE_LUA } = require('../lib/routes/capture.js');

process.env.JAMES_AUTH_EMAIL = 'capture-owner@example.test';
process.env.JAMES_SESSION_SECRET = 'synthetic-capture-secret-at-least-thirty-two-bytes';
const ID = '12345678-1234-4234-8234-123456789abc';
const OP = '22345678-1234-4234-8234-123456789abc';
const NEXT_OP = '22345678-1234-4234-8234-123456789abd';
const NOW = '2026-10-06T15:00:00.000Z';
function record(overrides = {}) {
  return { type: 'callback', domain: 'work', title: 'Call synthetic customer', notes: '', contact: '', dueDate: '', start: '', end: '', timeZone: '', status: 'open', ...overrides };
}
function mutation(overrides = {}) {
  return { operationId: OP, id: ID, expectedRevision: 0, record: record(), ...overrides };
}
function request(method = 'POST', body = mutation(), headers = {}) {
  return { method, body, headers: { host: 'www.getjames.ai', origin: 'https://www.getjames.ai', cookie: `${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`, ...headers } };
}
function response() {
  return { statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }, end() { return this; } };
}
async function invoke(handler, req = request()) { const res = response(); await handler(req, res); return res; }
function unusedStore() {
  let calls = 0;
  const handler = createCaptureHandler({ execute: async () => { calls++; throw new Error('Unexpected store access'); }, now: () => new Date(NOW) });
  return { handler, calls: () => calls };
}

test('capture authentication and hostile-origin checks precede store access', async () => {
  const store = unusedStore();
  for (const [req, status] of [
    [request('GET', undefined, { cookie: '' }), 401],
    [request('POST', mutation(), { cookie: '' }), 401],
    [request('POST', mutation(), { origin: 'https://hostile.example.test' }), 403],
    [request('POST', mutation(), { origin: '' }), 403],
    [request('GET', undefined, { host: 'hostile.example.test' }), 403]
  ]) {
    const res = await invoke(store.handler, req);
    assert.equal(res.statusCode, status);
    assert.equal(res.body.ok, false);
    assert.match(res.headers['Cache-Control'], /private.*no-store/);
  }
  assert.equal(store.calls(), 0);
});

test('capture rejects unsupported authenticated methods without store work', async () => {
  const store = unusedStore();
  for (const method of ['PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const res = await invoke(store.handler, request(method));
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.headers.Allow, 'GET, POST');
  }
  assert.equal(store.calls(), 0);
});

test('malformed mutation envelopes are rejected before store work', async () => {
  const store = unusedStore();
  for (const body of [
    'not json', null, [], {}, mutation({ id: 'not-a-uuid' }),
    mutation({ operationId: 'not-a-uuid' }), mutation({ expectedRevision: -1 }),
    mutation({ expectedRevision: 1.5 }), mutation({ expectedRevision: '0' }),
    mutation({ extra: 'ignored?' }), mutation({ record: null }),
    mutation({ record: { ...record(), arbitrary: 'field' } })
  ]) assert.equal((await invoke(store.handler, request('POST', body))).statusCode, 400, JSON.stringify(body));
  assert.equal(store.calls(), 0);
});

test('schema rejects unsupported enums, lengths, dates and incidental appointment timing', async () => {
  const store = unusedStore();
  for (const change of [
    { type: 'task' }, { domain: 'shared' }, { status: 'cancelled' },
    { title: '' }, { title: ' '.repeat(8) }, { title: 'x'.repeat(201) },
    { notes: 'x'.repeat(2001) }, { contact: 'x'.repeat(201) },
    { title: 12 }, { notes: null }, { dueDate: '2026-02-30' }, { dueDate: '10/06/2026' },
    { start: '2026-10-06T09:00:00-07:00' }, { timeZone: 'America/Los_Angeles' },
    { type: 'appointment_draft' },
    { type: 'appointment_draft', start: '2026-10-06T09:00:00', end: '2026-10-06T10:00:00', timeZone: 'America/Los_Angeles' },
    { type: 'appointment_draft', start: '2026-10-06T09:00:00-07:00', end: '2026-10-06T08:00:00-07:00', timeZone: 'America/Los_Angeles' },
    { type: 'appointment_draft', start: '2026-10-06T09:00:00-07:00', end: '2026-10-14T09:00:00-07:00', timeZone: 'America/Los_Angeles' },
    { type: 'appointment_draft', start: '2026-10-06T09:00:00-07:00', end: '2026-10-06T10:00:00-07:00', timeZone: 'Mars/Crater' }
  ]) assert.equal((await invoke(store.handler, request('POST', mutation({ record: record(change) })))).statusCode, 400, JSON.stringify(change));
  assert.equal(store.calls(), 0);
});

test('oversized serialized body or declared content length rejects before store work', async () => {
  const store = unusedStore();
  for (const req of [request('POST', 'x'.repeat(13000)), request('POST', mutation(), { 'content-length': '13000' })]) {
    assert.equal((await invoke(store.handler, req)).statusCode, 400);
  }
  assert.equal(store.calls(), 0);
});

test('unavailable store responses are generic and do not disclose exception details', async () => {
  const handler = createCaptureHandler({ execute: async () => { throw new Error('synthetic secret provider detail'); } });
  for (const method of ['GET', 'POST']) {
    const res = await invoke(handler, request(method));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'CAPTURE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(res.body), /synthetic secret/);
    assert.match(res.headers['Cache-Control'], /private.*no-store/);
  }
});

function stored(overrides = {}) {
  return { ...record(), id: ID, revision: 1, createdAt: NOW, updatedAt: NOW, ...overrides };
}
// Model the Redis command protocol and atomic compare-and-set semantics, not a
// Lua interpreter. Script safety assertions below complement these API tests.
function redisModel(initial = []) {
  const records = new Map(initial.map(item => [item.id, JSON.stringify(item)]));
  const operations = new Map();
  const commands = [];
  const execute = async command => {
    commands.push(command);
    if (command[0] === 'HVALS') return [...records.values()];
    if (command[0] === 'HGET') return records.get(command[2]) || null;
    assert.equal(command[0], 'EVAL');
    assert.equal(command[1], MUTATE_LUA);
    assert.equal(command[2], 2);
    const [, , , key, operationKey, id, expectedRevision, encoded, fingerprint, expectedRaw] = command;
    assert.ok(key.startsWith(KEY_PREFIX));
    assert.ok(operationKey.startsWith(KEY_PREFIX));
    const replay = operations.get(operationKey);
    if (replay) return replay.fingerprint === fingerprint ? ['replay', replay.record] : ['conflict'];
    const raw = records.get(id) || '';
    if (expectedRaw !== undefined && expectedRaw !== raw) return ['conflict'];
    let previous;
    try { previous = raw ? JSON.parse(raw) : null; } catch { return ['invalid_store']; }
    if (previous && (previous.id !== id || !Number.isInteger(previous.revision))) return ['invalid_store'];
    if ((previous?.revision || 0) !== Number(expectedRevision)) return ['conflict'];
    if (!previous && records.size >= 500) return ['limit'];
    const next = JSON.parse(encoded);
    next.revision = (previous?.revision || 0) + 1;
    if (previous) next.createdAt = previous.createdAt;
    const saved = JSON.stringify(next);
    records.set(id, saved); operations.set(operationKey, { fingerprint, record: saved });
    return ['saved', saved];
  };
  return { records, operations, commands, execute, handler: createCaptureHandler({ execute, now: () => new Date(NOW) }) };
}

test('schema accepts each capture type with explicit work/personal and normalizes instants', () => {
  for (const type of ['callback', 'next_action']) {
    const input = record({ type, domain: 'personal', dueDate: '2028-02-29', title: '  Synthetic action  ' });
    const value = schema.validateRecord(input);
    assert.equal(value.type, type); assert.equal(value.domain, 'personal'); assert.equal(value.title, 'Synthetic action');
    assert.equal(value.start, ''); assert.equal(value.end, ''); assert.equal(input.title, '  Synthetic action  ', 'validation must not mutate input');
  }
  const value = schema.validateRecord(record({ type: 'appointment_draft', start: '2026-10-06T09:00:00-07:00', end: '2026-10-06T10:00:00-07:00', timeZone: 'America/Los_Angeles' }));
  assert.equal(value.start, '2026-10-06T16:00:00.000Z');
  assert.equal(value.end, '2026-10-06T17:00:00.000Z');
  assert.equal(value.timeZone, 'America/Los_Angeles');
});

test('GET reads an identity-scoped separate hash and returns validated records', async () => {
  const store = redisModel([stored()]);
  const res = await invoke(store.handler, request('GET'));
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body.records, [stored()]);
  assert.equal(store.commands[0][0], 'HVALS');
  assert.match(store.commands[0][1], /^james:capture:v1:[0-9a-f]{64}:records$/);
  assert.doesNotMatch(store.commands[0][1], /james:tasks|capture-owner|google|microsoft/);
  assert.equal(store.commands.length, 1);
});

test('create then identical operation replay writes once and conflicting operation payload fails', async () => {
  const store = redisModel();
  let res = await invoke(store.handler);
  assert.equal(res.statusCode, 200); assert.equal(res.body.saved, true); assert.equal(res.body.replayed, false);
  assert.deepEqual(res.body.record, stored());
  res = await invoke(store.handler);
  assert.equal(res.statusCode, 200); assert.equal(res.body.replayed, true);
  assert.deepEqual(res.body.record, stored());
  assert.equal(store.records.size, 1); assert.equal(store.operations.size, 1);
  res = await invoke(store.handler, request('POST', mutation({ record: record({ title: 'Changed content' }) })));
  assert.equal(res.statusCode, 409); assert.equal(store.records.size, 1);
  assert.equal(JSON.parse(store.records.get(ID)).title, 'Call synthetic customer');
});

test('revision-bound update preserves creation time and stale update cannot overwrite newer state', async () => {
  const earlier = '2026-10-05T15:00:00.000Z';
  const store = redisModel([stored({ createdAt: earlier, updatedAt: earlier })]);
  const update = mutation({ operationId: NEXT_OP, expectedRevision: 1, record: record({ status: 'completed', notes: 'Synthetic completion' }) });
  let res = await invoke(store.handler, request('POST', update));
  assert.equal(res.statusCode, 200); assert.equal(res.body.record.revision, 2);
  assert.equal(res.body.record.createdAt, earlier); assert.equal(res.body.record.updatedAt, NOW);
  assert.equal(res.body.record.status, 'completed');
  res = await invoke(store.handler, request('POST', mutation({ expectedRevision: 1, record: record({ title: 'Stale draft' }) })));
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(store.records.get(ID)).notes, 'Synthetic completion');
});

test('concurrent updates against one revision cannot silently lose an update', async () => {
  const store = redisModel([stored()]);
  const results = await Promise.all([
    invoke(store.handler, request('POST', mutation({ expectedRevision: 1, record: record({ title: 'First update' }) }))),
    invoke(store.handler, request('POST', mutation({ operationId: NEXT_OP, expectedRevision: 1, record: record({ title: 'Second update' }) })))
  ]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(JSON.parse(store.records.get(ID)).revision, 2);
});

test('malformed stored records and oversized hashes fail closed without presenting corrupt records', async () => {
  for (const rows of [
    ['not-json'], [JSON.stringify({ ...stored(), unexpected: 'field' })],
    [JSON.stringify(stored()), JSON.stringify(stored())],
    Array.from({ length: 501 }, () => JSON.stringify(stored()))
  ]) {
    const handler = createCaptureHandler({ execute: async () => rows });
    const res = await invoke(handler, request('GET'));
    assert.equal(res.statusCode, 503); assert.equal(res.body.error, 'CAPTURE_UNAVAILABLE');
    assert.equal(res.body.records, undefined);
  }
});

test('mutation errors and malformed stored-result data never claim success', async () => {
  for (const reply of [['invalid_store'], null, ['saved', 'not-json'], ['saved', JSON.stringify({ ...stored(), title: '' })]]) {
    const handler = createCaptureHandler({ execute: async command => command[0] === 'HGET' ? null : reply });
    const res = await invoke(handler);
    assert.equal(res.statusCode, 503); assert.equal(res.body.saved, undefined);
  }
  const handler = createCaptureHandler({ execute: async command => command[0] === 'HGET' ? null : ['limit'] });
  const res = await invoke(handler); assert.equal(res.statusCode, 409); assert.equal(res.body.error, 'RECORD_LIMIT');
});

test('atomic script checks replay, revision and record limit before writes and expires replay keys', () => {
  assert.match(MUTATE_LUA, /KEYS\[1\]/); assert.match(MUTATE_LUA, /KEYS\[2\]/);
  assert.match(MUTATE_LUA, /fingerprint/); assert.match(MUTATE_LUA, /revision.*tonumber\(ARGV\[2\]\)/);
  assert.match(MUTATE_LUA, /HLEN.*500/); assert.match(MUTATE_LUA, /'EX',86400/);
  assert.ok(MUTATE_LUA.indexOf("return {'conflict'}") < MUTATE_LUA.indexOf("redis.call('HSET'"));
  assert.ok(MUTATE_LUA.indexOf("return {'limit'}") < MUTATE_LUA.indexOf("redis.call('HSET'"));
  assert.doesNotMatch(MUTATE_LUA, /james:tasks|google:refresh_token|microsoft|FLUSH|DEL/);
});

test('invalid existing hash record blocks mutation before EVAL rather than repairing corrupt data', async () => {
  for (const raw of ['not-json', JSON.stringify({ ...stored(), type: 'unknown' }), JSON.stringify({ ...stored(), id: NEXT_OP })]) {
    const commands = [];
    const handler = createCaptureHandler({ execute: async command => { commands.push(command); return raw; } });
    const res = await invoke(handler, request('POST', mutation({ expectedRevision: 1 })));
    assert.equal(res.statusCode, 503);
    assert.deepEqual(commands.map(c => c[0]), ['HGET']);
  }
});

test('mutation enforces string UUIDs and schema bounds at valid edges', () => {
  for (const change of [{ id: [ID] }, { operationId: [OP] }]) assert.throws(() => schema.validateMutation(mutation(change)));
  assert.equal(schema.validateRecord(record({ title: 'x'.repeat(200), notes: 'x'.repeat(2000), contact: 'x'.repeat(200), dueDate: '2028-02-29' })).notes.length, 2000);
  assert.throws(() => schema.validateRecord(record({ dueDate: '2027-02-29' })));
  assert.match(MUTATE_LUA, /\(existing or ''\)~=ARGV\[5\]/, 'atomic execution must compare the schema-validated raw snapshot');
});
test('equivalent envelope key order replays consistently and malformed stored ID arrays fail closed',async()=>{
 const store=redisModel();assert.equal((await invoke(store.handler)).statusCode,200);
 const reordered={record:record(),expectedRevision:0,id:ID,operationId:OP};const replay=await invoke(store.handler,request('POST',reordered));assert.equal(replay.statusCode,200);assert.equal(replay.body.replayed,true);
 const corrupt={...stored(),id:[ID]};const handler=createCaptureHandler({execute:async()=>[JSON.stringify(corrupt)]});assert.equal((await invoke(handler,request('GET'))).statusCode,503);
});
