// Integration preparation. No authentication, transport or voice connection is created.
import {checkpointProject, resumeProject} from './core.js';
const copy = value => structuredClone(value);
export function createAsyncDemoStore(store, {before = async () => {}} = {}) {
  const call = async (method, ...args) => {
    const epoch = store.accountGeneration;
    const snapshot = copy(args);
    await before(method);
    if (epoch !== store.accountGeneration) return {status: 'superseded'};
    const result=store[method](...snapshot);
    // This synchronous demo store reports failure before committing. Remote adapters
    // must explicitly establish this outcome; a transport exception is uncertain.
    return method==='save'&&['failed','conflict'].includes(result?.status)?{...result,commitState:'not_committed'}:result;
  };
  return {
    get accountId() { return store.accountId; },
    get accountGeneration() { return store.accountGeneration; },
    seed: projects => call('seed', projects),
    readBlob: id => call('readBlob', id),
    writeBlob: (id, blob) => call('writeBlob', id, blob),
    failNextSave: () => store.failNextSave(),
    load: id => call('load', id), list: () => call('list'),
    save: (project, options) => call('save', project, options),
    switchAccount: id => store.switchAccount(id),
  };
}

// One session per mounted workspace. The server must independently authorize every write.
export function createAsyncSession({store, onChange = () => {}}) {
  let project = null, dirty = false, edit = 0, epoch = 0, pending = null, closed = false;
  let status = 'idle', error = null, switching = false, accountReady = true;
  let remoteEdit = null, remoteOrigin = null, acknowledged = null;
  const state = () => ({project: copy(project), dirty, status, error});
  const notify = () => onChange(state());
  async function save() {
    if (closed) return {status: 'closed'};
    if (pending) { await pending; return dirty && !error ? save() : {status}; }
    if (!project || !dirty) return {status: 'succeeded'};
    const retry=Boolean(store.pendingRecovery?.());
    if(retry&&(remoteEdit===null||typeof store.retryPending!=='function'))return {status:'blocked',reason:'unresolved_save'};
    const ticket = epoch, version = retry?remoteEdit:edit, draft = checkpointProject(project);
    const origin = retry ? remoteOrigin : {submitted: copy(draft), baseline: copy(acknowledged)};
    status = 'saving'; error = null; notify();
    const operation = (async () => {
      let result;
      try { result = retry?await store.retryPending():await store.save(draft, {expectedRevision: draft.revision}); }
      catch { result = {status: 'failed', userMessage: 'Save failed. Your draft is retained.'}; }
      if (closed || epoch !== ticket) return {status: 'superseded'};
      if(store.pendingRecovery?.()){if(remoteEdit===null){remoteEdit=version;remoteOrigin=origin}}else {remoteEdit=null;remoteOrigin=null;}
      if (result.status === 'succeeded') {
        if (edit === version) { project = copy(result.project); dirty = false; }
        else {
          // Rebase server-owned history while retaining all newer local edits.
          project.revision = result.project.revision;
          project.updatedAt = result.project.updatedAt;
          for (const [index, version] of (project.versions || []).entries()) {
            const saved = result.project.versions?.find(item => item.id === version.id);
            const submitted = origin?.submitted.versions?.find(item => item.id === version.id);
            const before = origin?.baseline?.versions?.find(item => item.id === version.id);
            // Only adopt a newly frozen snapshot tied to this submitted operation.
            // Preserve illegal/newer local mutations for explicit validation/recovery.
            if (saved && saved.state !== 'draft' && submitted && origin?.baseline &&
                (!before || before.state === 'draft') &&
                JSON.stringify(version) === JSON.stringify(submitted)) {
              project.versions[index] = copy(saved);
              continue;
            }
            // Existing immutable snapshots must remain byte-for-byte untouched.
            if (saved?.state === 'draft') {
              if (Object.hasOwn(saved, 'editHistory')) version.editHistory = copy(saved.editHistory);
              else delete version.editHistory;
            }
          }
          project = checkpointProject(project);
        }
        acknowledged = copy(result.project);
        status = dirty ? 'unsaved' : 'succeeded'; error = null;
      } else { status = result.status; error = result.userMessage || result.status; }
      notify(); return result;
    })();
    pending = operation;
    try { return await operation; } finally { if (pending === operation) pending = null; }
  }
  async function flush() {
    do { const result = await save(); if (result.status !== 'succeeded') return result; }
    while (dirty);
    return {status: 'succeeded'};
  }
  return {
    state,
    edit(mutator) {
      if (closed || switching || !project) throw Error('No open project');
      const next = copy(project); mutator(next);
      if (next.id !== project.id || next.accountId !== project.accountId || next.revision !== project.revision) throw Error('Identity and revision are immutable');
      project = next; edit++; dirty = true; error = null; status = 'unsaved'; notify();
    },
    save, flush,
    async open(id) {
      if (switching || !accountReady) return {status: 'blocked', reason: 'account_switch'};
      if (closed) return {status: 'closed'};
      if ((await flush()).status !== 'succeeded') return {status: 'blocked'};
      if (closed || switching) return {status: 'superseded'};
      const ticket = ++epoch, originalEdit = edit, account = store.accountId;
      let loaded;
      try { loaded = await store.load(id); }
      catch { return {status: 'failed', userMessage: 'Project could not be loaded.'}; }
      if (closed || switching || ticket !== epoch || account !== store.accountId) return {status: 'superseded'};
      if (edit !== originalEdit) return {status: 'blocked', reason: 'new_edits'};
      if (!loaded?.id || loaded.accountId !== store.accountId) return {status: 'unavailable'};
      acknowledged = copy(loaded); project = resumeProject(loaded); dirty = false; error = null; status = 'succeeded'; notify();
      return {status: 'opened'};
    },
    async reloadSaved() {
      if (closed || switching || pending || !project || store.pendingRecovery?.()) return {status:'blocked'};
      const recovery=copy(project),ticket=++epoch,version=edit,account=store.accountId;
      let loaded;
      try { loaded=await store.load(project.id); } catch { return {status:'failed',recovery}; }
      if(closed||switching||epoch!==ticket||edit!==version||account!==store.accountId)return {status:'superseded',recovery};
      if(!loaded?.id||loaded.accountId!==account)return {status:'unavailable',recovery};
      acknowledged=copy(loaded);project=resumeProject(loaded);dirty=false;error=null;status='succeeded';notify();return {status:'opened',recovery};
    },
    async leave() {
      if (switching || closed) return {status: closed ? 'closed' : 'blocked'};
      if ((await flush()).status !== 'succeeded') return {status: 'blocked'};
      epoch++; acknowledged = null; remoteOrigin = null; remoteEdit = null; project = null; notify(); return {status: 'left'};
    },
    // Voluntary account change is blocked until the current draft is saved/exported.
    async switchAccount(id) {
      if (closed) return {status: 'closed'};
      if (switching) return {status: 'blocked', reason: 'account_switch'};
      switching = true;
      // Freeze new UI work, but let the current account acknowledge its write.
      let ticket = epoch;
      try {
        if ((await flush()).status !== 'succeeded') return {status: 'blocked'};
        if (closed || ticket !== epoch) return {status: 'superseded'};
        // Only after durable flush invalidate outstanding reads and old scope.
        ticket = ++epoch;
        accountReady = false;
        acknowledged = null; remoteOrigin = null; remoteEdit = null; project = null; dirty = false; error = null; status = 'switching'; notify();
        const changed = await store.switchAccount(id);
        if (closed || ticket !== epoch) return {status: 'superseded'};
        if (store.accountId !== id || ['failed','blocked','superseded'].includes(changed?.status)) {
          status='failed'; error='Account change failed.'; notify(); return {status:'failed'};
        }
        if (closed || ticket !== epoch) return {status: 'superseded'};
        accountReady = true; status = 'idle'; notify(); return {status: 'switched'};
      } catch { if (closed || ticket !== epoch) return {status:'superseded'}; status = 'failed'; error = 'Account change failed.'; notify(); return {status: 'failed'}; }
      finally { switching = false; }
    },
    recovery() { return copy(project); },
    async dispose() {
      if (switching || closed) return {status: closed ? 'closed' : 'blocked'};
      if ((await flush()).status !== 'succeeded') return {status: 'blocked'};
      epoch++; closed = true; acknowledged = null; remoteOrigin = null; remoteEdit = null; project = null; return {status: 'closed'};
    },
    // Forced logout must clear visible account data; owner must retain/export returned recovery safely.
    invalidate() {
      const recovery = dirty ? copy(project) : null;
      epoch++; closed = true; acknowledged = null; remoteOrigin = null; remoteEdit = null; project = null; dirty = false; error = null; status = 'closed'; notify(); return recovery;
    },
  };
}
