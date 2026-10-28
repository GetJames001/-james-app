// Promise-based service boundaries for the isolated asynchronous screen.
import {WorkbenchError,makeId,sha256Bytes,createProject,selectVersion,approveVersion,reviseVersion,restoreVersion,checkpointProject,applyDisposition} from './core.js';
const clone=value=>value==null?value:structuredClone(value);
const iso=()=>new Date().toISOString();
const ensure=(condition,code,message)=>{if(!condition)throw new WorkbenchError(code,message)};
const stableJSON=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function encodeBytes(bytes) {
  let result = '';
  for (let start = 0; start < bytes.length; start += 8192) result += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(result);
}
function decodeBytes(base64) { return Uint8Array.from(atob(base64), char => char.charCodeAt(0)); }
export function createAsyncAssetManager({ store, cryptoProvider = globalThis.crypto, maxBytes = 2 * 1024 * 1024 } = {}) {
  ensure(store, 'needs_input', 'A project store is required.');
  const scope=()=>{const id=store.accountId,generation=store.accountGeneration;return ()=>id===store.accountId&&generation===store.accountGeneration};
  const superseded=()=>({status:'superseded'});
  return {
    async import(file, { projectId, expectedRevision, origin = 'upload', sourceRefs = [] } = {}) {
      const accountId = store.accountId, accountGeneration = store.accountGeneration, current=scope();
      try {
        const project = await store.load(projectId);
        if(!current()||project?.status==='superseded')return superseded();
        ensure(project, 'not_found', 'Project not found.');
        ensure(file && typeof file.arrayBuffer === 'function', 'needs_input', 'Choose a local file.');
        ensure(file.size <= maxBytes, 'file_too_large', `Demo imports are limited to ${Math.round(maxBytes / 1024 / 1024)} MB per file.`);
        ensure(['upload', 'reference', 'generated'].includes(origin), 'needs_input', 'Choose a supported source kind.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if(!current())return superseded();
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
        await store.writeBlob(hash, { sha256: hash, byteSize: bytes.length, base64: encodeBytes(bytes), mediaType });
        if (store.accountId !== accountId || store.accountGeneration !== accountGeneration) return {status:'superseded'};
        const saved = await store.save(next, { expectedRevision: expectedRevision ?? project.revision });
        if(!current())return superseded();
        return { ...saved, ...(saved.status === 'succeeded' ? { asset: clone(asset), importRecord, duplicate: Boolean(existing) } : {}) };
      } catch (error) { if(!current())return superseded();return { status: 'failed', errorCode: error.code || 'import_failed', userMessage: error instanceof WorkbenchError ? error.message : 'The source could not be imported. Original files have not changed.' }; }
    },
    async getPreview(assetId, { projectId } = {}) {
      const current=scope();
      const projects = projectId ? [await store.load(projectId)].filter(Boolean) : await store.list();
      if(!current()||!Array.isArray(projects)||projects.some(p=>p?.status==='superseded'))return superseded();
      const asset = projects.flatMap(project => project.assets || []).find(item => item.id === assetId);
      if (!asset) return { status: 'unavailable', userMessage: 'Source not found in this demo account.' };
      if (asset.previewRef) return { status: 'succeeded', previewRef: asset.previewRef };
      const blob = asset.sha256 ? await store.readBlob(asset.sha256) : null;
      if(!current()||blob?.status==='superseded')return superseded();
      if (!blob || typeof blob.base64!=='string' || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.mediaType)) return { status: 'unavailable', userMessage: 'No safe image preview is available. The original source can still be exported.' };
      return { status: 'succeeded', previewRef: `data:${blob.mediaType};base64,${blob.base64}` };
    },
    async export(assetId, format = 'original', { projectId } = {}) {
      const current=scope();
      if (format !== 'original') return { status: 'unavailable', userMessage: 'This demo exports original source bytes only.' };
      const projects = projectId ? [await store.load(projectId)].filter(Boolean) : await store.list();
      if(!current()||!Array.isArray(projects)||projects.some(p=>p?.status==='superseded'))return superseded();
      const asset = projects.flatMap(project => project.assets || []).find(item => item.id === assetId);
      const blob = asset?.sha256 ? await store.readBlob(asset.sha256) : null;
      if(!current()||blob?.status==='superseded')return superseded();
      if (!blob || typeof blob.base64!=='string') return { status: 'unavailable', userMessage: 'Original bytes are unavailable for this fixture.' };
      return { status: 'succeeded', bytes: decodeBytes(blob.base64), mediaType: blob.mediaType, filename: asset.originalName };
    },
  };
}
export function createAsyncCommandAdapter({ store, handlers = {}, conversationId = 'demo-conversation', onFocus = () => {}, onSpeak = () => {}, stopVoice = () => {} } = {}) {
  ensure(store, 'needs_input', 'A project store is required.');
  let generation = 0, accountEpoch = 0, projectId = null, ended = false, switching = false;
  const calls = new Map(), pending = new Set();
  const context = () => ({ accountId: store.accountId, conversationId, projectId, navigationGeneration: generation, ended });
  const invalidate = () => { generation += 1; for (const controller of pending) controller.abort(); };
  const result = (command, status, userMessage, extra = {}) => ({ callId: command.callId, status, projectRevision: null, artifactVersionId: null, reviewRequired: false, userMessage, ...extra });
  const adapter = {
    getContext: context,
    navigate(id) { invalidate(); projectId = id || null; return generation; },
    end() { ended = true; invalidate(); stopVoice(); return context(); },
    resume() { ended = false; invalidate(); return context(); },
    async switchAccount(accountId) {
      if(switching)return {status:'blocked',reason:'account_switch'};
      switching=true;invalidate();accountEpoch+=1;ended=true;projectId=null;calls.clear();
      const ticket=accountEpoch,navigation=generation;
      try{stopVoice();const changed=await store.switchAccount(accountId);if(store.accountId!==accountId||['failed','blocked','superseded'].includes(changed?.status))return {status:'failed'};if(ticket!==accountEpoch||generation!==navigation)return {status:'superseded'};ended=false;return context()}
      finally{switching=false}
    },
    execute(command) {
      if (!command || typeof command.callId !== 'string' || !command.callId.trim()) return Promise.resolve(result(command || {}, 'needs_input', 'A stable call ID is required.'));
      const callKey = `${accountEpoch}:${store.accountGeneration}:${store.accountId}:${command.conversationId}:${command.callId}`;
      const fingerprint = stableJSON(command);
      const prior = calls.get(callKey);
      if (prior) return prior.fingerprint === fingerprint ? prior.promise : Promise.resolve(result(command, 'conflict', 'That call ID was already used for a different command.'));
      if(switching){
        if(!command||typeof command.callId!=='string'||!command.callId.trim())return Promise.resolve(result(command||{},'needs_input','A stable call ID is required.'));
        if(command.conversationId!==conversationId)return Promise.resolve(result(command,'conflict','This command belongs to another conversation.'));
        if(command.action==='end'&&command.navigationGeneration===generation){
          const promise=Promise.resolve(result(command,'succeeded','Session ended. Pending results will not speak or change the workspace.'));
          calls.set(callKey,{fingerprint,promise});adapter.end();return promise;
        }
        return Promise.resolve(result(command,'superseded','Account change is in progress.'));
      }
      const epoch = accountEpoch, accountId = store.accountId, storeEpoch = store.accountGeneration, navigation = generation;
      const controller = new AbortController(); pending.add(controller);
      const current = () => !switching && !ended && epoch === accountEpoch && storeEpoch === store.accountGeneration && accountId === store.accountId && generation === navigation && !controller.signal.aborted;
      const promise = Promise.resolve().then(async () => {
        if (command.conversationId !== conversationId) return result(command, 'conflict', 'This command belongs to another conversation.');
        if (!current()) return result(command, 'superseded', 'This command is no longer current.');
        if (command.navigationGeneration !== generation) return result(command, 'superseded', 'The workspace changed before this command ran.');
        if (command.action === 'end') { adapter.end(); return result(command, 'succeeded', 'Session ended. Pending results will not speak or change the workspace.'); }
        const args = command.arguments || {};
        let loaded = command.projectId ? await store.load(command.projectId) : null;
        if (!current()) return result(command, 'superseded', 'The workspace changed.');
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
            const save = await store.save(checkpointProject(saved), { expectedRevision: command.action === 'create_project' ? 0 : command.expectedRevision });
            if (save.status !== 'succeeded') return result(command, save.status, save.userMessage, { projectRevision: save.projectRevision ?? null });
            saved = save.project;
          }
        }
        if (!current()) return result(command, 'superseded', 'The workspace changed after the write.');
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
