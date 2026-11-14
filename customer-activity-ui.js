/* Shared Customer Activity form. Production entry stays in Customer Information. */
(function(root){
'use strict';
function mount({navigate,initialMode='saved'}={}) {
 const $=id=>document.getElementById(id),overlay=$('customerActivityOverlay');
 if(!overlay)return;
 const openButton=$('customerActivityOpen'),closeButton=$('customerActivityClose'),save=$('customerDemoKeepDraft'),reload=$('customerReload'),add=$('customerAdd'),status=$('customerDraftStatus');
 const fields={contactId:$('activityContact'),nextKind:$('customerNextKind'),nextDetails:$('customerNextDetailsText'),nextWhen:$('customerNextWhen'),notes:$('customerDemoOutcome'),outcome:$('customerOutcomeKind'),when:$('customerOccurredAt')};
 const labels={met:'Met in person',attempted:'Attempted visit',not_available:'Contact unavailable',phone:'Phone contact',email:'Email contact',other:'Other'};
 let doc=null,selected=null,busy=false,uncertain=false,returnFocus=null,epoch=0;
 const drafts=new Map(),companyDrafts=new Map(),companyDirty=new Set();
 let pending=null,savingAll=false,remindersStale=false,reminderSignature='',reminderSessionExpired=false;
 let linkedSource=null,legacyBefore=null;
 let practiceMode=initialMode==='practice';
 let practiceDoc={schemaVersion:2,revision:0,activities:[],customers:[
  ['Silver Mesa Facilities','Alex Example','Jordan Example'],
  ['Desert Willow Hospitality','Taylor Example','Morgan Example'],
  ['Canyon Ridge Logistics','Casey Example','Riley Example'],
  ['Suncrest Property Services','Jamie Example','Drew Example'],
  ['Blue Horizon Manufacturing','Avery Example','Quinn Example']
 ].map(([name,first,second],i)=>({id:'practice-company-'+i,name,phone:'702-555-01'+String(i).padStart(2,'0'),address:'Fictional site '+(i+1)+' — example only',source:'practice',contacts:[first,second].map((name,j)=>({id:'practice-contact-'+i+'-'+j,name,phone:'702-555-01'+String(i*2+j+10).padStart(2,'0'),email:'contact'+j+'@example.com'}))}))};
 const uuid=()=>crypto.randomUUID();
 const announce=text=>{status.textContent=text;};
 function actionTarget(kind,company,person,details=''){
  const phone=person?.phone||company?.phone||'',email=person?.email?.trim()||'';
  if(kind==='Email'){const recipient=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:'';return 'mailto:'+encodeURIComponent(recipient)+'?subject='+encodeURIComponent(details||('Follow-up'+(company?.name?' — '+company.name:'')));}
  if(['Call','Text'].includes(kind)&&phone.replace(/[^0-9]/g,''))return (kind==='Call'?'tel:':'sms:')+phone.replace(/[^+0-9]/g,'');
  return '';
 }
 function updateNext(){
  const kind=fields.nextKind.value,active=!!kind&&kind!=='No follow-up needed';
  $('customerNextDetails').hidden=!active;
  const c=companyDrafts.get(selected)||doc?.customers.find(c=>c.id===selected),person=c?.contacts?.find(p=>p.id===fields.contactId.value),link=$('customerNextOpen');
  const target=actionTarget(kind,c,person,fields.nextDetails.value);
  link.hidden=!active||!target;link.textContent=kind==='Email'?'Open email draft':kind==='Text'?'Open text draft':'Open phone';
  if(target)link.href=target;else link.removeAttribute('href');
  $('customerNextOpenHelp').textContent=active&&kind==='Email'?(target.startsWith('mailto:?')?'Enter the recipient in the email draft.':'To: '+person.email):'';
 }
 function followUpText(a){return a.nextAction? a.nextAction==='No follow-up needed'?'No follow-up needed':(a.followUpCompletedAt?'Follow-up completed: ':'Pending: ')+a.nextAction+(a.nextActionDetails?' — '+a.nextActionDetails:'')+(a.nextActionAt?' · '+new Date(a.nextActionAt).toLocaleString():'')+(a.remindAt?' · Reminder moved to '+new Date(a.remindAt).toLocaleString():''):'';}
 const localDateValue=date=>new Date(+date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
 function renderReminders(){
  if(linkedSource)return;
  const items=(doc?.activities||[]).filter(a=>a.nextActionAt&&!a.followUpCompletedAt&&a.nextAction!=='No follow-up needed').sort((a,b)=>(a.remindAt||a.nextActionAt).localeCompare(b.remindAt||b.nextActionAt));
  const due=items.filter(a=>Date.parse(a.remindAt||a.nextActionAt)<=Date.now());
  $('customerReminders').hidden=practiceMode||(!items.length&&!remindersStale&&!uncertain);
  const signature=JSON.stringify([practiceMode,remindersStale,uncertain,busy,savingAll,items,doc?.customers,due.map(a=>a.id)]);
  if(signature===reminderSignature)return;reminderSignature=signature;
  const list=$('customerReminderList'),focused=document.activeElement?.dataset?.reminderControl;
  const editorState=new Map([...list.querySelectorAll('[data-follow-up-id]')].map(row=>[row.dataset.followUpId,{open:row.querySelector('details')?.open,value:row.querySelector('input')?.value}]));
  list.replaceChildren();
  $('customerReminderSummary').textContent=(practiceMode?'Practice follow-ups':'Customer follow-ups')+' · '+due.length+' due · '+(items.length-due.length)+' upcoming';
  $('customerReminderStatus').textContent=reminderSessionExpired?'Sign in again to load your follow-ups.':remindersStale?(doc?'Could not refresh follow-ups. Previously loaded reminders remain visible and may be out of date.':'Could not load follow-ups. No verified result is available.'):uncertain?'Follow-up status is not confirmed. Check again before repeating an update.':due.length?due.length+' follow-up'+(due.length===1?' is':'s are')+' due.':items.length?'Your saved follow-ups are listed below.':'No timed follow-ups saved in this view.';
  $('customerReminderRetry').hidden=!remindersStale&&!uncertain;
  const alert=reminderSessionExpired?'Sign in again to refresh customer reminders.':remindersStale?'Customer reminders could not refresh; check their status.':uncertain?'Customer follow-up update not confirmed.':due.length?(practiceMode?'Practice: ':'')+due.length+' customer follow-up'+(due.length===1?' is':'s are')+' due.':'';
  if($('customerReminderAlert').textContent!==alert)$('customerReminderAlert').textContent=alert;
  for(const a of items){
   const c=doc.customers.find(c=>c.id===a.customerId),person=c?.contacts?.find(p=>p.id===a.contactId),row=document.createElement('section'),title=document.createElement('h4'),detail=document.createElement('p'),actions=document.createElement('div');
   const isDue=Date.parse(a.remindAt||a.nextActionAt)<=Date.now();row.className='customer-reminder-item';row.dataset.followUpId=a.id;title.textContent=(isDue?'Due · ':'Upcoming · ')+(c?.name||'Company');detail.textContent=a.nextAction+' — '+a.nextActionDetails+' · '+new Date(a.remindAt||a.nextActionAt).toLocaleString();row.append(title,detail);actions.className='customer-actions';
   const target=actionTarget(a.nextAction,c,person,a.nextActionDetails);
   if(target){const link=document.createElement('a');link.href=target;link.textContent=a.nextAction==='Email'?'Open email draft':a.nextAction==='Text'?'Open text draft':'Open phone';actions.append(link);}
   const view=document.createElement('button');view.type='button';view.textContent='View company';view.dataset.reminderControl=a.id+'-view';view.disabled=busy||savingAll;view.onclick=()=>{remember();selected=a.customerId;returnFocus=view;overlay.hidden=false;render();closeButton.focus();};actions.append(view);row.append(actions);
   const edit=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Complete or reschedule';edit.append(summary);
   const complete=document.createElement('button');complete.type='button';complete.textContent='Confirm follow-up completed';complete.dataset.reminderControl=a.id+'-complete';complete.disabled=busy||savingAll||uncertain;complete.onclick=()=>commit({type:'update_followup',followUp:{id:a.id,operation:'complete',at:new Date().toISOString()}});edit.append(complete);
   const label=document.createElement('label'),input=document.createElement('input'),move=document.createElement('button');label.textContent='New reminder date and time';input.type='datetime-local';input.value=localDateValue(new Date(Date.now()+20*60000));input.dataset.reminderControl=a.id+'-time';label.append(input);edit.append(label);move.type='button';move.textContent='Save reminder time';move.disabled=busy||savingAll||uncertain;move.onclick=()=>{const date=new Date(input.value);if(!Number.isFinite(+date)||+date<=Date.now()){$('customerReminderStatus').textContent='Choose a future reminder date and time.';input.focus();return;}commit({type:'update_followup',followUp:{id:a.id,operation:'reschedule',at:date.toISOString()}});};edit.append(move);const prior=editorState.get(a.id);if(prior){edit.open=prior.open;input.value=prior.value;}row.append(edit);list.append(row);
  }
  if(focused)list.querySelector('[data-reminder-control="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
 }
 $('customerReminderRetry').onclick=()=>load();
 for(const button of $('customerQuickTimes').querySelectorAll('button'))button.onclick=()=>{if(button.dataset.custom){fields.nextWhen.focus();return;}fields.nextWhen.value=localDateValue(new Date(Date.now()+Number(button.dataset.minutes)*60000));remember();announce('Follow-up time selected.');};
 function remember(){
  if(!selected)return;
  drafts.set(selected,Object.fromEntries(Object.entries(fields).map(([k,el])=>[k,el.value])));
  // Read actual field values too: autofill/dictation need not emit an input event.
  const draft=companyDrafts.get(selected);
  if(draft){
   const changes={name:$('companyName').value,phone:$('companyPhone').value,address:$('companyAddress').value};
   let changed=Object.entries(changes).some(([k,v])=>v!==(draft[k]||''));
   Object.assign(draft,changes);
   [...$('companyContacts').querySelectorAll('fieldset')].forEach((row,i)=>{
    const person=draft.contacts[i];if(!person)return;
    [...row.querySelectorAll('input')].forEach((el,j)=>{const key=['name','phone','email'][j];if(el.value!==(person[key]||''))changed=true;person[key]=el.value;});
   });
   if(changed)companyDirty.add(selected);
  }
 }
 function controls(){const locked=busy||savingAll;$('customerModeSwitch').disabled=locked||uncertain||!!linkedSource;for(const el of $('companyEditor').querySelectorAll('input,button'))el.disabled=locked||uncertain||!selected||!!linkedSource;save.disabled=locked||uncertain||!doc||!selected;add.disabled=locked||uncertain||!doc||!!linkedSource;reload.disabled=locked||savingAll;reload.hidden=!uncertain;$('customerCloseSave').disabled=locked||uncertain;$('customerKeepEditing').disabled=locked;for(const b of $('customerDemoList').querySelectorAll('button'))b.disabled=locked;for(const el of Object.values(fields))el.disabled=locked||uncertain||!selected;$('customerNewName').disabled=locked||uncertain||!!linkedSource;for(const b of $('customerQuickTimes').querySelectorAll('button'))b.disabled=locked||uncertain;$('customerExitDraft').disabled=locked;renderReminders();}
 function companyDraft(c){
  if(!c)return null;
  if(!companyDrafts.has(c.id)||!companyDirty.has(c.id))companyDrafts.set(c.id,{...c,contacts:(c.contacts|| (c.contact?[{id:uuid(),name:c.contact,phone:c.phone||'',email:''}]:[])).map(person=>({...person}))});
  return companyDrafts.get(c.id);
 }
 function renderCompany(c){
  const draft=companyDraft(c);
  $('companyEditStatus').textContent=companyDirty.has(c?.id)?'Unsaved company details.':'';
  for(const [id,key] of [['companyName','name'],['companyPhone','phone'],['companyAddress','address']]){
   $(id).value=draft?.[key]||'';
   $(id).oninput=()=>{draft[key]=$(id).value;companyDirty.add(c.id);$('companyEditStatus').textContent='Unsaved company details.';updateNext();};
  }
  $('companyContacts').replaceChildren();
  for(const person of draft?.contacts||[]){
   const row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Contact';row.append(legend);
   for(const [key,title,max] of [['name','Name',150],['phone','Phone',80],['email','Email',254]]){
    const label=document.createElement('label'),input=document.createElement('input');label.textContent=title;input.value=person[key]||'';input.maxLength=max;input.type=key==='phone'?'tel':key==='email'?'email':'text';
    input.oninput=()=>{person[key]=input.value;companyDirty.add(c.id);$('companyEditStatus').textContent='Unsaved company details.';updateNext();};label.append(input);row.append(label);
   }
   $('companyContacts').append(row);
  }
 }
 $('companyAddContact').onclick=()=>{const c=doc?.customers.find(c=>c.id===selected);if(!c)return;const draft=companyDraft(c);if(draft.contacts.length>=50){announce('This company already has 50 contacts.');return;}companyDirty.add(c.id);draft.contacts.push({id:uuid(),name:'',phone:'',email:''});renderCompany(c);controls();$('companyContacts').lastElementChild?.querySelector('input')?.focus();};
 $('companySave').onclick=()=>{
  if(busy||savingAll||uncertain||!doc)return;
  remember();
  const draft=companyDrafts.get(selected);if(!draft)return;
  if(!draft.name.trim()||draft.contacts.some(c=>!c.name.trim())){announce('Enter a company name and a name for each contact before saving.');return;}
  const customer={...draft,name:draft.name.trim(),phone:draft.phone.trim(),address:draft.address.trim(),contacts:draft.contacts.map(c=>({...c,name:c.name.trim(),phone:c.phone.trim(),email:c.email.trim()}))};
  commit({type:'upsert_customer',customer});
 };
 function render(){
  $('customerModeNotice').textContent=linkedSource?(linkedSource.singleCompany?linkedSource.label:'Today’s customer list · '+linkedSource.label):practiceMode?'Practice template · Five fictional companies. Practice saves stay in this tab until reload; they do not change your saved customer records.':'Your saved companies · Record actual activity only.';
  $('customerNewCompanyControls').hidden=!!linkedSource;
  $('customerRecordActivity').hidden=!!linkedSource?.readOnly;
  const directions=$('customerDirections');
  const company=doc?.customers.find(c=>c.id===selected);
  const address=linkedSource?.directionsAddress||(!practiceMode&&company?.address?.split('\n').find(line=>line.trim()));
  directions.hidden=!address;
  if(directions.hidden)directions.removeAttribute('href');
  else directions.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(address);
  $('customerModeSwitch').textContent=practiceMode?'Show my saved companies':'Show five-company practice template';
  const list=$('customerDemoList');list.replaceChildren();
  for(const c of doc?.customers||[]){const b=document.createElement('button');b.type='button';b.textContent=c.name;b.setAttribute('aria-pressed',String(c.id===selected));b.disabled=busy;b.onclick=()=>{remember();selected=c.id;render();};list.append(b);}
  const c=doc?.customers.find(c=>c.id===selected);
  $('customerDemoName').textContent=c?.name||'Add or select a customer';
  const history=(doc?.activities||[]).filter(a=>a.customerId===selected).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
  $('customerDemoVisited').textContent=history.some(a=>a.outcome==='met')?'In-person meeting recorded':'No in-person meeting recorded';
  renderCompany(c);
  fields.contactId.replaceChildren(new Option('No specific contact',''));
  for(const person of c?.contacts||[])fields.contactId.add(new Option(person.name,person.id));
  $('customerDemoHistory').textContent=history.map(a=>`${new Date(a.occurredAt).toLocaleString()} · ${labels[a.outcome]}${a.contactName?' · '+a.contactName:''}: ${a.notes}${a.nextAction?' · '+followUpText(a):''}`).join('\n')||'No recorded contact.';
  const last=history[0];
  $('customerLastTitle').textContent='Last contact';
  $('customerLastSummary').textContent=last?`${new Date(last.occurredAt).toLocaleString()} · ${labels[last.outcome]}${last.contactName?' · '+last.contactName:''}\n${last.notes||'No notes recorded.'}${last.nextAction?'\n'+followUpText(last):''}`:'';
  $('customerLastSummary').hidden=!last;
  for(const [k,el] of Object.entries(fields))el.value=drafts.get(selected)?.[k]||'';
  updateNext();controls();
 }
 async function request(method,body){
  if(linkedSource)return linkedSource.request(method,body);
  if(practiceMode){
   if(method==='POST'){
    if(body.expectedRevision!==practiceDoc.revision)throw new Error('CONFLICT');
    const next=structuredClone(practiceDoc);
    if(body.type==='upsert_customer'){const i=next.customers.findIndex(c=>c.id===body.customer.id);if(i<0)next.customers.push(body.customer);else next.customers[i]=body.customer;}
    else if(body.type==='record_activity'){if(!next.activities.some(a=>a.id===body.activity.id))next.activities.push(body.activity);}
    else if(body.type==='update_followup'){const a=next.activities.find(a=>a.id===body.followUp.id);if(!a)throw new Error('UNAVAILABLE');Object.assign(a,body.followUp.operation==='complete'?{followUpCompletedAt:body.followUp.at}:{remindAt:body.followUp.at});}
    else throw new Error('UNAVAILABLE');
    next.revision++;practiceDoc=next;
   }
   return structuredClone(practiceDoc);
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const r=await fetch('/api/customer-activity',{method,credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal});
   const data=await r.json();
   if(r.status===401){const error=new Error('SESSION');throw error;}
   if(r.status===409)throw new Error('CONFLICT');
   if(!r.ok||data.ok!==true||!data.document||!Array.isArray(data.document.customers)||!Array.isArray(data.document.activities)||!Number.isSafeInteger(data.document.revision))throw new Error('UNAVAILABLE');
   return data.document;
  }finally{clearTimeout(timer);}
 }
 function clearPrivate(){doc=null;selected=null;pending=null;drafts.clear();companyDrafts.clear();companyDirty.clear();$('customerNewName').value='';for(const el of Object.values(fields))el.value='';render();}
 async function load(){
  remember();const ticket=++epoch;busy=true;controls();announce('Loading saved records…');
  try{const fresh=await request('GET');if(ticket!==epoch)return;doc=fresh;remindersStale=false;reminderSessionExpired=false;
   const confirmed=pending&&(pending.type==='update_followup'?doc.activities.some(a=>a.id===pending.followUp.id&&(pending.followUp.operation==='complete'?!!a.followUpCompletedAt:a.remindAt===pending.followUp.at)):pending.type==='record_activity'?doc.activities.some(a=>a.id===pending.activity.id):doc.customers.some(c=>c.id===pending.customer.id&&Object.entries(pending.customer).every(([key,value])=>JSON.stringify(c[key])===JSON.stringify(value))));
   if(confirmed){if(pending.type==='record_activity')drafts.delete(pending.activity.customerId);else if(pending.type==='upsert_customer'){companyDrafts.delete(pending.customer.id);companyDirty.delete(pending.customer.id);$('customerNewName').value='';}pending=null;}
   // If no matching ID is present, allow an explicit retry using this fresh revision.
   uncertain=false;selected=doc.customers.some(c=>c.id===selected)?selected:doc.customers[0]?.id||null;
   announce(confirmed?'Previous save confirmed.':'');
  }catch(error){if(ticket!==epoch)return;uncertain=true;remindersStale=true;if(error.message==='SESSION'){reminderSessionExpired=true;clearPrivate();announce('Session expired. Sign in again to load your records.');}else announce('Could not load records. Existing notes are retained; reload before saving.');}
  finally{if(ticket===epoch){busy=false;render();if(!overlay.hidden&&document.activeElement===document.body)reload.focus();}}
 }
 async function commit(command){
  if(busy||uncertain||!doc)return;
  busy=true;controls();if(!savingAll)remember();announce('Saving…');
  pending=command;
  try{doc=await request('POST',{...command,expectedRevision:doc.revision});
   if(command.type==='record_activity'){drafts.delete(command.activity.customerId);if(selected===command.activity.customerId)for(const el of Object.values(fields))el.value='';}
   else if(command.type==='upsert_customer'){if(!savingAll)selected=command.customer.id;companyDrafts.delete(command.customer.id);companyDirty.delete(command.customer.id);if($('customerNewName').value.trim()===command.customer.name)$('customerNewName').value='';$('companyEditor').open=true;}
   pending=null;remindersStale=false;announce(practiceMode?'Practice changes saved in this tab only.':'Saved.');
   return true;
  }catch(error){uncertain=true;
   if(error.message==='SESSION'){reminderSessionExpired=true;clearPrivate();announce('Session expired. Sign in again.');}
   else announce(error.message==='CONFLICT'?'Another update arrived. Your notes are retained. Check save status, review, then save again.':'Save not confirmed. Your notes are retained. Check save status before retrying.');
   return false;
  }finally{busy=false;render();if(command.type==='update_followup'&&overlay.hidden)$('customerReminderSummary').focus();}
 }
 function close(retain=true){if(retain)remember();$('customerClosePrompt').hidden=true;overlay.hidden=true;if(returnFocus?.isConnected)returnFocus.focus();}
 $('customerModeSwitch').onclick=()=>{
  if(busy||savingAll||uncertain)return;
  if(hasChanges()){announce('Save your changes before switching between practice and saved companies.');requestClose();return;}
  clearPrivate();reminderSessionExpired=false;practiceMode=!practiceMode;
  try{sessionStorage.setItem('jamesCustomerMode',practiceMode?'practice':'saved');}catch{}
  load();
 };
 openButton.onclick=()=>navigate?.('customer-database');
 window.jamesOpenLinkedCustomerActivity=async source=>{
  if(busy||savingAll||uncertain||hasChanges()){announce('Save or reconcile the current activity before changing lists.');overlay.hidden=false;return false;}
  if(linkedSource&&linkedSource.key!==source.key)releaseLinked();
  if(!linkedSource){legacyBefore={doc,selected,practiceMode};clearPrivate();linkedSource=source;practiceMode=false;}
  returnFocus=document.activeElement;overlay.hidden=false;closeButton.focus();await load();
  if(source.singleCompany)$('companyEditor').open=true;
  return !!doc&&!uncertain;
 };
 function releaseLinked(){
  if(!linkedSource)return;const previous=legacyBefore;linkedSource=null;legacyBefore=null;clearPrivate();if(previous){doc=previous.doc;selected=previous.selected;practiceMode=previous.practiceMode;}render();
 }
 window.jamesClearLinkedCustomerActivity=()=>{if(linkedSource){++epoch;linkedSource=null;legacyBefore=null;clearPrivate();overlay.hidden=true;}};
 window.addEventListener('james-conversation-ended',window.jamesClearLinkedCustomerActivity);
 window.addEventListener('pagehide',window.jamesClearLinkedCustomerActivity);
 $('customerViewHistory').onclick=event=>{event.preventDefault();const history=$('customerHistoryDetails');history.open=!history.open;if(history.open){$('customerDemoHistory').setAttribute('tabindex','-1');$('customerDemoHistory').focus();}};
 function hasActivity(d){return d&&Object.values(d).some(v=>v.trim());}
 function hasChanges(){remember();return companyDirty.size>0||[...drafts.values()].some(hasActivity)||$('customerNewName').value.trim()||pending;}
 function requestClose(){
  if(busy||savingAll)return;
  if(!hasChanges()){close();return;}
  $('customerClosePrompt').hidden=false;$('customerCloseSave').disabled=uncertain;$('customerCloseTitle').textContent=uncertain?'Check save status before closing':'Save changes before closing?';
  (uncertain?reload:$('customerCloseSave')).focus();
 }
 closeButton.onclick=requestClose;reload.onclick=load;
 $('customerExitDraft').onclick=()=>{if(busy||savingAll)return;close();$('customerSaveNotice').textContent=uncertain||pending?'Draft retained in this tab. Previous save is unconfirmed; check status when you return.':'Draft kept in this tab until reload. Not saved to customer history.';};
 $('customerKeepEditing').onclick=()=>{$('customerClosePrompt').hidden=true;closeButton.focus();};
 $('customerCloseSave').onclick=()=>saveAll();
 for(const el of Object.values(fields))el.addEventListener('input',()=>{remember();updateNext();announce('Unsaved activity.');});
 add.onclick=()=>{const name=$('customerNewName').value.trim();if(!name){announce('Enter a company name.');return;}const customer=pending?.type==='upsert_customer'&&pending.customer.name===name?pending.customer:{id:uuid(),name,source:'manual'};commit({type:'upsert_customer',customer});};
 async function saveAll(){
  if(busy||savingAll||uncertain||!doc)return;
  remember();const queue=[];
  // Validate every draft before writing any part of a multi-company save.
  for(const id of companyDirty){
   const draft=companyDrafts.get(id);
   if(!draft?.name.trim()||draft.contacts.some(c=>!c.name.trim())){announce('Enter a company name and a name for each contact before saving.');$('customerClosePrompt').hidden=true;selected=id;render();$('companyEditor').open=true;$('companyName').focus();return;}
   queue.push({type:'upsert_customer',customer:{...draft,name:draft.name.trim(),phone:draft.phone.trim(),address:draft.address.trim(),contacts:draft.contacts.map(c=>({...c,name:c.name.trim(),phone:c.phone.trim(),email:c.email.trim()}))}});
  }
  const newName=$('customerNewName').value.trim();
  if(newName)queue.push({type:'upsert_customer',customer:pending?.type==='upsert_customer'&&pending.customer.name===newName?pending.customer:{id:uuid(),name:newName,source:'manual'}});
  for(const [id,d] of drafts){
   if(!hasActivity(d))continue;
   const date=new Date(d.when);
   let message=!d.outcome||!d.when?'Choose what happened and when before saving. Your draft has not been saved.':!Number.isFinite(+date)||+date>Date.now()?'Enter a valid time that is not in the future.':d.outcome==='other'&&!d.notes.trim()?'Explain what happened in the notes.':'';
   if(!message&&!d.nextKind)message='Choose a next step or No follow-up needed before saving.';
   if(!message&&d.nextKind!=='No follow-up needed'&&(!d.nextDetails.trim()||!d.nextWhen||!Number.isFinite(+new Date(d.nextWhen))||+new Date(d.nextWhen)<=Date.now()))message='Describe your next step and choose a future date and time before saving.';
   if(message){$('customerClosePrompt').hidden=true;selected=id;render();announce(message);(!d.outcome?fields.outcome:!d.when?fields.when:!d.nextKind?fields.nextKind:d.nextKind!=='No follow-up needed'&&!d.nextDetails.trim()?fields.nextDetails:d.nextKind!=='No follow-up needed'?fields.nextWhen:fields.notes).focus();return;}
   const customer=queue.find(c=>c.type==='upsert_customer'&&c.customer.id===id)?.customer||doc.customers.find(c=>c.id===id);
   const person=customer?.contacts?.find(c=>c.id===d.contactId);
   queue.push({type:'record_activity',activity:{id:pending?.type==='record_activity'&&pending.activity.customerId===id?pending.activity.id:uuid(),customerId:id,...(person?{contactId:person.id,contactName:person.name}:{}),occurredAt:date.toISOString(),outcome:d.outcome,notes:d.notes,nextAction:d.nextKind,...(d.nextKind!=='No follow-up needed'?{nextActionDetails:d.nextDetails.trim(),nextActionAt:new Date(d.nextWhen).toISOString()}:{}),initiatedBy:'typed'}});
  }
  savingAll=true;save.disabled=true;closeButton.disabled=true;$('customerCloseSave').disabled=true;$('customerKeepEditing').disabled=true;
  try{
   for(const command of queue){if(!await commit(command))return;}
   announce(queue.length?'Changes saved.':'No changes to save.');$('customerSaveNotice').textContent=queue.length?(practiceMode?'Practice changes saved in this tab only.':'Customer changes saved.'):'';close(false);if(linkedSource){const done=linkedSource.onSaved;releaseLinked();done?.();}
  }finally{savingAll=false;closeButton.disabled=false;$('customerCloseSave').disabled=uncertain;$('customerKeepEditing').disabled=false;controls();}
 }
 save.onclick=saveAll;
 overlay.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();if(!$('customerClosePrompt').hidden){$('customerKeepEditing').click();}else requestClose();return;}
  if(event.key!=='Tab')return;
  const els=[...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')].filter(el=>el.getClientRects().length),first=els[0],last=els.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 });
 load();
 setInterval(()=>{if(document.visibilityState!=='visible')return;renderReminders();},10000);
 setInterval(()=>{if(document.visibilityState==='visible'&&overlay.hidden&&!$('customerReminders').contains(document.activeElement)&&!busy&&!savingAll&&!uncertain&&!hasChanges())load();},60000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&overlay.hidden&&!$('customerReminders').contains(document.activeElement)&&!busy&&!savingAll&&!uncertain&&!hasChanges())load();});
 return {open(){returnFocus=document.activeElement;overlay.hidden=false;closeButton.focus();void load();}};
}
root.JamesCustomerActivity={mount};
})(typeof window==='undefined'?globalThis:window);
