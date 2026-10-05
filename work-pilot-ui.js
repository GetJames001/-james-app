/* Synthetic, memory-only pilot. No company or provider writes. */
(function () {
  'use strict';
  const ready = () => {
    const root = document.getElementById('workPilot');
    if (!root || !window.JamesWorkPilot) return;
    const engine = window.JamesWorkPilot;
    let store = engine.createStore(), pending = null, restoreCandidate = null, epoch = 0, signedOut = false;
    const q = id => document.getElementById(id);
    const node = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
    const status = text => { q('pilotStatus').textContent = text; };
    const error = e => status(e.message || 'Unable to load these test records.');
    function render() {
      q('pilotRecords').replaceChildren();
      store.records.forEach(record => {
        const a = node('article'); const d = record.data;
        a.append(node('h4', d.account_name), node('p', d.next_action));
        a.append(node('p', `${d.action_type} · ${d.status} · ${d.site_name || d.site_id}`));
        const meta = node('p', `Source: ${record.namespace} / ${record.sourceRecordId} · Revision ${record.revision}`);
        meta.className = 'pilot-record-meta'; a.append(meta);
        if (d.due_date) a.append(node('p', `Source due date: ${d.due_date} — verify before planning.`));
        if (d.contact_name) a.append(node('p', `Contact: ${d.contact_name} (${d.contact_status || 'unknown'})`));
        if (d.notes) a.append(node('p', d.notes));
        q('pilotRecords').append(a);
      });
      q('pilotExport').disabled = !store.records.length;
      q('pilotClear').disabled = !store.records.length && !pending && !restoreCandidate;
    }
    function discardPreviews() {
      pending = null; restoreCandidate = null;
      q('pilotPreview').replaceChildren(); q('pilotPreview').hidden = true;
      q('pilotRestorePreview').replaceChildren(); q('pilotRestorePreview').hidden = true;
    }
    function preview(text, namespace) {
      const candidate = engine.parseImport(text, namespace, store);
      discardPreviews(); pending = candidate;
      const view = q('pilotPreview'); view.hidden = false;
      view.append(node('h4', 'Review test import'));
      view.append(node('p', `${candidate.accepted.length} new · ${candidate.duplicates.length} duplicates · ${candidate.conflicts.length} conflicts · ${candidate.rejected.length} rejected`));
      candidate.accepted.forEach(row => {
        const detail = node('article');
        detail.append(node('h4', row.data.account_name), node('p', row.data.next_action), node('p', `Row ${row.rowNumber} · Source ID ${row.data.source_record_id} · Site ${row.data.site_id}`));
        detail.append(node('p', `Source status: ${row.data.status} · Due: ${row.data.due_date || 'unspecified'} · Contact verification: ${row.data.contact_status || 'unknown'}`));
        view.append(detail);
      });
      const list = node('ul');
      candidate.rejected.forEach(r => list.append(node('li', `Row ${r.rowNumber ?? '?'}: ${r.issues?.join('; ') || 'Invalid row'}`)));
      view.append(list);
      const decisions = {};
      candidate.conflicts.forEach(conflict => {
        const compare = node('article'); compare.append(node('h4', `Compare ${conflict.key}`));
        Object.keys(conflict.data).filter(key=>conflict.data[key]!==conflict.existingData[key]).forEach(key=>{
          compare.append(node('p', `${key}: existing ${conflict.existingData[key] || '(empty)'} → incoming ${conflict.data[key] || '(empty)'}`));
        }); view.append(compare);
        const label = node('label', `Record ${conflict.key}: incoming source fields differ`);
        const select = node('select'); select.setAttribute('aria-label', `Resolve ${conflict.key}`);
        for (const [v,t] of [['','Choose a resolution'],['keep','Keep existing source fields'],['replace','Replace source fields; retain history']]) { const option = node('option',t); option.value=v; select.append(option); }
        select.onchange = () => { decisions[conflict.key] = select.value; update(); }; label.append(select); view.append(label);
      });
      let extras;
      if (candidate.unknownColumns.length) {
        const label = node('label', `Ignore unrecognized columns: ${candidate.unknownColumns.join(', ')}`);
        extras = node('input'); extras.type='checkbox'; extras.onchange=()=>update(); label.append(extras);view.append(label);
      }
      const commit = node('button', 'Import reviewed test rows'); commit.id='pilotCommit'; commit.type='button';
      const update = () => { commit.disabled = candidate.conflicts.some(c=>!decisions[c.key]) || Boolean(extras && !extras.checked); };
      commit.onclick = () => {
        if (signedOut || pending !== candidate) return;
        try {
          store = engine.commitImport(store, candidate, {conflicts:decisions, acknowledgeUnknownColumns:!extras || extras.checked});
          discardPreviews(); render(); status(`Saved ${store.records.length} test records in memory. Export before refreshing.`);
        } catch(e) { error(e); }
      };
      view.append(commit); update();render();
    }
    q('pilotNamespace').addEventListener('input', () => { ++epoch; if(pending) {discardPreviews();status('Source changed. Select the file again to review it.');render();} });
    async function read(file, maximum, callback) {
      const operation=++epoch;
      discardPreviews();render();
      if (!file || signedOut) return;
      if (file.size>maximum) {status('This file exceeds the pilot size limit.');return;}
      try {const text=await file.text();if(operation===epoch && !signedOut) callback(text);}catch(e){if(operation===epoch && !signedOut)error(e);}
    }
    q('pilotCSV').onchange = e => {
      const namespace=q('pilotNamespace').value;
      read(e.target.files[0], 1024*1024, text=>preview(text,namespace));e.target.value='';
    };
    q('pilotFixture').onclick = async () => {
      const operation=++epoch;discardPreviews();render();status('Loading synthetic fixture…');
      const namespace=q('pilotNamespace').value;
      try {
        const response=await fetch('/assets/workday-pilot-synthetic.csv', {credentials:'same-origin',cache:'no-store'});
        if(!response.ok)throw new Error('Unable to load test fixture. Sign in again if your session expired.');
        const text=await response.text();
        if(operation===epoch && !signedOut){preview(text,namespace);status('Review the test rows before importing.');}
      }catch(e){if(operation===epoch && !signedOut)error(e);}
    };
    q('pilotRestore').onchange = e => {
      read(e.target.files[0], 4*1024*1024, text=>{
        restoreCandidate=engine.restore(text);
        const candidate=restoreCandidate,view=q('pilotRestorePreview');view.hidden=false;
        view.append(node('h4','Review backup replacement'),node('p', `Replace ${store.records.length} current test records with ${candidate.records.length} backup records. This replaces the entire pilot only.`));
        const button=node('button','Replace pilot with reviewed backup');button.id='pilotRestoreCommit';button.type='button';
        button.onclick=()=>{if(signedOut || restoreCandidate!==candidate)return;store=candidate;discardPreviews();render();status('Test backup restored in memory.');};view.append(button);render();
      });e.target.value='';
    };
    q('pilotExport').onclick=()=>{
      if(signedOut)return;
      const url=URL.createObjectURL(new Blob([engine.serialize(store)],{type:'application/json'}));
      const a=node('a');a.href=url;a.download='james-synthetic-pilot-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Backup download requested. Keep it before refreshing.');
    };
    q('pilotClear').onclick=()=>{if(confirm('Clear only the synthetic Work pilot? Export first if you want to keep these records.')){++epoch;store=engine.clear();discardPreviews();render();status('Synthetic pilot cleared.');}};
    const stop=()=>{signedOut=true;++epoch;store=engine.clear();discardPreviews();q('pilotRecords').replaceChildren();root.hidden=true;};
    q('logoutButton')?.addEventListener('click',stop,{capture:true});
    window.addEventListener('pagehide',stop);
    window.addEventListener('pageshow', e=>{if(e.persisted)window.location.reload();});
    window.JamesWorkPilotUI=Object.freeze({exportJSON:()=>engine.serialize(store)});
    render();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
