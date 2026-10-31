'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {customer,activity}=require('../customer-activity/records.cjs');
const FIELDS=['company_name','company_source_id','contact_name','contact_source_id','source_record_id','company_phone','contact_phone','email','website','address','city','state','postal_code','country','industry','status','tags','notes','next_action','next_due'];
const COMPANY_FIELDS=['name','phone','website','industry','status','tags'];
const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const normal=value=>String(value||'').trim().normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
const plain=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
function fail(code){throw Object.assign(new Error(code),{code});}
function text(value,max=500){if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail('INVALID_TEXT');return value.trim();}
function id(value){if(typeof value!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(value))fail('INVALID_ID');return value;}
function empty(){return {version:1,revision:0,companies:[],batches:[],operations:[]};}
function validate(doc){
 if(!plain(doc)||doc.version!==1||!Number.isSafeInteger(doc.revision)||doc.revision<0||!Array.isArray(doc.companies)||!Array.isArray(doc.batches)||!Array.isArray(doc.operations)||doc.companies.length>5000||doc.batches.length>25||doc.operations.length>1000)fail('INVALID_DATABASE');
 if(Buffer.byteLength(JSON.stringify(doc))>6*1024*1024)fail('DATABASE_CAPACITY');
 const companyIds=new Set(),batchIds=new Set();
 for(const c of doc.companies){customer(c);if(companyIds.has(c.id)||!Number.isSafeInteger(c.revision)||c.revision<1||!Array.isArray(c.locations)||!Array.isArray(c.history)||!Array.isArray(c.activities)||!Array.isArray(c.notes)||!Array.isArray(c.sources)||!plain(c.provenance))fail('INVALID_COMPANY');companyIds.add(c.id);for(const a of c.activities)if(activity(a).customerId!==c.id)fail('INVALID_ACTIVITY_REFERENCE');}
 for(const b of doc.batches){id(b.id);if(batchIds.has(b.id)||!['staged','committed','reversed'].includes(b.status)||!plain(b.file)||hash(Buffer.from(b.file.base64,'base64'))!==b.file.sha256)fail('INVALID_BATCH');batchIds.add(b.id);}
 if(doc.dailyLists!==undefined){
  if(!Array.isArray(doc.dailyLists)||doc.dailyLists.length>100)fail('INVALID_DAILY_LIST');
  const days=new Set();for(const l of doc.dailyLists){if(!plain(l)||!/^\d{4}-\d{2}-\d{2}$/.test(l.date)||!Number.isFinite(Date.parse(l.date+'T00:00:00.000Z'))||new Date(l.date+'T00:00:00.000Z').toISOString().slice(0,10)!==l.date||days.has(l.date)||!Array.isArray(l.items)||l.items.length>10)fail('INVALID_DAILY_LIST');days.add(l.date);const ids=new Set();for(const i of l.items){if(!plain(i)||!companyIds.has(i.companyId)||ids.has(i.companyId)||!['pending','recorded'].includes(i.status)||typeof i.selectedAt!=='string'||!Number.isFinite(Date.parse(i.selectedAt)))fail('INVALID_DAILY_LIST');ids.add(i.companyId);}}
 }
 return doc;
}
function identityKey(owner,workspace){if(typeof owner!=='string'||!owner.trim()||owner.length>320)fail('INVALID_OWNER');return 'james:customer-database:v1:'+hash([owner.trim().toLowerCase(),id(workspace)]);}
function registryKey(owner){if(typeof owner!=='string'||!owner.trim()||owner.length>320)fail('INVALID_OWNER');return 'james:customer-database:workspaces:v1:'+hash(owner.trim().toLowerCase());}
function source(input){if(!plain(input))fail('SOURCE_PERMISSION_REQUIRED');return {namespace:id(input.namespace),label:text(input.label,120),permittedUse:text(input.permittedUse,1000),restrictions:text(input.restrictions,1000)};}
function stage(doc,{file,source:inputSource,operationId},now){
 id(operationId);const fingerprint=hash({file:file.sha256,source:inputSource}),old=doc.operations.find(x=>x.id===operationId);
 if(old){if(old.fingerprint!==fingerprint||old.kind!=='stage')fail('OPERATION_ID_REUSED');return {document:doc,receipt:old.receipt,replayed:true};}
 const permission=source(inputSource);if(!permission.permittedUse||!permission.label)fail('SOURCE_PERMISSION_REQUIRED');
 const batch={id:randomUUID(),status:'staged',file:clone(file),source:permission,stagedAt:now};
 const next=clone(doc);next.revision++;next.batches.push(batch);const receipt={batchId:batch.id,status:'staged'};next.operations.push({id:operationId,kind:'stage',fingerprint,receipt});validate(next);return {document:next,receipt};
}
function mapping(input,headers){
 if(!plain(input)||!Object.hasOwn(input,'company_name')||!Number.isInteger(input.company_name))fail('COMPANY_MAPPING_REQUIRED');
 const values=Object.values(input);if(Object.keys(input).some(k=>!FIELDS.includes(k))||values.some(v=>!Number.isInteger(v)||v<0||v>=headers.length)||new Set(values).size!==values.length)fail('INVALID_MAPPING');return input;
}
function rowData(cells,map){return Object.fromEntries(FIELDS.map(k=>[k,map[k]===undefined?'':cells[map[k]].trim()]));}
function sourceMatch(c,s,r){return c.sources.some(x=>x.namespace===s.namespace&&(r.company_source_id&&x.companyId===r.company_source_id||r.source_record_id&&x.recordId===r.source_record_id));}
const locationKey=r=>hash([r.address,r.city,r.state,r.postal_code,r.country].map(normal));
function candidates(companies,s,r){
 const stable=companies.filter(c=>sourceMatch(c,s,r));if(stable.length||r.company_source_id||r.source_record_id)return stable;
 return companies.filter(c=>normal(c.name)===normal(r.company_name)&&(c.locations.some(l=>locationKey(l)===locationKey(r))||!c.locations.length&&![r.address,r.city,r.state,r.postal_code,r.country].some(Boolean)));
}
function incoming(r){
 return {name:text(r.company_name,180),phone:text(r.company_phone,80),website:text(r.website,500),industry:text(r.industry,150),status:text(r.status,80),tags:r.tags.split(/[;,]/).map(x=>x.trim()).filter(Boolean).slice(0,30)};
}
function contactMatches(c,s,r){return c.contacts.filter(p=>r.contact_source_id?p.source===s.namespace&&p.sourceId===r.contact_source_id:r.email&&normal(p.email)===normal(r.email)||r.contact_name&&normal(p.name)===normal(r.contact_name));}
function conflicting(c,inc,r,s){
 const diffs=[];for(const key of COMPANY_FIELDS)if((Array.isArray(inc[key])?inc[key].length:inc[key])&&c[key]&&JSON.stringify(c[key])!==JSON.stringify(inc[key]))diffs.push({field:key,existing:c[key],incoming:inc[key]});
 const contact=contactMatches(c,s,r)[0];
 if(contact)for(const [key,value] of Object.entries({name:r.contact_name,phone:r.contact_phone,email:r.email}))if(value&&contact[key]&&normal(value)!==normal(contact[key]))diffs.push({field:'contact.'+key,existing:contact[key],incoming:value});return diffs;
}
function plan(doc,batchId,map,decisions={}){
 const batch=doc.batches.find(x=>x.id===batchId);if(!batch)fail('BATCH_NOT_FOUND');if(batch.status!=='staged')fail('BATCH_ALREADY_COMMITTED');mapping(map,batch.file.headers);
 if(!plain(decisions)||Object.keys(decisions).some(k=>! /^\d+$/.test(k)||Number(k)<2||Number(k)>batch.file.rows.length+1))fail('INVALID_DECISIONS');
 const next=clone(doc),review=[],changes=[],counts={rows:batch.file.rows.length,created:0,updated:0,skipped:0,held:0,failed:0};
 for(let index=0;index<batch.file.rows.length;index++){
  const row=index+2,r=rowData(batch.file.rows[index],map),choice=decisions[row]||'review';if(!['review','skip','keep','update','hold'].includes(choice))fail('INVALID_DECISION');
  let item={row,state:'held',issues:[],conflicts:[]};
  if(choice==='skip'){item.state='skipped';review.push(item);counts.skipped++;continue;}
  let inc;try{inc=incoming(r);if(!inc.name)item.issues.push('Company name is required.');if(r.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))item.issues.push('Email is not valid.');if((r.contact_phone||r.email||r.contact_source_id)&&!r.contact_name)item.issues.push('Contact name is required.');if(r.next_due&&!/^\d{4}-\d{2}-\d{2}$/.test(r.next_due))item.issues.push('Next due date must be YYYY-MM-DD.');if(r.contact_name)text(r.contact_name,150);text(r.email,254);text(r.contact_phone,80);text(r.notes,2000);}catch{item.issues.push('A field exceeds its allowed length or format.');}
  if(item.issues.length||choice==='hold'){counts.held++;review.push(item);continue;}
  const matches=candidates(next.companies,batch.source,r);item.matches=matches.map(x=>({id:x.id,name:x.name}));
  if(matches.length>1){item.issues.push('Multiple company matches; held for identity review.');counts.held++;review.push(item);continue;}
  let c=matches[0];
  if(c&&r.company_source_id&&c.sources.some(s=>s.namespace===batch.source.namespace&&s.companyId&&s.companyId!==r.company_source_id)&&!c.sources.some(s=>s.namespace===batch.source.namespace&&s.companyId===r.company_source_id)){item.issues.push('Stable source company IDs disagree; identity review required.');counts.held++;review.push(item);continue;}
  // A same-name company with different location is a possible duplicate, not an automatic new company.
  if(!c&&next.companies.some(x=>normal(x.name)===normal(inc.name))){item.issues.push('Possible company duplicate at another location; held for review.');counts.held++;review.push(item);continue;}
  if(c&&r.contact_source_id&&!c.contacts.some(p=>p.source===batch.source.namespace&&p.sourceId===r.contact_source_id)&&c.contacts.some(p=>r.email&&normal(p.email)===normal(r.email)||r.contact_name&&normal(p.name)===normal(r.contact_name))){item.issues.push('Stable source contact ID does not match the existing contact; identity review required.');counts.held++;review.push(item);continue;}
  if(c&&contactMatches(c,batch.source,r).length>1){item.issues.push('Multiple contact identities match; held for identity review.');counts.held++;review.push(item);continue;}
  item.conflicts=c?conflicting(c,inc,r,batch.source):[];
  if(item.conflicts.length&&!['keep','update'].includes(choice)){counts.held++;review.push(item);continue;}
  if(choice==='keep'){item.state='skipped';counts.skipped++;review.push(item);continue;}
  const before=c?clone(c):null;
  if(!c){c={...customer({id:hash([batchId,row,'company']).slice(0,32),name:inc.name,contacts:[],source:'customer-database'}),website:'',industry:'',status:'',tags:[],revision:0,locations:[],sources:[],provenance:{},notes:[],activities:[],nextActions:[],history:[]};next.companies.push(c);}
  for(const key of COMPANY_FIELDS)if(Array.isArray(inc[key])?inc[key].length:inc[key]){c[key]=inc[key];c.provenance[key]={batchId,source:batch.source.namespace,row,importedAt:batch.stagedAt,verification:'imported_unverified'};}
  const loc={address:r.address,city:r.city,state:r.state,postal_code:r.postal_code,country:r.country};
  if(Object.values(loc).some(Boolean)&&!c.locations.some(l=>locationKey(l)===locationKey(loc)))c.locations.push({...loc,id:randomUUID(),batchId,verification:'imported_unverified'});
  if(r.contact_name){let p=contactMatches(c,batch.source,r)[0];if(!p){p={id:randomUUID(),name:r.contact_name,phone:'',email:'',source:batch.source.namespace,sourceId:r.contact_source_id};c.contacts.push(p);}p.provenance=p.provenance||{};for(const [k,v] of Object.entries({name:r.contact_name,phone:r.contact_phone,email:r.email}))if(v){p[k]=v;p.provenance[k]={batchId,row,importedAt:batch.stagedAt,source:batch.source.namespace,verification:'imported_unverified'};}p.batchId=batchId;p.verification='imported_unverified';}
  const ref={namespace:batch.source.namespace,companyId:r.company_source_id,recordId:r.source_record_id,contactId:r.contact_source_id};if(!c.sources.some(x=>JSON.stringify(x)===JSON.stringify(ref)))c.sources.push(ref);
  if(r.notes&&!c.notes.some(n=>n.text===r.notes&&n.source===batch.source.namespace))c.notes.push({id:randomUUID(),text:r.notes,source:batch.source.namespace,batchId,row,verification:'imported_unverified'});
  if(r.next_action&&!c.nextActions.some(n=>n.text===r.next_action&&n.due===r.next_due))c.nextActions.push({id:randomUUID(),text:r.next_action,due:r.next_due,batchId,status:'suggested',verification:'imported_unverified'});
  // Compare business data, excluding provenance refreshed by an identical repeat.
  const signature=x=>{const y=clone(x);delete y.history;delete y.revision;delete y.provenance;for(const p of y.contacts){delete p.batchId;delete p.provenance;}return hash(y);};
  if(before&&signature(before)===signature(c)){Object.assign(c,before);item.state='skipped';counts.skipped++;review.push(item);continue;}
  c.revision++;c.history.push({kind:'import',batchId,row,at:batch.stagedAt});changes.push({companyId:c.id,before,after:clone(c)});item.state=before?'updated':'created';item.companyId=c.id;counts[item.state]++;review.push(item);
 }
 return {document:next,review,counts,changes};
}
function confirm(doc,{batchId,map,decisions,operationId,reviewHash},now){
 id(operationId);const fingerprint=hash({batchId,map,decisions,reviewHash}),old=doc.operations.find(x=>x.id===operationId);
 if(old){if(old.kind!=='confirm'||old.fingerprint!==fingerprint)fail('OPERATION_ID_REUSED');return {document:doc,receipt:old.receipt,replayed:true};}
 const proposed=plan(doc,batchId,map,decisions);if(hash({revision:doc.revision,batchId,map,decisions,review:proposed.review.map(x=>({...x,companyId:undefined})),counts:proposed.counts})!==reviewHash)fail('REVIEW_CHANGED');
 const next=proposed.document,batch=next.batches.find(x=>x.id===batchId);batch.status='committed';batch.committedAt=now;batch.mapping=clone(map);batch.decisions=clone(decisions);batch.counts=proposed.counts;batch.changes=proposed.changes;
 next.revision++;const receipt={batchId,status:'committed',counts:proposed.counts};next.operations.push({id:operationId,kind:'confirm',fingerprint,receipt});validate(next);return {document:next,receipt};
}
function preview(doc,{batchId,map,decisions={}}){const result=plan(doc,batchId,map,decisions);return {revision:doc.revision,batchId,review:result.review,counts:result.counts,reviewHash:hash({revision:doc.revision,batchId,map,decisions,review:result.review.map(x=>({...x,companyId:undefined})),counts:result.counts})};}
function reverse(doc,{batchId,operationId},now){
 id(operationId);const fingerprint=hash({batchId}),old=doc.operations.find(x=>x.id===operationId);if(old){if(old.kind!=='reverse'||old.fingerprint!==fingerprint)fail('OPERATION_ID_REUSED');return {document:doc,receipt:old.receipt,replayed:true};}
 const batch=doc.batches.find(b=>b.id===batchId);if(!batch||batch.status!=='committed')fail('BATCH_NOT_REVERSIBLE');
 const next=clone(doc),counts={reversed:0,held:0};
 // Reverse in row order backwards. Any later edit/activity/provenance change holds
 // the entire company rather than erasing later work; no whole-document rollback.
 const grouped=new Map();for(const change of batch.changes){if(!grouped.has(change.companyId))grouped.set(change.companyId,{before:change.before,after:change.after});else grouped.get(change.companyId).after=change.after;}
 for(const [companyId,change] of grouped){const i=next.companies.findIndex(c=>c.id===companyId);if(i<0||next.dailyLists?.some(l=>l.items.some(x=>x.companyId===companyId))||hash(next.companies[i])!==hash(change.after)){counts.held++;continue;}if(change.before)next.companies[i]=clone(change.before);else next.companies.splice(i,1);counts.reversed++;}
 const b=next.batches.find(b=>b.id===batchId);b.status='reversed';b.reversedAt=now;b.reversalCounts=counts;next.revision++;const receipt={batchId,status:'reversed',counts};next.operations.push({id:operationId,kind:'reverse',fingerprint,receipt});validate(next);return {document:next,receipt};
}
function search(doc,filters={}){
 if(!plain(filters)||Object.keys(filters).some(k=>!['query','company','person','location','industry','status','source','tags'].includes(k)))fail('INVALID_FILTER');
 const contains=(values,q)=>values.some(x=>normal(x).includes(normal(text(q,200))));
 return doc.companies.filter(c=>Object.entries(filters).every(([k,q])=>!q||contains(k==='company'?[c.name]:k==='person'?c.contacts.map(p=>p.name):k==='location'?c.locations.flatMap(l=>Object.values(l)):k==='source'?c.sources.map(s=>s.namespace):k==='tags'?c.tags:k==='query'?[c.name,c.industry,c.status,...c.tags,...c.contacts.flatMap(p=>[p.name,p.email,p.phone]),...c.locations.flatMap(l=>[l.address,l.city,l.state,l.postal_code,l.country])]:[c[k]],q)));
}
function exportRows(companies){
 const rows=[];for(const c of companies)for(const p of c.contacts.length?c.contacts:[{}])for(const l of c.locations.length?c.locations:[{}]){
  if(rows.length>=10000)fail('EXPORT_LIMIT');
  rows.push([c.id,c.name,p.id||'',p.name||'',p.phone||'',p.email||'',l.address||'',l.city||'',l.state||'',l.postal_code||'',l.country||'',c.industry,c.status,c.tags.join('; '),c.sources.map(s=>s.namespace+':'+s.companyId+':'+s.recordId).join('; '),'imported_unverified',c.notes.map(n=>n.text).join('\n'),JSON.stringify(c.activities),JSON.stringify(c.nextActions)]);
 }return rows;
}
module.exports={FIELDS,hash,clone,text,id,normal,empty,validate,identityKey,registryKey,stage,preview,confirm,reverse,search,exportRows};
