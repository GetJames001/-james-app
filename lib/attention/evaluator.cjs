'use strict';

// Pure synchronous reducer. No imports, I/O, clocks, timers, environment or dispatch.
function fail(message) { throw new TypeError(message); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function requireText(value, label) { if (!text(value)) fail(`${label} must be a nonempty string`); }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort(compare).map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function copyJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) fail('Input must contain only acyclic JSON data');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('Input objects must be plain JSON objects');
  if (Object.getOwnPropertySymbols(value).length) fail('Symbol keys are unsupported JSON data');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail('Sparse arrays or extra array properties are unsupported');
    result = Array.from({length: value.length}, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('Input accessors are unsupported');
      return copyJson(descriptor.value, seen);
    });
  } else {
    result = Object.fromEntries(Object.keys(value).sort(compare).map(k => {
      const descriptor = Object.getOwnPropertyDescriptor(value, k);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('Input accessors are unsupported');
      return [k, copyJson(descriptor.value, seen)];
    }));
  }
  seen.delete(value);
  return result;
}
function timestamp(value, label) {
  if (typeof value !== 'string') fail(`${label} must be an explicit timestamp`);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) fail(`${label} requires a timezone-aware ISO timestamp with seconds and at most six fractional digits`);
  const [, y, mo, d, h, mi, s, fraction = '', zone] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) fail(`${label} has an invalid calendar date/time`);
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
    if (zone === '-00:00' || hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) fail(`${label} has an invalid or unknown timezone offset`);
    offsetMinutes = (hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1);
  }
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}.000${zone}`);
  if (!Number.isFinite(ms)) fail(`${label} is outside the supported timestamp range`);
  return {us: BigInt(ms) * 1000n + BigInt(fraction.padEnd(6, '0')), ms, offsetMinutes, zone};
}
function source(value, label) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(text)) fail(`${label} must be [provider, sourceAccountId]`);
  return value;
}
function key(accountId, parts) { return JSON.stringify([accountId, ...parts]); }
function sameSource(a, b) { return a[0] === b[0] && a[1] === b[1]; }
function eventKey(accountId, event) { return key(accountId, [...event.source, 'event', event.id]); }
function actionKey(accountId, event) { return key(accountId, [...event.source, event.thread, event.action]); }
function sourceKey(accountId, src) { return key(accountId, src); }
function checkBooleanOrUnknown(value, label) {
  if (value !== undefined && value !== null && typeof value !== 'boolean') fail(`${label} must be boolean or unknown`);
  return value === undefined ? null : value;
}
function eventSignature(event) {
  const {read, scanId, ...content} = event;
  return stable(content);
}
function normalizeEvent(event, scan, now) {
  if (!isObject(event)) fail('Each event must be an object');
  for (const field of ['id', 'thread', 'action', 'kind']) requireText(event[field], `event.${field}`);
  source(event.source, 'event.source');
  if (!sameSource(event.source, scan.source)) fail('Event source boundary violated');
  const at = timestamp(event.at, 'event.at');
  if (at.us > timestamp(scan.at, 'scan.at').us || at.us > now.us) fail('Future event cannot establish current evidence');
  if (event.deadline !== undefined && event.deadline !== null && !isObject(event.deadline)) fail('event.deadline must be an object or unknown');
  if (event.deadline && event.deadline.at !== undefined && event.deadline.at !== null) timestamp(event.deadline.at, 'event.deadline.at');
  if (event.due !== undefined && event.due !== null) timestamp(event.due, 'event.due');
  if (event.read !== undefined && typeof event.read !== 'boolean') fail('event.read must be boolean');
  if (event.automated !== undefined && event.automated !== null && typeof event.automated !== 'boolean') fail('event.automated must be boolean or unknown');
  const {scanId, ...raw} = event;
  return raw;
}
function normalizeScan(scan, flat, now) {
  if (!isObject(scan)) fail('Each scan must be an object');
  requireText(scan.id, 'scan.id'); source(scan.source, 'scan.source');
  const at = timestamp(scan.at, 'scan.at');
  if (at.us > now.us) fail('Future scan cannot establish freshness');
  if (!Number.isSafeInteger(scan.sequence) || scan.sequence < 0) fail('scan.sequence must be a nonnegative safe integer');
  if (!Array.isArray(scan.pages) || !scan.pages.every(Array.isArray)) fail('scan.pages must be an array of event arrays');
  if (scan.error !== undefined && scan.error !== null && !text(scan.error)) fail('scan.error must be a nonempty string or null');
  if (scan.checkpoint !== undefined && scan.checkpoint !== null && typeof scan.checkpoint !== 'string') fail('scan.checkpoint must be a string or null');
  const events = [...scan.pages.flat(), ...flat].map(e => normalizeEvent(e, scan, now));
  // Canonical flattening makes page order irrelevant; all evidence is retained.
  events.sort((a, b) => compare(eventSignature(a), eventSignature(b)) || compare(stable(a), stable(b)));
  const unique = events.filter((e, i) => i === 0 || eventSignature(e) !== eventSignature(events[i - 1]));
  return {...scan, complete: checkBooleanOrUnknown(scan.complete, 'scan.complete'),
    extractionComplete: checkBooleanOrUnknown(scan.extractionComplete, 'scan.extractionComplete'),
    error: scan.error === undefined ? null : scan.error, checkpoint: scan.checkpoint === undefined ? null : scan.checkpoint,
    pages: [unique]};
}
function scanSignature(scan) {
  // Read-state changes neither introduce new facts nor cause an ID conflict.
  return stable({...scan, pages: [scan.pages.flat().map(e => JSON.parse(eventSignature(e)))]});
}
function validatePolicy(policy) {
  if (!isObject(policy)) fail('policy is required');
  for (const name of ['freshnessMs', 'unansweredAfterMs', 'dueSoonWithinMs', 'cooldownMs']) {
    if (!Number.isSafeInteger(policy[name]) || policy[name] < 0) fail(`policy.${name} must be a nonnegative safe integer`);
  }
  const q = policy.quietHours;
  if (!isObject(q) || typeof q.enabled !== 'boolean') fail('policy.quietHours.enabled must be boolean');
  requireText(q.timeZone, 'policy.quietHours.timeZone');
  for (const field of ['startHour', 'endHour']) if (!Number.isInteger(q[field]) || q[field] < 0 || q[field] > 23) fail(`policy.quietHours.${field} must be 0..23`);
  new Intl.DateTimeFormat('en-US', {timeZone: q.timeZone}).format(0);
  return policy;
}
function quiet(now, policy) {
  const q = policy.quietHours;
  if (!q.enabled || q.startHour === q.endHour) return false;
  const hour = Number(new Intl.DateTimeFormat('en-US', {timeZone: q.timeZone, hour: 'numeric', hourCycle: 'h23'}).format(new Date(now.ms)));
  return q.startHour > q.endHour ? hour >= q.startHour || hour < q.endHour : hour >= q.startHour && hour < q.endHour;
}
function evidence(value) { return isObject(value) && text(value.reference); }
function zoneMatches(zone, instant) {
  if (!text(zone)) return false;
  if (zone === 'Z') return instant.offsetMinutes === 0;
  if (/^[+-]\d{2}:\d{2}$/.test(zone)) return timestamp(`2000-01-01T00:00:00${zone}`, 'deadline.timeZone').offsetMinutes === instant.offsetMinutes;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone: zone, timeZoneName: 'longOffset'}).formatToParts(new Date(instant.ms));
    const name = parts.find(p => p.type === 'timeZoneName').value;
    if (name === 'GMT') return instant.offsetMinutes === 0;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
    return !!match && (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1) === instant.offsetMinutes;
  } catch { return false; }
}
function deadline(event, change) {
  const d = event.deadline;
  if (!isObject(d)) return {at: null, status: 'unknown', reasons: ['deadline_precision_unknown']};
  if (d.precision === 'none') {
    if (change && !evidence(d.evidence)) return {at: null, status: 'unknown', reasons: ['deadline_removal_evidence_missing']};
    return {at: null, status: 'none', reasons: []};
  }
  const reasons = [];
  if (d.precision !== 'exact') reasons.push('deadline_precision_unknown');
  if (!text(d.raw)) reasons.push('deadline_raw_expression_missing');
  if (!evidence(d.evidence)) reasons.push('deadline_evidence_missing');
  if (!text(d.timeZone)) reasons.push('deadline_timezone_unknown');
  if (!text(d.at)) reasons.push('deadline_instant_missing');
  if (text(d.at) && text(d.timeZone) && !zoneMatches(d.timeZone, timestamp(d.at, 'deadline.at'))) reasons.push('deadline_timezone_mismatch');
  return {at: reasons.length ? null : d.at, status: reasons.length ? 'unknown' : 'exact', reasons};
}
function validateLedger(ledger, accountId, now) {
  if (!Array.isArray(ledger)) fail('previousState.reminderLedger must be an array');
  const tokens = new Set();
  for (const entry of ledger) {
    if (!isObject(entry) || !Array.isArray(entry.token) || entry.token.length !== 7) fail('Malformed reminder ledger entry');
    if (entry.token[0] !== accountId) fail('Reminder ledger account namespace mismatch');
    if (!entry.token.slice(0, 5).every(text) || !Number.isSafeInteger(entry.token[5]) || entry.token[5] < 1 || !['overdue','due_soon','deadline_changed','callback','unanswered'].includes(entry.token[6])) fail('Malformed reminder token');
    if (!['pending','sent','uncertain','definitely_failed'].includes(entry.status)) fail('Unknown reminder ledger status');
    if (timestamp(entry.at, 'ledger.at').us > now.us) fail('Future reminder ledger entry');
    const id = JSON.stringify(entry.token);
    if (tokens.has(id)) fail('Duplicate reminder ledger token');
    tokens.add(id);
  }
  return ledger.slice().sort((a, b) => compare(JSON.stringify(a.token), JSON.stringify(b.token)));
}

function evaluateAttention(input) {
  const data = copyJson(input);
  if (!isObject(data)) fail('Input must be an object');
  requireText(data.accountId, 'accountId');
  const accountId = data.accountId, now = timestamp(data.evaluatedAt, 'evaluatedAt');
  const policy = validatePolicy(data.policy);
  const previous = data.previousState;
  if (previous !== undefined && previous !== null) {
    if (!isObject(previous) || previous.version !== 1 || previous.accountId !== accountId) fail('previousState version/account namespace mismatch');
    if (timestamp(previous.asOf, 'previousState.asOf').us > now.us) fail('Evaluation time cannot move backwards');
    if (!Array.isArray(previous.scans)) fail('previousState.scans must be an array');
  }
  const historical = (previous?.scans || []).map(scan => normalizeScan(scan, [], now));
  const ledger = validateLedger(previous ? previous.reminderLedger : [], accountId, now);
  const scans = data.scans === undefined ? [] : data.scans;
  const flat = data.events === undefined ? [] : data.events;
  if (!Array.isArray(scans) || !Array.isArray(flat)) fail('events and scans must be arrays');
  for (const event of flat) {
    if (!isObject(event)) fail('Each flat event must be an object');
    requireText(event.scanId, 'flat event.scanId'); source(event.source, 'flat event.source');
    const matches = scans.filter(s => isObject(s) && s.id === event.scanId && Array.isArray(s.source) && sameSource(s.source, event.source));
    if (matches.length !== 1) fail('Flat event requires exactly one matching scan/source association');
  }
  const incoming = scans.map(scan => normalizeScan(scan, flat.filter(e => e.scanId === scan.id && Array.isArray(scan.source) && sameSource(e.source, scan.source)), now));
  incoming.sort((a, b) => compare(timestamp(a.at, 'scan.at').us, timestamp(b.at, 'scan.at').us) || compare(a.sequence, b.sequence) || compare(stable(a.source), stable(b.source)) || compare(a.id, b.id));
  const history = [], seenHistory = new Set();
  for (const scan of [...historical, ...incoming]) {
    const signature = scanSignature(scan);
    if (!seenHistory.has(signature)) { history.push(scan); seenHistory.add(signature); }
  }
  const accepted = new Map(), admissionRank = new Map(), sources = new Map(), scanIds = new Map(), review = new Map();
  function addReview(src, type, id, reasons, raw) {
    if (!reasons.length) return;
    const identity = key(accountId, [...src, type, id]);
    const old = review.get(identity);
    review.set(identity, {id: identity, accountId, source: src, ...(type === 'event' ? {eventId: id} : {scanId: id}),
      reasons: [...new Set([...(old?.reasons || []), ...reasons])].sort(compare), evidence: old ? [...(Array.isArray(old.evidence) ? old.evidence : [old.evidence]), raw] : raw});
  }
  for (const [scanIndex, scan] of history.entries()) {
    const sk = sourceKey(accountId, scan.source), scanKey = key(accountId, [...scan.source, 'scan', scan.id]);
    let state = sources.get(sk);
    if (!state) {
      state = {source: scan.source, lastGood: null, lastCheckpoint: null, latest: null, conflicts: []};
      sources.set(sk, state);
    }
    const signature = scanSignature(scan);
    if (scanIds.has(scanKey)) {
      if (scanIds.get(scanKey) !== signature) {
        state.conflicts.push('scan_id_conflict');
        addReview(scan.source, 'scan', scan.id, ['scan_id_conflict'], scan);
      }
      continue;
    }
    scanIds.set(scanKey, signature);
    if (state.latest && (scan.sequence <= state.latest.sequence || timestamp(scan.at, 'scan.at').us < timestamp(state.latest.at, 'scan.at').us)) {
      const reason = scan.sequence === state.latest.sequence ? 'scan_sequence_conflict' : 'stale_scan_rejected';
      state.conflicts.push(reason); addReview(scan.source, 'scan', scan.id, [reason], scan); continue;
    }
    state.latest = scan;
    if (scan.error !== null || scan.complete !== true || scan.extractionComplete !== true) continue;
    const staged = new Map(), conflicts = [];
    for (const event of scan.pages.flat()) {
      const ek = eventKey(accountId, event), prior = staged.get(ek) || accepted.get(ek);
      if (prior && eventSignature(prior) !== eventSignature(event)) {
        conflicts.push(event.id);
        addReview(event.source, 'event', event.id, ['event_id_conflict'], {accepted: prior, incoming: event});
      } else if (!prior) staged.set(ek, event);
    }
    if (conflicts.length) { state.conflicts.push('event_id_conflict'); continue; }
    for (const [ek, event] of staged) { accepted.set(ek, event); admissionRank.set(ek, scanIndex); }
    state.lastGood = scan;
    if (scan.checkpoint !== null) state.lastCheckpoint = scan.checkpoint;
  }
  // Coverage review is current source state; a subsequent complete scan may fix it.
  for (const state of sources.values()) {
    const scan = state.latest, reasons = [];
    if (scan.complete !== true) reasons.push(scan.complete === false ? 'paging_incomplete' : 'paging_unknown');
    if (scan.extractionComplete !== true) reasons.push(scan.extractionComplete === false ? 'extraction_incomplete' : 'extraction_unknown');
    addReview(scan.source, 'scan', scan.id, reasons, scan);
  }
  const obligations = new Map(), information = new Map();
  const kindOrder = kind => kind === 'request' || kind === 'callback' ? 0 : kind === 'deadline_change' ? 1 : kind === 'resolution' || kind === 'cancel' ? 2 : 3;
  const events = [...accepted.values()].sort((a, b) => compare(timestamp(a.at, 'event.at').us, timestamp(b.at, 'event.at').us) || compare(kindOrder(a.kind), kindOrder(b.kind)) || compare(eventKey(accountId, a), eventKey(accountId, b)));
  const commonVerified = event => evidence(event.evidence) && isObject(event.extraction) && event.extraction.complete === true && event.extraction.confident === true && event.automated === false;
  const matchingVerified = event => ['requester', 'self'].includes(event.actor) && evidence(event.actorEvidence) && event.matching === true && evidence(event.matchingEvidence) && event.matchingEvidence.thread === event.thread && event.matchingEvidence.action === event.action;
  const requestGroups = new Map(), baselines = new Map(), changeGroups = new Map(), ambiguousChanges = new Set();
  for (const event of events) {
    if (!commonVerified(event)) continue;
    const ak = actionKey(accountId, event), ek = eventKey(accountId, event);
    if (['request', 'callback'].includes(event.kind) && event.owner === 'user' && evidence(event.ownershipEvidence)) {
      if (!requestGroups.has(ak)) requestGroups.set(ak, []);
      requestGroups.get(ak).push(event);
      const prior = baselines.get(ak);
      // The first successful admission fixes the baseline. Backfilled notices
      // cannot rewrite an already established deadline or opening instant.
      if (!prior || admissionRank.get(ek) < admissionRank.get(eventKey(accountId, prior))) baselines.set(ak, event);
    }
    if (event.kind === 'deadline_change' && matchingVerified(event)) {
      const due = deadline(event, true);
      if (due.reasons.length) continue;
      const groupKey = stable([ak, timestamp(event.at, 'event.at').us.toString()]);
      if (!changeGroups.has(groupKey)) changeGroups.set(groupKey, []);
      changeGroups.get(groupKey).push({event, outcome: stable([due.status, due.at === null ? null : timestamp(due.at, 'deadline').us.toString()])});
    }
  }
  for (const group of changeGroups.values()) {
    if (new Set(group.map(entry => entry.outcome)).size < 2) continue;
    for (const {event} of group) {
      ambiguousChanges.add(eventKey(accountId, event));
      addReview(event.source, 'event', event.id, ['simultaneous_deadline_conflict'], event);
    }
  }
  for (const event of events) {
    const reasons = [];
    if (!evidence(event.evidence)) reasons.push('source_evidence_missing');
    if (!isObject(event.extraction) || event.extraction.complete !== true) reasons.push('event_extraction_incomplete_or_unknown');
    if (!isObject(event.extraction) || event.extraction.confident !== true) reasons.push('event_extraction_uncertain_or_unknown');
    if (event.automated !== true && event.automated !== false) reasons.push('automation_unknown');
    if (reasons.length) { addReview(event.source, 'event', event.id, reasons, event); continue; }
    if (event.automated === true) continue;
    const ak = actionKey(accountId, event);
    if (event.kind === 'important') { information.set(ak, event); continue; }
    if (event.kind === 'request' || event.kind === 'callback') {
      if (!['user', 'other'].includes(event.owner)) reasons.push('ownership_unknown');
      if (!evidence(event.ownershipEvidence)) reasons.push('ownership_evidence_missing');
      if (reasons.length) { addReview(event.source, 'event', event.id, reasons, event); continue; }
      if (event.owner !== 'user') continue;
      const due = deadline(event, false);
      addReview(event.source, 'event', event.id, due.reasons, event);
      if (!obligations.has(ak)) {
        const baseline = baselines.get(ak), baselineDue = deadline(baseline, false);
        // Establish chronological existence at the earliest qualifying request,
        // using the frozen admission baseline's fields. A backfilled matching
        // closure can then operate before a later duplicate notice is replayed.
        obligations.set(ak, {id: ak, accountId, source: baseline.source, thread: baseline.thread, action: baseline.action,
          kind: baseline.kind, status: 'open', openedAt: baseline.at, deadline: baselineDue.at, deadlineStatus: baselineDue.status,
          revision: 1, requestEvidence: requestGroups.get(ak), deadlineHistory: [{eventId: baseline.id, at: baseline.at, deadline: baseline.deadline ?? null}], closureEvidence: []});
      }
      continue;
    }
    if (['deadline_change', 'resolution', 'cancel'].includes(event.kind)) {
      if (!['requester', 'self'].includes(event.actor)) reasons.push('actor_authority_unknown_or_unauthorized');
      if (!evidence(event.actorEvidence)) reasons.push('actor_evidence_missing');
      if (event.matching !== true) reasons.push('matching_not_verified');
      if (!evidence(event.matchingEvidence) || event.matchingEvidence.thread !== event.thread || event.matchingEvidence.action !== event.action) reasons.push('matching_evidence_missing_or_wrong_scope');
      if (event.kind === 'resolution' && (event.resolution !== 'completed' || !['sent', 'observed'].includes(event.delivery))) reasons.push('completion_not_verified');
      if (event.kind === 'cancel' && event.resolution !== 'cancelled') reasons.push('cancellation_not_verified');
      if (reasons.length) { addReview(event.source, 'event', event.id, reasons, event); continue; }
      const item = obligations.get(ak);
      if (!item || item.status !== 'open') continue;
      if (event.kind === 'deadline_change') {
        const due = deadline(event, true);
        item.deadlineHistory.push({eventId: event.id, at: event.at, deadline: event.deadline ?? null, evidence: event});
        if (ambiguousChanges.has(eventKey(accountId, event))) continue;
        if (due.reasons.length) { addReview(event.source, 'event', event.id, due.reasons, event); continue; }
        const oldInstant = item.deadline === null ? null : timestamp(item.deadline, 'deadline').us;
        const newInstant = due.at === null ? null : timestamp(due.at, 'deadline').us;
        if (oldInstant !== newInstant || item.deadlineStatus !== due.status) {
          item.deadline = due.at; item.deadlineStatus = due.status; item.revision += 1;
        }
      } else { item.status = 'closed'; item.closureEvidence.push(event); }
      continue;
    }
    if (!['fyi', 'removed', 'draft', 'reply'].includes(event.kind)) addReview(event.source, 'event', event.id, ['unknown_event_kind'], event);
  }
  const needsReview = [...review.values()].sort((a, b) => compare(a.id, b.id));
  const health = [...sources.entries()].map(([id, state]) => {
    const scan = state.latest;
    const rawStatus = state.lastGood === scan ? 'fresh' : state.lastGood ? 'stale' : 'unavailable';
    const age = state.lastGood ? now.us - timestamp(state.lastGood.at, 'lastSuccess').us : null;
    const effectiveStatus = rawStatus === 'fresh' && age > BigInt(policy.freshnessMs) * 1000n ? 'stale' : rawStatus;
    const scopedReview = needsReview.filter(r => sameSource(r.source, state.source));
    const knownOpen = [...obligations.values()].filter(o => o.status === 'open' && sameSource(o.source, state.source)).length;
    return {id, accountId, source: state.source, rawStatus, effectiveStatus,
      lastSuccessfulScanAt: state.lastGood?.at ?? null, checkpoint: state.lastCheckpoint,
      latestScanAt: scan.at, pageCoverage: scan.complete === true ? 'complete' : scan.complete === false ? 'incomplete' : 'unknown',
      extractionCoverage: scan.extractionComplete === true ? 'complete' : scan.extractionComplete === false ? 'incomplete' : 'unknown',
      issues: [...new Set([...(scan.error ? [scan.error] : []), ...state.conflicts, ...scopedReview.flatMap(r => r.reasons)])].sort(compare),
      knownOpen, canClaimNoActions: effectiveStatus === 'fresh' && knownOpen === 0 && scopedReview.length === 0};
  }).sort((a, b) => compare(a.id, b.id));
  const healthBySource = new Map(health.map(h => [h.id, h]));
  const attentionItems = [];
  for (const item of obligations.values()) {
    if (item.status !== 'open') continue;
    const h = healthBySource.get(sourceKey(accountId, item.source));
    attentionItems.push({...item, sourceStatus: h.rawStatus, effectiveSourceStatus: h.effectiveStatus,
      evidenceBasis: item.requestEvidence.some(e => Array.isArray(e.fixtureAssumptions) && e.fixtureAssumptions.length) ? 'fixture_assumptions' : 'supplied_evidence'});
  }
  for (const [id, event] of information) {
    const h = healthBySource.get(sourceKey(accountId, event.source));
    attentionItems.push({id, accountId, source: event.source, thread: event.thread, action: event.action, kind: 'important',
      status: 'information', deadline: null, deadlineStatus: 'none', evidence: event,
      sourceStatus: h.rawStatus, effectiveSourceStatus: h.effectiveStatus,
      evidenceBasis: Array.isArray(event.fixtureAssumptions) && event.fixtureAssumptions.length ? 'fixture_assumptions' : 'supplied_evidence'});
  }
  attentionItems.sort((a, b) => compare(a.action, b.action) || compare(a.kind, b.kind) || compare(a.id, b.id));
  const reminderCandidates = [];
  if (!quiet(now, policy)) {
    for (const item of obligations.values()) {
      const h = healthBySource.get(sourceKey(accountId, item.source));
      if (item.status !== 'open' || h.effectiveStatus !== 'fresh' || h.issues.length || item.deadlineStatus === 'unknown') continue;
      const prefix = [accountId, ...item.source, item.thread, item.action];
      const prior = ledger.filter(l => l.token.slice(0, 5).every((part, i) => part === prefix[i]) && l.status !== 'definitely_failed');
      if (prior.some(l => now.us - timestamp(l.at, 'ledger.at').us < BigInt(policy.cooldownMs) * 1000n)) continue;
      const due = item.deadline === null ? null : timestamp(item.deadline, 'deadline').us;
      let stage = null;
      if (due !== null && due <= now.us) stage = 'overdue';
      else if (due !== null && due - now.us <= BigInt(policy.dueSoonWithinMs) * 1000n) stage = 'due_soon';
      else if (item.revision > 1 && prior.length) stage = 'deadline_changed';
      else if (due === null && now.us - timestamp(item.openedAt, 'openedAt').us >= BigInt(policy.unansweredAfterMs) * 1000n) stage = item.kind === 'callback' ? 'callback' : 'unanswered';
      if (!stage) continue;
      const token = [...prefix, item.revision, stage], id = JSON.stringify(token);
      if (ledger.some(l => JSON.stringify(l.token) === id && l.status !== 'definitely_failed')) continue;
      reminderCandidates.push({id, token, accountId, source: item.source, thread: item.thread, action: item.action, revision: item.revision, stage});
    }
  }
  reminderCandidates.sort((a, b) => compare(a.id, b.id));
  return copyJson({attentionItems, reminderCandidates, sourceHealth: health, needsReview,
    nextState: {version: 1, accountId, asOf: data.evaluatedAt, scans: history, reminderLedger: ledger}, tasksCreated: 0, sourceMutations: 0});
}

module.exports = {evaluateAttention};
