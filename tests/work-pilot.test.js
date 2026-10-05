const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pilot = require('../work-pilot.js');
const headers = pilot.requiredColumns;
const base = { source_record_id: 'R-1', account_id: 'A-1', site_id: 'S-1', account_name: 'Synthetic North', action_type: 'renewal', next_action: 'Review synthetic renewal', status: 'open' };
function csv(rows, columns = headers) {
  const field = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return columns.join(',') + '\r\n' + rows.map(row => columns.map(k => field(row[k])).join(',')).join('\r\n');
}
function code(expected) { return error => error.code === expected; }
function imported(rows = [base], columns = headers) {
  const store = pilot.createStore();
  return pilot.commitImport(store, pilot.parseImport(csv(rows, columns), 'fixture', store));
}

test('Work pilot exposes the same browser API without network or storage dependencies', () => {
  const context = { window: {}, TextEncoder };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../work-pilot.js'), 'utf8'), context);
  assert.equal(typeof context.window.JamesWorkPilot.parseImport, 'function');
  assert.equal(context.window.JamesWorkPilot.createStore().mode, 'synthetic');
});

test('CSV accepts BOM, CRLF, escaped quotes, quoted commas and multiline fields', () => {
  const row = { ...base, account_name: 'Synthetic, "North"', next_action: 'First line\r\nSecond line' };
  const preview = pilot.parseImport('\ufeff' + csv([row]) + '\r\n', 'fixture');
  assert.equal(preview.accepted[0].data.account_name, row.account_name);
  assert.equal(preview.accepted[0].data.next_action, row.next_action);
  assert.equal(preview.counts.rows, 1);
});

test('CSV rejects unterminated quotes, bare quotes, text after close, NUL and invalid headers', () => {
  for (const text of ['a\n"unfinished', 'a\nx"y', 'a\n"x"z', 'a\n\0']) assert.throws(() => pilot.parseImport(text, 'fixture'), code('INVALID_CSV'));
  for (const text of ['', 'a,b\nx,y', headers.concat('status').join(',')]) assert.throws(() => pilot.parseImport(text, 'fixture'), code('INVALID_HEADER'));
});

test('Limits use UTF-8 bytes and count logical CSV rows, allowing exactly 500', () => {
  assert.throws(() => pilot.parseImport('é'.repeat(524289), 'fixture'), code('FILE_TOO_LARGE'));
  const rows = Array.from({ length: 500 }, (_, i) => ({ ...base, source_record_id: 'R-' + i }));
  assert.equal(pilot.parseImport(csv(rows), 'fixture').counts.rows, 500);
  assert.throws(() => pilot.parseImport(csv(rows.concat({ ...base, source_record_id: 'extra' })), 'fixture'), code('TOO_MANY_ROWS'));
  assert.throws(() => pilot.parseImport(csv([base]), ''), code('INVALID_NAMESPACE'));
});

test('Row validation reports missing identity, bad enums, dates, times and shape without losing valid rows', () => {
  const columns = pilot.columns;
  const rows = [base, { ...base, source_record_id: '', status: 'maybe', due_date: '2026-02-29', proposed_start: '25:10' },
    { ...base, source_record_id: 'R-2', due_date: '2024-02-29', proposed_start: '09:00', proposed_end: '08:59' }];
  const preview = pilot.parseImport(csv(rows, columns), 'fixture');
  assert.equal(preview.accepted.length, 1);
  assert.equal(preview.rejected.length, 2);
  assert.ok(preview.rejected[0].issues.some(message => message.startsWith('source_record_id:')));
  assert.ok(preview.rejected[0].issues.some(message => message.startsWith('due_date:')));
  assert.ok(!preview.rejected[1].issues.some(message => message.startsWith('due_date:')));
  const malformed = pilot.parseImport(csv([base]) + '\r\nx,y', 'fixture');
  assert.equal(malformed.rejected[0].rowNumber, 3);
});

test('Unknown columns are explicitly disclosed and require acknowledgement; never enter records', () => {
  const store = pilot.createStore();
  const preview = pilot.parseImport(csv([{ ...base, provider_token: 'synthetic-unused', __proto__: 'ignored' }], headers.concat('provider_token')), 'fixture', store);
  assert.deepEqual(preview.unknownColumns, ['provider_token']);
  assert.throws(() => pilot.commitImport(store, preview), code('UNKNOWN_COLUMNS'));
  const next = pilot.commitImport(store, preview, { acknowledgeUnknownColumns: true });
  assert.equal(next.records[0].data.provider_token, undefined);
  assert.deepEqual(next.batches[0].unknownColumns, ['provider_token']);
});

test('Stable source identity retains same-title records and separate sites/accounts/namespaces', () => {
  const first = imported([base, { ...base, source_record_id: 'R-2', site_id: 'S-2' }]);
  assert.equal(first.records.length, 2);
  const preview = pilot.parseImport(csv([base]), 'another-source', first);
  const next = pilot.commitImport(first, preview);
  assert.equal(next.records.length, 3);
  assert.equal(next.records[0].key, 'fixture:R-1');
  assert.equal(next.records[2].key, 'another-source:R-1');
});

test('Identical rows deduplicate; all conflicting rows sharing an ID within a file are rejected', () => {
  const preview = pilot.parseImport(csv([base, base, { ...base, source_record_id: 'R-2' }, { ...base, source_record_id: 'R-2', next_action: 'Different' }]), 'fixture');
  assert.equal(preview.accepted.length, 1);
  assert.equal(preview.duplicates.length, 1);
  assert.equal(preview.rejected.length, 2);
  const next = imported();
  const repeat = pilot.parseImport(csv([base]), 'fixture', next);
  assert.equal(repeat.accepted.length, 0);
  assert.equal(repeat.duplicates[0].reason, 'identical-existing-record');
  assert.equal(pilot.commitImport(next, repeat).records[0].revision, 1);
});

test('Conflicts require explicit choices, preserving immutable revisions, snapshots, outcomes and history', () => {
  const saved = JSON.parse(pilot.serialize(imported()));
  saved.records[0].outcome = 'completed';
  const first = pilot.restore(JSON.stringify(saved));
  const preview = pilot.parseImport(csv([{ ...base, next_action: 'Updated action' }]), 'fixture', first);
  assert.equal(preview.conflicts[0].existingRevision, 1);
  assert.equal(first.records[0].outcome, 'completed');
  assert.throws(() => pilot.commitImport(first, preview), code('UNRESOLVED_CONFLICT'));
  assert.throws(() => pilot.commitImport(first, preview, { conflicts: { 'fixture:R-1': 'yes' } }), code('UNRESOLVED_CONFLICT'));
  const kept = pilot.commitImport(first, preview, { conflicts: { 'fixture:R-1': 'keep' } });
  assert.equal(kept.records[0].revision, 1);
  const replaced = pilot.commitImport(first, preview, { conflicts: { 'fixture:R-1': 'replace' } });
  assert.equal(replaced.records[0].revision, 2);
  assert.equal(replaced.records[0].outcome, 'completed');
  assert.equal(replaced.records[0].data.completion, undefined);
  assert.equal(replaced.records[0].snapshots[0].data.next_action, base.next_action);
  assert.equal(replaced.records[0].snapshots[1].sourceRow, 2);
  assert.equal(replaced.records[0].history.length, 2);
  assert.ok(replaced.batches[1].importedAt.endsWith('Z'));
  assert.equal(first.records[0].revision, 1);
  assert.equal(first.generation, 1);
  assert.ok(Object.isFrozen(replaced.records[0].data));
});

test('Atomic commit rejects forged, stale and wrong-base previews; failed commits leave input intact', () => {
  const empty = pilot.createStore();
  const preview = pilot.parseImport(csv([base]), 'fixture', empty);
  assert.throws(() => pilot.commitImport(empty, JSON.parse(JSON.stringify(preview))), code('INVALID_PREVIEW'));
  const next = pilot.commitImport(empty, preview);
  assert.throws(() => pilot.commitImport(next, preview), code('STALE_PREVIEW'));
  const other = imported([{ ...base, next_action: 'Another base' }]);
  const bound = pilot.parseImport(csv([{ ...base, source_record_id: 'R-2' }]), 'fixture', next);
  assert.equal(other.generation, next.generation);
  assert.throws(() => pilot.commitImport(other, bound), code('STALE_PREVIEW'));
  assert.throws(() => pilot.commitImport(empty, preview, { conflicts: { unknown: 'keep' } }), code('INVALID_DECISIONS'));
  assert.equal(empty.records.length, 0);
});

test('Store cap is enforced atomically across imports', () => {
  const full = imported(Array.from({ length: 500 }, (_, i) => ({ ...base, source_record_id: 'R-' + i })));
  const preview = pilot.parseImport(csv([{ ...base, source_record_id: 'R-extra' }]), 'fixture', full);
  assert.throws(() => pilot.commitImport(full, preview), code('TOO_MANY_RECORDS'));
  assert.equal(full.records.length, 500);
});

test('Export/restore roundtrips with immutable state; clear produces only a fresh pilot envelope', () => {
  const store = imported();
  const restored = pilot.restore(pilot.serialize(store));
  assert.deepEqual(restored, store);
  assert.ok(Object.isFrozen(restored.records[0].snapshots));
  assert.deepEqual(pilot.clear(), pilot.createStore());
  assert.equal(store.records.length, 1);
});

test('Restore rejects malformed/oversized/foreign and forged nested records, revisions and history', () => {
  assert.throws(() => pilot.restore('{'), code('INVALID_BACKUP'));
  assert.throws(() => pilot.restore(' '.repeat(pilot.limits.maxBackupBytes + 1)), code('INVALID_BACKUP'));
  const initial = imported();
  const mutations = [
    x => { x.mode = 'production'; }, x => { x.schemaVersion = 2; }, x => { x.extra = true; },
    x => { x.records.push(x.records[0]); }, x => { x.records[0].key = 'forged'; },
    x => { x.records[0].revision = 2; }, x => { x.records[0].outcome = { unsafe: true }; },
    x => { x.records[0].history[0].kind = 'email'; }, x => { x.records[0].history = []; },
    x => { x.records[0].data.status = 'unknown'; }, x => { x.records[0].data.token = 'extra'; },
    x => { x.records[0].snapshots[0].data.next_action = 'tampered'; },
    x => { x.records[0].snapshots[0].sourceRow = 0; }, x => { x.batches[0].importedAt = 'not-a-date'; }
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(pilot.serialize(initial)); mutate(value);
    assert.throws(() => pilot.restore(JSON.stringify(value)), code('INVALID_STORE'));
  }
});

test('Synthetic fixture provides representative queue cases with no real contacts or company records', () => {
  const text = fs.readFileSync(path.join(__dirname, '../assets/workday-pilot-synthetic.csv'), 'utf8');
  const preview = pilot.parseImport(text, 'synthetic-demo');
  assert.equal(preview.rejected.length, 0);
  assert.equal(preview.accepted.length, 10);
  assert.ok(preview.accepted.some(row => row.data.category === 'compressor'));
  assert.ok(preview.accepted.some(row => row.data.contact_status === 'legacy'));
  assert.ok(preview.accepted.some(row => row.data.notes.includes('Missed')));
  assert.ok(preview.accepted.every(row => row.data.account_name.startsWith('Synthetic')));
});
