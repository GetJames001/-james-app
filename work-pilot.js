(function exposeWorkPilot(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JamesWorkPilot = api;
})(typeof window === 'undefined' ? globalThis : window, function buildWorkPilot() {
  'use strict';
  const MAX_BYTES = 1024 * 1024;
  const MAX_ROWS = 500;
  const MAX_BACKUP_BYTES = 4 * MAX_BYTES;
  const REQUIRED = ['source_record_id', 'account_id', 'site_id', 'account_name', 'action_type', 'next_action', 'status'];
  const OPTIONAL = ['site_name', 'category', 'priority', 'due_date', 'contact_name', 'contact_status', 'equipment_confidence', 'address', 'proposed_date', 'proposed_start', 'proposed_end', 'notes'];
  const COLUMNS = REQUIRED.concat(OPTIONAL);
  const ENUMS = {
    action_type: ['renewal', 'prospect', 'callback', 'quote', 'follow_up', 'other'],
    status: ['open', 'closed', 'inactive'],
    category: ['generator', 'compressor', 'other', 'unknown'],
    priority: ['high', 'normal', 'low'],
    contact_status: ['verified', 'legacy', 'unknown'],
    equipment_confidence: ['verified', 'unverified', 'unknown'],
    completion: ['open', 'completed', 'missed', 'cancelled']
  };
  const previews = new WeakMap();

  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
  function bytes(value) { return new TextEncoder().encode(value).length; }
  function plain(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  }
  function exactKeys(value, keys) {
    return plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  }
  function deepFreeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function identifier(value, max = 128) {
    return typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
  }
  function keyFor(namespace, id) { return namespace + ':' + id; }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  // State machine: bare fields cannot contain quotes; after a closing quote only
  // a delimiter/newline is legal. Newlines inside quotes remain field content.
  function csvRows(text) {
    if (typeof text !== 'string') fail('INVALID_INPUT', 'CSV input must be text.');
    if (bytes(text) > MAX_BYTES) fail('FILE_TOO_LARGE', 'CSV exceeds the 1 MiB limit.');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (text.includes('\0')) fail('INVALID_CSV', 'CSV cannot contain NUL characters.');
    const rows = [];
    let row = [], field = '', state = 'start', touched = false;
    function cell() { row.push(field); field = ''; state = 'start'; }
    function line() {
      cell();
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = []; touched = false;
      if (rows.length > MAX_ROWS + 1) fail('TOO_MANY_ROWS', 'CSV exceeds 500 data rows.');
    }
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (state === 'quoted') {
        if (char === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else state = 'closed';
        } else field += char;
        continue;
      }
      if (char === ',') { cell(); touched = true; continue; }
      if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        line(); continue;
      }
      if (state === 'closed') fail('INVALID_CSV', 'Unexpected text after a quoted field.');
      if (char === '"') {
        if (state !== 'start') fail('INVALID_CSV', 'Quote inside an unquoted field.');
        state = 'quoted'; touched = true;
      } else { field += char; state = 'bare'; touched = true; }
    }
    if (state === 'quoted') fail('INVALID_CSV', 'Unterminated quoted field.');
    if (touched || row.length || field.length || state === 'closed') line();
    if (!rows.length) fail('INVALID_HEADER', 'CSV needs a header row.');
    return rows;
  }

  function issuesFor(data) {
    const issues = [];
    for (const column of COLUMNS) {
      const value = data[column];
      if (typeof value !== 'string') { issues.push(column + ': expected text'); continue; }
      if (REQUIRED.includes(column) && !value) issues.push(column + ': required');
      const max = column === 'notes' ? 4000 : column === 'next_action' ? 2000 : 500;
      if (value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) issues.push(column + ': invalid text or length');
      if (value && ENUMS[column] && !ENUMS[column].includes(value)) issues.push(column + ': unsupported value');
    }
    for (const column of ['source_record_id', 'account_id', 'site_id']) {
      if (!identifier(data[column])) issues.push(column + ': use a stable identifier');
    }
    for (const column of ['due_date', 'proposed_date']) {
      if (data[column] && !validDate(data[column])) issues.push(column + ': use a valid YYYY-MM-DD date');
    }
    for (const column of ['proposed_start', 'proposed_end']) {
      if (data[column] && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data[column])) issues.push(column + ': use HH:mm');
    }
    if (data.proposed_start && data.proposed_end && data.proposed_start >= data.proposed_end) issues.push('proposed_end: must be later than proposed_start');
    return issues;
  }
  function emptyStore() { return { schemaVersion: 1, mode: 'synthetic', generation: 0, records: [], batches: [] }; }
  function createStore() { return deepFreeze(emptyStore()); }
  function validData(value) { return exactKeys(value, COLUMNS) && issuesFor(value).length === 0; }
  function checkStore(store) {
    if (!exactKeys(store, ['schemaVersion', 'mode', 'generation', 'records', 'batches']) ||
        store.schemaVersion !== 1 || store.mode !== 'synthetic' ||
        !Number.isSafeInteger(store.generation) || store.generation < 0 ||
        !Array.isArray(store.records) || store.records.length > MAX_ROWS || !Array.isArray(store.batches) ||
        store.batches.length !== store.generation) fail('INVALID_STORE', 'Invalid pilot envelope.');
    const keys = new Set();
    for (const record of store.records) {
      if (!exactKeys(record, ['key', 'namespace', 'sourceRecordId', 'revision', 'data', 'snapshots', 'outcome', 'history']) ||
          !identifier(record.namespace, 64) || !identifier(record.sourceRecordId) ||
          record.key !== keyFor(record.namespace, record.sourceRecordId) || keys.has(record.key) ||
          !Number.isSafeInteger(record.revision) || record.revision < 1 || !validData(record.data) ||
          record.data.source_record_id !== record.sourceRecordId || !Array.isArray(record.snapshots) ||
          record.snapshots.length !== record.revision || !ENUMS.completion.includes(record.outcome) ||
          !Array.isArray(record.history)) fail('INVALID_STORE', 'Invalid pilot record.');
      keys.add(record.key);
      record.snapshots.forEach((snapshot, index) => {
        if (!exactKeys(snapshot, ['revision', 'data', 'batchId', 'sourceRow']) || snapshot.revision !== index + 1 ||
            !Number.isSafeInteger(snapshot.sourceRow) || snapshot.sourceRow < 2 || snapshot.sourceRow > MAX_ROWS + 1 ||
            !validData(snapshot.data) || snapshot.data.source_record_id !== record.sourceRecordId ||
            !/^batch-[1-9]\d*$/.test(snapshot.batchId) || Number(snapshot.batchId.slice(6)) > store.generation)
          fail('INVALID_STORE', 'Invalid record snapshot.');
      });
      if (JSON.stringify(record.snapshots.at(-1).data) !== JSON.stringify(record.data)) fail('INVALID_STORE', 'Latest snapshot does not match the record.');
      for (const [index, history] of record.history.entries()) {
        if (!exactKeys(history, ['revision', 'batchId', 'kind']) || history.kind !== 'import' ||
            history.revision !== index + 1 ||
            !record.snapshots.some(s => s.revision === history.revision && s.batchId === history.batchId))
          fail('INVALID_STORE', 'Invalid record history.');
      }
      if (record.history.length !== record.revision) fail('INVALID_STORE', 'Missing import history.');
    }
    store.batches.forEach((batch, index) => {
      if (!exactKeys(batch, ['id', 'namespace', 'fingerprint', 'importedAt', 'accepted', 'rejected', 'duplicates', 'kept', 'replaced', 'unknownColumns']) ||
          batch.id !== 'batch-' + (index + 1) || !identifier(batch.namespace, 64) ||
          typeof batch.importedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(batch.importedAt) || Number.isNaN(Date.parse(batch.importedAt)) ||
          typeof batch.fingerprint !== 'string' || !/^fnv1a-[0-9a-f]{8}$/.test(batch.fingerprint) ||
          !['accepted', 'rejected', 'duplicates', 'kept', 'replaced'].every(k => Number.isSafeInteger(batch[k]) && batch[k] >= 0 && batch[k] <= MAX_ROWS) ||
          !Array.isArray(batch.unknownColumns) || !batch.unknownColumns.every(k => typeof k === 'string' && k.length <= 128))
        fail('INVALID_STORE', 'Invalid import batch.');
    });
    return store;
  }
  function serialize(store) {
    checkStore(store);
    const json = JSON.stringify(store);
    if (bytes(json) > MAX_BACKUP_BYTES) fail('STORE_TOO_LARGE', 'Pilot backup exceeds 4 MiB. Export and clear before importing more.');
    return json;
  }
  function restore(json) {
    if (typeof json !== 'string' || bytes(json) > MAX_BACKUP_BYTES) fail('INVALID_BACKUP', 'Invalid or oversized pilot backup.');
    let value;
    try { value = JSON.parse(json); } catch { fail('INVALID_BACKUP', 'Pilot backup is not valid JSON.'); }
    // Normalize data property order without accepting missing or extra fields.
    checkStore(value);
    return deepFreeze(value);
  }
  function fingerprint(text) {
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return 'fnv1a-' + hash.toString(16).padStart(8, '0');
  }
  function parseImport(text, namespace, current = createStore()) {
    if (!identifier(namespace, 64)) fail('INVALID_NAMESPACE', 'Source namespace must be a stable identifier.');
    const baseState = serialize(current);
    const rows = csvRows(text);
    const header = rows.shift().map(cell => cell.trim());
    if (header.some(cell => !cell || cell.length > 128) || new Set(header).size !== header.length || REQUIRED.some(k => !header.includes(k)))
      fail('INVALID_HEADER', 'Header needs unique names and every required column.');
    const unknownColumns = header.filter(k => !COLUMNS.includes(k));
    const parsed = [], rejected = [], duplicates = [], accepted = [], conflicts = [];
    const existing = new Map(current.records.map(record => [record.key, record]));
    rows.forEach((cells, index) => {
      const rowNumber = index + 2;
      if (cells.length !== header.length) { rejected.push({ rowNumber, issues: ['Column count differs from header.'] }); return; }
      const data = Object.fromEntries(COLUMNS.map(column => [column, header.includes(column) ? cells[header.indexOf(column)].trim() : '']));
      const issues = issuesFor(data);
      if (issues.length) { rejected.push({ rowNumber, issues }); return; }
      parsed.push({ rowNumber, key: keyFor(namespace, data.source_record_id), data });
    });
    const groups = new Map();
    parsed.forEach(row => { if (!groups.has(row.key)) groups.set(row.key, []); groups.get(row.key).push(row); });
    for (const group of groups.values()) {
      const first = group[0];
      if (group.some(row => JSON.stringify(row.data) !== JSON.stringify(first.data))) {
        group.forEach(row => rejected.push({ rowNumber: row.rowNumber, issues: ['Conflicting source_record_id within this file.'] }));
        continue;
      }
      group.slice(1).forEach(row => duplicates.push({ rowNumber: row.rowNumber, key: row.key, reason: 'identical-file-row' }));
      const previous = existing.get(first.key);
      if (!previous) accepted.push(first);
      else if (JSON.stringify(previous.data) === JSON.stringify(first.data)) duplicates.push({ rowNumber: first.rowNumber, key: first.key, reason: 'identical-existing-record' });
      else conflicts.push({ ...first, existingRevision: previous.revision, existingData: clone(previous.data) });
    }
    rejected.sort((a, b) => a.rowNumber - b.rowNumber);
    const preview = deepFreeze({ namespace, fingerprint: fingerprint(text), accepted, rejected, duplicates, conflicts, unknownColumns,
      counts: { rows: rows.length, accepted: accepted.length, rejected: rejected.length, duplicates: duplicates.length, conflicts: conflicts.length } });
    previews.set(preview, { baseState });
    return preview;
  }
  function commitImport(current, preview, decisions = {}) {
    const metadata = previews.get(preview);
    if (!metadata) fail('INVALID_PREVIEW', 'Create a fresh import preview first.');
    if (serialize(current) !== metadata.baseState) fail('STALE_PREVIEW', 'Pilot changed; review the import again.');
    if (!plain(decisions) || Object.keys(decisions).some(k => !['conflicts', 'acknowledgeUnknownColumns'].includes(k))) fail('INVALID_DECISIONS', 'Invalid import decisions.');
    if (preview.unknownColumns.length && decisions.acknowledgeUnknownColumns !== true) fail('UNKNOWN_COLUMNS', 'Acknowledge excluded columns before importing.');
    const conflictDecisions = decisions.conflicts || {};
    if (!plain(conflictDecisions) || Object.keys(conflictDecisions).some(key => !preview.conflicts.some(row => row.key === key))) fail('INVALID_DECISIONS', 'Unknown conflict decision.');
    for (const row of preview.conflicts) if (!['keep', 'replace'].includes(conflictDecisions[row.key])) fail('UNRESOLVED_CONFLICT', 'Resolve every conflicting record first.');
    if (current.records.length + preview.accepted.length > MAX_ROWS) fail('TOO_MANY_RECORDS', 'Pilot cannot contain more than 500 records.');
    const candidate = clone(current);
    candidate.generation++;
    const batchId = 'batch-' + candidate.generation;
    function snapshot(data, revision, sourceRow) { return { revision, data: clone(data), batchId, sourceRow }; }
    preview.accepted.forEach(row => {
      candidate.records.push({ key: row.key, namespace: preview.namespace, sourceRecordId: row.data.source_record_id,
        revision: 1, data: clone(row.data), snapshots: [snapshot(row.data, 1, row.rowNumber)],
        outcome: 'open', history: [{ revision: 1, batchId, kind: 'import' }] });
    });
    let kept = 0, replaced = 0;
    preview.conflicts.forEach(row => {
      if (conflictDecisions[row.key] === 'keep') { kept++; return; }
      const record = candidate.records.find(item => item.key === row.key);
      record.revision++; record.data = clone(row.data);
      record.snapshots.push(snapshot(row.data, record.revision, row.rowNumber));
      record.history.push({ revision: record.revision, batchId, kind: 'import' });
      // Existing execution outcomes are never inferred/overwritten by a source import.
      replaced++;
    });
    candidate.batches.push({ id: batchId, namespace: preview.namespace, fingerprint: preview.fingerprint, importedAt: new Date().toISOString(),
      accepted: preview.accepted.length, rejected: preview.rejected.length, duplicates: preview.duplicates.length,
      kept, replaced, unknownColumns: preview.unknownColumns.slice() });
    serialize(candidate); // Full validation before candidate publication.
    return deepFreeze(candidate);
  }
  return Object.freeze({ createStore, parseImport, commitImport, serialize, restore, clear: createStore,
    columns: Object.freeze(COLUMNS.slice()), requiredColumns: Object.freeze(REQUIRED.slice()),
    enums: deepFreeze(clone(ENUMS)), limits: Object.freeze({ maxBytes: MAX_BYTES, maxRows: MAX_ROWS, maxBackupBytes: MAX_BACKUP_BYTES }) });
});
