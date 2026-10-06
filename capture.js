(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.JamesCapture=api;})(typeof window==='undefined'?globalThis:window,function(){
'use strict';
const requests=new Set();let stopMounted=()=>{};
function localInstant(value){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Enter a complete date and time.');
 const parts=value.match(/\d+/g).map(Number),d=new Date(parts[0],parts[1]-1,parts[2],parts[3],parts[4]);
 const matches=x=>x.getFullYear()===parts[0]&&x.getMonth()===parts[1]-1&&x.getDate()===parts[2]&&x.getHours()===parts[3]&&x.getMinutes()===parts[4];
 if(!matches(d))throw new Error('That local time does not exist. Choose another time.');
 for(let offset=-180;offset<=180;offset+=15)if(offset!==0&&matches(new Date(+d+offset*60000)))throw new Error('That local time repeats during a clock change. Choose an unambiguous time.');
 return d.toISOString();
}
async function request(url,options={}){
 const controller=new AbortController();requests.add(controller);let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Connection timed out; retry the same save.'));},15000);});
 try{return await Promise.race([timeout,(async()=>{const response=await fetch(url,{...options,signal:controller.signal,credentials:'same-origin',cache:'no-store'});const body=await response.json();if(!response.ok){const error=new Error(response.status===409?'This record changed elsewhere. Refresh before editing again.':'James could not save or load this record.');error.status=response.status;throw error;}return body;})()]);}finally{clearTimeout(timer);requests.delete(controller);}
}
let renderCallbacks=container=>{container.textContent='Captured callbacks are not loaded yet.';};
function mount(){
 const form=document.querySelector('#captureForm');if(!form)return;
 const status=document.querySelector('#captureStatus'),list=document.querySelector('#captureList'),review=document.querySelector('#captureReview'),confirm=document.querySelector('#captureConfirm');
 let records=[],editing=null,pending=null,pendingAmbiguous=false,busy=false,hasData=false,loadFailed=false,active=true,loadVersion=0;
 const field=name=>form.elements.namedItem(name);
 const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
 renderCallbacks=container=>{container.replaceChildren();if(!hasData){container.append(text('p','Captured callbacks have not been verified. Open Capture and refresh.'));return;}if(loadFailed)container.append(text('p','Refresh failed; these callbacks may be stale.'));const callbacks=records.filter(r=>r.type==='callback'&&r.status==='open');if(!callbacks.length)container.append(text('p','No open captured callbacks. Add one in Capture.'));for(const record of callbacks){const row=document.createElement('article');row.append(text('b',record.title),text('p',`${record.domain} · ${record.dueDate || 'No due date'}`));if(record.contact)row.append(text('p',record.contact));container.append(row);}};
 function render(){
   if(!active)return;list.replaceChildren();const filtered=records.filter(r=>field('filter').value==='all'||r.domain===field('filter').value);
   if(!filtered.length)list.append(text('p','No captured records in this view.'));
   for(const record of filtered){const row=document.createElement('article');row.className='panel-item';row.append(text('b',record.title),text('span',`${record.domain==='work'?'Work':'Personal'} · ${record.type.replaceAll('_',' ')} · ${record.status}`));
    if(record.type==='appointment_draft')row.append(text('p',`${new Date(record.start).toLocaleString([],{timeZone:record.timeZone})} – ${new Date(record.end).toLocaleString([],{timeZone:record.timeZone})} · ${record.timeZone} · Not added to Google Calendar`));
    else if(record.dueDate)row.append(text('p',`Due ${record.dueDate}; not a timed calendar appointment`));
    if(record.contact)row.append(text('p',record.contact));if(record.notes)row.append(text('p',record.notes));
    const edit=text('button','Edit');edit.type='button';edit.onclick=()=>{if(busy||pending){status.textContent='Finish or discard the pending confirmation first.';return;}editing=record;for(const name of ['type','domain','title','notes','contact','dueDate','status'])field(name).value=record[name];for(const name of ['start','end']){const d=new Date(record[name]);field(name).value=record[name]?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`:'';}form.scrollIntoView({block:'start'});};row.append(edit);list.append(row);
   }
   const callbacks=records.filter(r=>r.type==='callback'&&r.status==='open');const count=document.querySelector('#captureCallbackCount');if(count)count.textContent=String(callbacks.length);
 }
 async function load(){if(!active)return;const version=++loadVersion;try{const data=await request('/api/capture');if(!active||version!==loadVersion)return;if(!Array.isArray(data.records))throw new Error('Invalid capture response');records=data.records;hasData=true;loadFailed=false;render();status.textContent='James records loaded. Calendar events remain separate.';}catch{if(active&&version===loadVersion){loadFailed=true;status.textContent=hasData?'Captured records could not be refreshed. Keeping the last received list; it may be stale.':'Captured records unavailable. No records have been verified.';}}}
 stopMounted=()=>{active=false;++loadVersion;records=[];pending=null;editing=null;hasData=false;list.replaceChildren();confirm.hidden=true;status.textContent='Capture session ended.';renderCallbacks=container=>{container.textContent='Capture session ended.';};};

 form.onsubmit=event=>{event.preventDefault();if(!active||busy||pending)return;try{
  const record={};for(const name of ['type','domain','title','notes','contact','dueDate','status'])record[name]=field(name).value.trim();record.start='';record.end='';record.timeZone='';
  if(record.type==='appointment_draft'){record.start=localInstant(field('start').value);record.end=localInstant(field('end').value);if(Date.parse(record.end)<=Date.parse(record.start)||Date.parse(record.end)-Date.parse(record.start)>7*86400000)throw new Error('End must follow start within seven days.');record.timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;}
  pending={operationId:crypto.randomUUID(),id:editing?editing.id:crypto.randomUUID(),expectedRevision:editing?editing.revision:0,record};
  review.textContent=`Confirm ${record.domain} ${record.type.replaceAll('_',' ')}: ${record.title}. ${record.type==='appointment_draft'?`${field('start').value} – ${field('end').value} (${record.timeZone}). Not added to Google Calendar.`:record.dueDate?`Due ${record.dueDate}.`:''} Status: ${record.status}. Contact: ${record.contact || 'None'}. Notes: ${record.notes || 'None'}.`;pendingAmbiguous=false;confirm.hidden=false;status.textContent='Review before saving. Back to editing discards this confirmation.';
 }catch(error){status.textContent=error.message;}};
 document.querySelector('#captureBack').onclick=()=>{if(busy)return;if(pendingAmbiguous){status.textContent='This save may already exist. Retry Save to verify it before discarding or creating another record.';return;}pending=null;confirm.hidden=true;status.textContent='You may edit and review again.';};
 document.querySelector('#captureSave').onclick=async()=>{if(!active||!pending||busy)return;++loadVersion;pendingAmbiguous=true;busy=true;document.querySelector('#captureSave').disabled=true;
  try{const data=await request('/api/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});if(!active)return;records=records.filter(r=>r.id!==data.record.id).concat(data.record);hasData=true;render();pending=null;pendingAmbiguous=false;editing=null;confirm.hidden=true;form.reset();render();await load();if(!active)return;status.textContent=loadFailed?'Saved in James, but the list refresh failed and may be stale. Nothing was added to Google Calendar.':'Saved in James. Nothing was sent or added to Google Calendar.';}
  catch(error){if(error.status===400||error.status===409)pendingAmbiguous=false;if(active)status.textContent=error.status===409?error.message+' Back to editing discards this confirmation.':error.message+' Retry Save to safely reuse this confirmation.';}
  finally{busy=false;if(active)document.querySelector('#captureSave').disabled=false;}
 };
 field('filter').onchange=render;document.querySelector('#captureRefresh').onclick=load;
 document.querySelector('#captureNew').onclick=()=>{if(busy||pending){status.textContent='Finish or discard the pending confirmation first.';return;}editing=null;form.reset();};
 document.querySelector('#captureTimezone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;
 load();
}
return {localInstant,mount,stop:()=>{stopMounted();for(const controller of requests)controller.abort();},renderCallbacks:container=>renderCallbacks(container)};
});
