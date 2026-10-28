/**
 * Isolated Workbench domain. Browser-local DEMO storage, never authentication.
 * The injected account scope is a test boundary, not a server authorization check.
 * LocalStorage has no multi-tab atomic compare-and-swap: production must replace
 * this adapter with an authenticated transactional store. No network calls here.
 */
export const SCHEMA_VERSION = 1;
export const DEMO_ACCOUNT_ID = 'demo-account';
export const PROJECT_STATUSES = Object.freeze(['active', 'waiting', 'parked', 'completed']);
export const VERSION_STATES = Object.freeze(['draft', 'generating', 'ready_for_review', 'approved', 'failed']);
export const TOOL_STATES = Object.freeze({ storage: 'available', generation: 'unavailable', scheduler: 'disconnected', voice: 'unavailable', pdf: 'unavailable', docx: 'unavailable' });
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const iso = () => new Date().toISOString();
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
let sequence = 0;
export function makeId(prefix = 'local') {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++sequence}`}`;
}
export class WorkbenchError extends Error {
  constructor(code, message) { super(message); this.name = 'WorkbenchError'; this.code = code; }
}
function ensure(condition, code, message) { if (!condition) throw new WorkbenchError(code, message); }
function requiredText(value, label) {
  ensure(typeof value === 'string' && value.trim(), 'needs_input', `${label} is required.`);
  return value.trim();
}
function versionAt(project, versionId) {
  const version = (project.versions || []).find(item => item.id === versionId);
  ensure(version, 'not_found', 'That version is not in this project.');
  return version;
}
function touch(project, now = iso()) { const result = clone(project); result.updatedAt = now; return result; }
export function createProject(input = {}) {
  const now = input.createdAt || iso();
  return {
    schemaVersion: 1, id: input.id || makeId('project'), accountId: input.accountId || DEMO_ACCOUNT_ID,
    title: requiredText(input.title || 'Untitled project', 'Project name'), mode: input.mode || 'visual',
    objective: input.objective || '', status: 'active', revision: 0, createdAt: now, updatedAt: now,
    constraints: [], decisions: [], ideas: [], assetIds: [], artifactIds: [], assets: [], assetImports: [], versions: [],
    selectedArtifactVersionId: null, nextAction: input.nextAction || 'Choose a useful next step',
    disposition: null, checkpoint: null, draftText: '', viewState: { tab: 'preview', scrollTop: 0 },
    sessionOpen: false, needsNextStep: true, sourceFacts: [], previewRef: null,
    ...clone(input), schemaVersion: 1,
  };
}
export function createVersion(project, input = {}) {
  const result = touch(project);
  const parentVersionId = input.parentVersionId || null;
  if (parentVersionId) versionAt(project, parentVersionId);
  const state = input.state || 'draft';
  ensure(VERSION_STATES.includes(state), 'invalid_version', 'Unknown version state.');
  ensure(state !== 'approved', 'invalid_version', 'New versions must be reviewed before approval.');
  const version = {
    id: input.id || makeId('version'), artifactId: input.artifactId || project.artifactIds?.[0] || makeId('artifact'),
    projectId: project.id, parentVersionId, state, label: input.label || `Version ${(project.versions || []).length + 1}`,
    title: input.title || input.label || 'Working draft', content: input.content ?? '', contentRef: input.contentRef || null,
    previewRef: input.previewRef || null, sourceAssetIds: clone(input.sourceAssetIds || []),
    constraintsSnapshot: clone(project.constraints || []), createdAt: iso(), errorCode: null,
    ...clone(input), projectId: project.id, state,
  };
  ensure(typeof version.content === 'string', 'invalid_version', 'Version content must be text.');
  ensure(!(project.versions || []).some(item => item.id === version.id), 'invalid_version', 'Version IDs must be unique.');
  result.versions = [...(result.versions || []), version];
  result.artifactIds = [...new Set([...(result.artifactIds || []), version.artifactId])];
  result.selectedArtifactVersionId = version.id;
  result.needsNextStep = false;
  return result;
}
export function approveVersion(project, versionId = project.selectedArtifactVersionId) {
  const version = versionAt(project, versionId);
  ensure(['ready_for_review', 'draft', 'approved'].includes(version.state), 'invalid_transition', 'Wait for a finished version before approving.');
  if (version.state === 'approved') return clone(project);
  const result = touch(project);
  result.versions = result.versions.map(item => item.id === versionId ? { ...item, state: 'approved', approvedAt: iso() } : item);
  return result;
}
export function reviseVersion(project, versionId = project.selectedArtifactVersionId, instructions = '') {
  const original = versionAt(project, versionId);
  const options = typeof instructions === 'object' ? instructions : { revisionInstructions: instructions };
  return createVersion(project, {
    artifactId: original.artifactId, parentVersionId: original.id, label: `Revision of ${original.label || original.title || 'version'}`,
    content: original.content || '', previewRef: original.previewRef || null, sourceAssetIds: original.sourceAssetIds || [],
    revisionInstructions: options.revisionInstructions || '', ...clone(options), state: 'draft', id: makeId('version'),
  });
}
export function restoreVersion(project, versionId) {
  const original = versionAt(project, versionId);
  return createVersion(project, {
    artifactId: original.artifactId, parentVersionId: original.id, label: `Restored ${original.label || original.title || 'version'}`,
    content: original.content || '', contentRef: original.contentRef || null, previewRef: original.previewRef || null,
    sourceAssetIds: original.sourceAssetIds || [], restoredFromVersionId: original.id, state: 'draft',
  });
}
export function selectVersion(project, versionId) {
  const version = versionAt(project, versionId);
  const result = touch(project); result.selectedArtifactVersionId = versionId;
  return result;
}
export function getReadyForReview(project) { return (project.versions || []).filter(item => item.state === 'ready_for_review').map(clone); }
export function makeCheckpoint(project, viewState = project.viewState || {}) {
  return {
    schemaVersion: 1, projectId: project.id, revision: project.revision,
    objectiveSummary: project.objective || '', acceptedDecisionIds: (project.decisions || []).filter(item => item.state === 'accepted').map(item => item.id),
    selectedArtifactVersionId: project.selectedArtifactVersionId || null, openQuestions: clone(project.openQuestions || []),
    nextAction: project.nextAction || null, owner: project.accountId, draftRef: null,
    draftText: project.draftText || '', viewState: clone(viewState), savedAt: null,
  };
}
export function checkpointProject(project, viewState = project.viewState || {}) {
  const result = touch(project); result.viewState = clone(viewState);
  result.checkpoint = makeCheckpoint(result, viewState); return result;
}
export function beginSession(project) {
  const result = resumeProject(project); result.sessionOpen = true; return result;
}
export function resumeProject(project) {
  const result = clone(project);
  if (project.checkpoint) {
    const checkpoint = project.checkpoint;
    if (checkpoint.selectedArtifactVersionId && (project.versions || []).some(item => item.id === checkpoint.selectedArtifactVersionId)) result.selectedArtifactVersionId = checkpoint.selectedArtifactVersionId;
    result.draftText = checkpoint.draftText ?? project.draftText ?? '';
    result.viewState = clone(checkpoint.viewState || project.viewState || {});
  }
  result.needsNextStep = Boolean(project.sessionOpen || !project.nextAction);
  return result;
}
export function applyDisposition(project, input = {}) {
  const kinds = ['continue_later', 'scheduled_return', 'waiting', 'parked', 'completed'];
  ensure(kinds.includes(input.kind), 'needs_input', 'Choose how to leave this project.');
  if (input.kind === 'waiting') requiredText(input.waitingOn, 'What you are waiting on');
  if (input.kind === 'parked') requiredText(input.reason || input.nextAction, 'A reason or next step');
  if (['continue_later', 'scheduled_return'].includes(input.kind)) requiredText(input.nextAction || project.nextAction, 'Next step');
  if (input.kind === 'scheduled_return') {
    ensure(typeof input.dueAt === 'string' && !Number.isNaN(Date.parse(input.dueAt)) && /(Z|[+-]\d{2}:\d{2})$/.test(input.dueAt), 'needs_input', 'Choose a return time with a time zone.');
    requiredText(input.timeZone, 'Time zone');
  }
  const result = touch(project);
  result.status = ({ waiting: 'waiting', parked: 'parked', completed: 'completed' })[input.kind] || 'active';
  result.nextAction = input.nextAction ?? project.nextAction ?? null;
  result.disposition = {
    kind: input.kind, nextAction: result.nextAction, waitingOn: input.waitingOn || null,
    reason: input.reason || null, requestedAt: iso(), dueAt: input.dueAt || null, timeZone: input.timeZone || null,
    schedulingState: input.kind === 'scheduled_return' ? 'proposed' : 'not_requested', externalScheduleId: null,
  };
  result.sessionOpen = false; result.needsNextStep = false;
  return checkpointProject(result);
}
/** A proposal-only adapter. It deliberately cannot confirm or dispatch reminders. */
export function createProposalScheduler() {
  return Object.freeze({
    state: 'disconnected',
    propose(disposition) { return { status: 'succeeded', proposalId: makeId('proposal'), disposition: { ...clone(disposition), schedulingState: 'proposed', externalScheduleId: null }, userMessage: 'Return proposal saved. No reminder has been scheduled.' }; },
    confirm() { return { status: 'unavailable', userMessage: 'Connect an authorized scheduling service before scheduling a reminder.' }; },
  });
}
export function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    get length() { return values.size; }, key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; }, setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }, clear() { values.clear(); },
  };
}
function assertProject(project, accountId, previous = null) {
  ensure(project && project.schemaVersion === 1 && typeof project.id === 'string', 'invalid_project', 'This project has an unsupported format.');
  ensure(project.accountId === accountId, 'account_mismatch', 'This project belongs to another demo account.');
  requiredText(project.title, 'Project name');
  ensure(PROJECT_STATUSES.includes(project.status), 'invalid_project', 'Unknown project status.');
  ensure(Array.isArray(project.versions) && Array.isArray(project.assets), 'invalid_project', 'Project versions and assets are required.');
  const ids = new Set();
  for (const version of project.versions) {
    ensure(version.projectId === project.id && typeof version.id === 'string' && !ids.has(version.id) && VERSION_STATES.includes(version.state), 'invalid_version', 'A version is outside this project or has an invalid identity.');
    ensure(typeof version.content === 'string', 'invalid_version', 'Version content must be text.');
    ids.add(version.id);
  }
  ensure(!project.selectedArtifactVersionId || ids.has(project.selectedArtifactVersionId), 'invalid_selection', 'The selected version is missing.');
  for (const asset of project.assets) ensure(asset.accountId === accountId && asset.projectId === project.id, 'account_mismatch', 'An asset belongs to another demo account or project.');
  if (project.checkpoint) ensure(project.checkpoint.projectId === project.id && project.checkpoint.owner === accountId, 'account_mismatch', 'The checkpoint is outside this demo account.');
  if (project.disposition?.schedulingState === 'confirmed') ensure(false, 'unavailable', 'This demo cannot confirm scheduling.');
  if (!previous) return;
  for (const original of previous.versions || []) {
    const current = project.versions.find(item => item.id === original.id);
    ensure(current, 'immutable_version', 'Version history cannot be removed.');
    if (original.state === 'approved') ensure(JSON.stringify(current) === JSON.stringify(original), 'immutable_version', 'Approved versions are immutable. Create a revision instead.');
    else if (original.state !== 'draft') {
      const snapshot = item => { const value = clone(item); delete value.state; delete value.approvedAt; delete value.errorCode; return value; };
      ensure(JSON.stringify(snapshot(current)) === JSON.stringify(snapshot(original)), 'immutable_version', 'Version snapshots are immutable. Create a revision instead.');
    } else {
      for (const key of ['id', 'artifactId', 'projectId', 'parentVersionId', 'createdAt']) ensure(current[key] === original[key], 'immutable_version', 'Draft identity and ancestry cannot be changed.');
      ensure(stableJSON(current.editHistory || []) === stableJSON(original.editHistory || []), 'immutable_version', 'Draft edit history cannot be rewritten.');
    }
  }
  for (const original of previous.assets || []) {
    const current = project.assets.find(item => item.id === original.id);
    ensure(current && JSON.stringify(current) === JSON.stringify(original), 'immutable_asset', 'Original assets are immutable. Import a new source instead.');
  }
  for (const original of previous.assetImports || []) ensure((project.assetImports || []).some(item => JSON.stringify(item) === JSON.stringify(original)), 'immutable_source', 'Import provenance cannot be removed.');
}
export function createDemoStore(options = {}) {
  let accountId = options.accountId || DEMO_ACCOUNT_ID, accountGeneration = 0;
  const keyPrefix = options.keyPrefix || 'james.workbench.demo.v1';
  const now = options.now || iso;
  let storage = options.storage, unavailable = false, nextFailure = false, lastError = null;
  const readFailure = (error, fallback) => { lastError = { code: error.code || 'storage_unavailable', message: error.message }; if (!options.safeReads) throw error; return fallback; };
  if (!storage) { try { storage = globalThis.localStorage; } catch { unavailable = true; } }
  if (!storage) unavailable = true;
  const prefix = () => `${keyPrefix}:${encodeURIComponent(accountId)}:`;
  const projectKey = id => `${prefix()}project:${encodeURIComponent(id)}`;
  const read = key => {
    ensure(!unavailable, 'storage_unavailable', 'Browser storage is unavailable. Keep this tab open and export your unsaved work.');
    try { const value = storage.getItem(key); return value == null ? null : JSON.parse(value); }
    catch (error) { if (error instanceof WorkbenchError) throw error; throw new WorkbenchError('storage_unavailable', 'Local data could not be read. Existing storage has been left untouched.'); }
  };
  const write = (key, value) => {
    ensure(!unavailable, 'storage_unavailable', 'Browser storage is unavailable. Keep this tab open and export your unsaved work.');
    try { storage.setItem(key, JSON.stringify(value)); }
    catch { throw new WorkbenchError('storage_unavailable', 'Could not save locally. Your draft is still in this tab; retry or export it.'); }
  };
  const store = {
    storageKind: 'browser-local-demo', atomicAcrossTabs: false,
    get accountId() { return accountId; },
    get accountGeneration() { return accountGeneration; },
    get lastError() { return clone(lastError); },
    load(id) {
      try {
        const project = read(projectKey(id));
        if (!project) { lastError = null; return null; }
        assertProject(project, accountId); lastError = null; return clone(project);
      } catch (error) { return readFailure(error, null); }
    },
    list() {
      const projects = [];
      try {
        ensure(!unavailable, 'storage_unavailable', 'Browser storage is unavailable.');
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (key?.startsWith(`${prefix()}project:`)) {
            const project = read(key); assertProject(project, accountId); projects.push(project);
          }
        }
      } catch (error) { return readFailure(error instanceof WorkbenchError ? error : new WorkbenchError('storage_unavailable', 'Local projects could not be read.'), []); }
      lastError = null; return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(clone);
    },
    save(project, { expectedRevision } = {}) {
      try {
        ensure(Number.isInteger(expectedRevision) && expectedRevision >= 0, 'conflict', 'A known project revision is required before saving.');
        const previous = read(projectKey(project.id));
        const revision = previous?.revision || 0;
        if (revision !== expectedRevision) return { status: 'conflict', projectRevision: revision, currentProject: clone(previous), userMessage: 'A newer local revision exists. Your draft is retained; compare or export it before reloading.' };
        assertProject(project, accountId, previous);
        if (nextFailure) { nextFailure = false; throw new WorkbenchError('storage_unavailable', 'Could not save locally. Your draft is still in this tab; retry or export it.'); }
        const saved = clone(project); saved.revision = revision + 1; saved.updatedAt = now();
        for (const original of previous?.versions || []) {
          const current = saved.versions.find(item => item.id === original.id);
          if (original.state === 'draft' && (current.content !== original.content || current.previewRef !== original.previewRef)) {
            current.editHistory = [...clone(original.editHistory || []), { id: makeId('edit'), content: original.content, previewRef: original.previewRef || null, savedAt: saved.updatedAt }];
          }
        }
        if (saved.checkpoint) { saved.checkpoint.revision = saved.revision; saved.checkpoint.savedAt = saved.updatedAt; }
        write(projectKey(project.id), saved); lastError = null;
        return { status: 'succeeded', project: clone(saved), projectRevision: saved.revision, userMessage: 'Saved in this browser.' };
      } catch (error) {
        lastError = { code: error.code || 'save_failed', message: error instanceof WorkbenchError ? error.message : 'Could not save.' };
        return { status: error.code === 'conflict' ? 'conflict' : 'failed', errorCode: error.code || 'save_failed', userMessage: error instanceof WorkbenchError ? error.message : 'Could not save. Your draft has not been discarded.' };
      }
    },
    seed(projects) {
      const results = [];
      for (const project of projects) {
        const current = store.load(project.id);
        if (current) { results.push({ status: 'succeeded', project: current, skipped: true }); continue; }
        results.push(store.save(project, { expectedRevision: 0 }));
      }
      return { status: results.every(item => item.status === 'succeeded') ? 'succeeded' : 'failed', results };
    },
    failNextSave() { nextFailure = true; },
    switchAccount(value) { accountId = requiredText(value, 'Demo account'); accountGeneration += 1; nextFailure = false; lastError = null; return accountId; },
    readBlob(sha256) { return read(`${prefix()}blob:${sha256}`); },
    writeBlob(sha256, blob) {
      const key = `${prefix()}blob:${sha256}`; const existing = read(key);
      if (existing) return clone(existing);
      write(key, blob); return clone(blob);
    },
  };
  return store;
}
export const createLocalStore = createDemoStore;
function encodeBytes(bytes) {
  let result = '';
  for (let start = 0; start < bytes.length; start += 8192) result += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(result);
}
function decodeBytes(base64) { return Uint8Array.from(atob(base64), char => char.charCodeAt(0)); }
export async function sha256Bytes(bytes, cryptoProvider = globalThis.crypto) {
  ensure(cryptoProvider?.subtle, 'unavailable', 'SHA-256 is unavailable. Use a secure local preview origin.');
  const hash = await cryptoProvider.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createAssetManager({ store, cryptoProvider = globalThis.crypto, maxBytes = 2 * 1024 * 1024 } = {}) {
  ensure(store, 'needs_input', 'A project store is required.');
  return {
    async import(file, { projectId, expectedRevision, origin = 'upload', sourceRefs = [] } = {}) {
      const accountId = store.accountId, accountGeneration = store.accountGeneration;
      try {
        const project = store.load(projectId);
        ensure(project, 'not_found', 'Project not found.');
        ensure(file && typeof file.arrayBuffer === 'function', 'needs_input', 'Choose a local file.');
        ensure(file.size <= maxBytes, 'file_too_large', `Demo imports are limited to ${Math.round(maxBytes / 1024 / 1024)} MB per file.`);
        ensure(['upload', 'reference', 'generated'].includes(origin), 'needs_input', 'Choose a supported source kind.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        ensure(bytes.length <= maxBytes, 'file_too_large', 'This file is too large for demo storage.');
        const hash = await sha256Bytes(bytes, cryptoProvider);
        if (store.accountId !== accountId || store.accountGeneration !== accountGeneration) return { status: 'superseded', userMessage: 'The demo account changed; this import was not saved.' };
        const existing = (project.assets || []).find(asset => asset.sha256 === hash);
        const mediaType = file.type || 'application/octet-stream';
        const asset = existing || {
          id: makeId('asset'), accountId, projectId, sha256: hash, mediaType, byteSize: bytes.length,
          storageRef: `demo-blob:${hash}`, originalName: file.name || 'Untitled source', origin,
          sourceRefs: clone(sourceRefs), createdAt: iso(),
        };
        const importRecord = { id: makeId('import'), assetId: asset.id, projectId, originalName: file.name || 'Untitled source', origin, sourceRefs: clone(sourceRefs), importedAt: iso() };
        const next = clone(project);
        next.assets = existing ? next.assets : [...(next.assets || []), asset];
        next.assetIds = [...new Set([...(next.assetIds || []), asset.id])];
        next.assetImports = [...(next.assetImports || []), importRecord];
        // A failed project save may leave an unreferenced blob, but never loses a source.
        store.writeBlob(hash, { sha256: hash, byteSize: bytes.length, base64: encodeBytes(bytes), mediaType });
        const saved = store.save(next, { expectedRevision: expectedRevision ?? project.revision });
        return { ...saved, ...(saved.status === 'succeeded' ? { asset: clone(asset), importRecord, duplicate: Boolean(existing) } : {}) };
      } catch (error) { return { status: 'failed', errorCode: error.code || 'import_failed', userMessage: error instanceof WorkbenchError ? error.message : 'The source could not be imported. Original files have not changed.' }; }
    },
    getPreview(assetId, { projectId } = {}) {
      const projects = projectId ? [store.load(projectId)].filter(Boolean) : store.list();
      const asset = projects.flatMap(project => project.assets || []).find(item => item.id === assetId);
      if (!asset) return { status: 'unavailable', userMessage: 'Source not found in this demo account.' };
      if (asset.previewRef) return { status: 'succeeded', previewRef: asset.previewRef };
      const blob = asset.sha256 ? store.readBlob(asset.sha256) : null;
      if (!blob || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.mediaType)) return { status: 'unavailable', userMessage: 'No safe image preview is available. The original source can still be exported.' };
      return { status: 'succeeded', previewRef: `data:${blob.mediaType};base64,${blob.base64}` };
    },
    export(assetId, format = 'original', { projectId } = {}) {
      if (format !== 'original') return { status: 'unavailable', userMessage: 'This demo exports original source bytes only.' };
      const projects = projectId ? [store.load(projectId)].filter(Boolean) : store.list();
      const asset = projects.flatMap(project => project.assets || []).find(item => item.id === assetId);
      const blob = asset?.sha256 ? store.readBlob(asset.sha256) : null;
      if (!blob) return { status: 'unavailable', userMessage: 'Original bytes are unavailable for this fixture.' };
      return { status: 'succeeded', bytes: decodeBytes(blob.base64), mediaType: blob.mediaType, filename: asset.originalName };
    },
  };
}
export function exportVersion(project, versionId = project.selectedArtifactVersionId, format = 'txt') {
  if (!['txt', 'json'].includes(format)) return { status: 'unavailable', userMessage: `${format.toUpperCase()} export is not connected. This demo supports TXT and JSON only.` };
  try {
    const version = versionAt(project, versionId);
    const filename = `${project.title.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'project'}-${version.id}.${format}`;
    const content = format === 'txt' ? version.content : JSON.stringify({ schemaVersion: 1, projectId: project.id, projectRevision: project.revision, title: project.title, version: clone(version) }, null, 2);
    return { status: 'succeeded', content, filename, mediaType: format === 'txt' ? 'text/plain;charset=utf-8' : 'application/json', artifactVersionId: version.id, projectRevision: project.revision, userMessage: 'Selected version prepared for export.' };
  } catch (error) { return { status: 'failed', userMessage: error.message }; }
}
/** Typed, synthetic commands only. Never creates a paid/shared voice session. */
export function createCommandAdapter({ store, handlers = {}, conversationId = 'demo-conversation', onFocus = () => {}, onSpeak = () => {}, stopVoice = () => {} } = {}) {
  ensure(store, 'needs_input', 'A project store is required.');
  let generation = 0, accountEpoch = 0, projectId = null, ended = false;
  const calls = new Map(), pending = new Set();
  const context = () => ({ accountId: store.accountId, conversationId, projectId, navigationGeneration: generation, ended });
  const invalidate = () => { generation += 1; for (const controller of pending) controller.abort(); };
  const result = (command, status, userMessage, extra = {}) => ({ callId: command.callId, status, projectRevision: null, artifactVersionId: null, reviewRequired: false, userMessage, ...extra });
  const adapter = {
    getContext: context,
    navigate(id) { invalidate(); projectId = id || null; return generation; },
    end() { ended = true; invalidate(); stopVoice(); return context(); },
    resume() { ended = false; invalidate(); return context(); },
    switchAccount(accountId) { invalidate(); accountEpoch += 1; ended = false; projectId = null; calls.clear(); stopVoice(); store.switchAccount(accountId); return context(); },
    execute(command) {
      if (!command || typeof command.callId !== 'string' || !command.callId.trim()) return Promise.resolve(result(command || {}, 'needs_input', 'A stable call ID is required.'));
      const callKey = `${accountEpoch}:${store.accountGeneration}:${store.accountId}:${command.conversationId}:${command.callId}`;
      const fingerprint = stableJSON(command);
      const prior = calls.get(callKey);
      if (prior) return prior.fingerprint === fingerprint ? prior.promise : Promise.resolve(result(command, 'conflict', 'That call ID was already used for a different command.'));
      const epoch = accountEpoch, accountId = store.accountId, storeEpoch = store.accountGeneration, navigation = generation;
      const controller = new AbortController(); pending.add(controller);
      const current = () => !ended && epoch === accountEpoch && storeEpoch === store.accountGeneration && accountId === store.accountId && generation === navigation && !controller.signal.aborted;
      const promise = Promise.resolve().then(async () => {
        if (command.conversationId !== conversationId) return result(command, 'conflict', 'This command belongs to another conversation.');
        if (!current()) return result(command, 'superseded', 'This command is no longer current.');
        if (command.navigationGeneration !== generation) return result(command, 'superseded', 'The workspace changed before this command ran.');
        if (command.action === 'end') { adapter.end(); return result(command, 'succeeded', 'Session ended. Pending results will not speak or change the workspace.'); }
        const args = command.arguments || {};
        let loaded = command.projectId ? store.load(command.projectId) : null;
        if (!['create_project', 'open_project'].includes(command.action) && projectId && command.projectId !== projectId) return result(command, 'superseded', 'This command belongs to a different workspace.');
        if (!['create_project', 'open_project'].includes(command.action)) {
          if (!loaded) return result(command, 'needs_input', 'Open a project first.');
          if (command.expectedRevision !== loaded.revision) return result(command, 'conflict', 'The project changed before this command ran.', { projectRevision: loaded.revision });
        }
        let output;
        if (handlers[command.action]) output = await handlers[command.action]({ command: clone(command), project: clone(loaded), signal: controller.signal, context: { ...context() } });
        else if (command.action === 'create_project') output = { project: createProject({ title: args.title, mode: args.mode || 'visual', objective: args.objective || '', accountId }), focus: true, userMessage: 'Project created in this browser.' };
        else if (command.action === 'open_project') {
          if (!loaded) return result(command, 'needs_input', 'Project not found.');
          output = { focus: true, project: loaded, noSave: true, userMessage: 'Project opened.' };
        }
        else if (command.action === 'select_version') output = { project: selectVersion(loaded, args.versionId), userMessage: 'Version selected.' };
        else if (command.action === 'approve_version') output = { project: approveVersion(loaded, args.versionId), userMessage: 'Version approved. Nothing has been published.' };
        else if (command.action === 'revise_version') output = { project: reviseVersion(loaded, args.versionId, args.instructions || ''), userMessage: 'A new draft revision is ready to edit.' };
        else if (command.action === 'restore_version') output = { project: restoreVersion(loaded, args.versionId), userMessage: 'Restored as a new draft revision.' };
        else if (command.action === 'save_project') {
          const next = clone(loaded);
          if (typeof args.draftText === 'string') next.draftText = args.draftText;
          output = { project: checkpointProject(next, args.viewState || next.viewState), userMessage: 'Saved in this browser.' };
        }
        else if (command.action === 'close_project') output = { project: applyDisposition(loaded, args), userMessage: args.kind === 'scheduled_return' ? 'Return proposal saved. No reminder has been scheduled.' : 'Disposition saved in this browser.' };
        else return result(command, 'unavailable', 'That tool is not connected in this isolated demo.');
        if (!current()) return result(command, 'superseded', 'The workspace changed; this result was not applied.');
        if (!output || output.status && output.status !== 'succeeded') return result(command, output?.status || 'failed', output?.userMessage || 'The command could not be completed.');
        let saved = output.project;
        if (saved) {
          if (saved.accountId !== accountId || (command.action !== 'create_project' && saved.id !== command.projectId)) return result(command, 'failed', 'The result was outside the originating project.');
          if (!output.noSave) {
            const save = store.save(checkpointProject(saved), { expectedRevision: command.action === 'create_project' ? 0 : command.expectedRevision });
            if (save.status !== 'succeeded') return result(command, save.status, save.userMessage, { projectRevision: save.projectRevision ?? null });
            saved = save.project;
          }
        }
        if (output.focus) { invalidate(); projectId = saved?.id || command.projectId; try { onFocus({ projectId, project: clone(saved), navigationGeneration: generation }); } catch { /* UI notification cannot undo a confirmed save. */ } }
        const answer = result(command, 'succeeded', output.userMessage || 'Done.', { projectRevision: saved?.revision ?? loaded?.revision ?? null, artifactVersionId: output.artifactVersionId || saved?.selectedArtifactVersionId || null, reviewRequired: Boolean(output.reviewRequired), ...(saved ? { project: clone(saved) } : {}) });
        if (!ended && epoch === accountEpoch && storeEpoch === store.accountGeneration && accountId === store.accountId) { try { onSpeak(answer.userMessage, { ...context() }); } catch { /* A presentation failure does not change the confirmed result. */ } }
        return answer;
      }).catch(error => result(command, error.code === 'needs_input' ? 'needs_input' : 'failed', error instanceof WorkbenchError ? error.message : 'The command failed. No provider details were exposed.'))
        .finally(() => pending.delete(controller));
      calls.set(callKey, { fingerprint, promise });
      return promise;
    },
  };
  return adapter;
}
