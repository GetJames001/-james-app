'use strict';
// Daily lists reference the canonical company; they never copy customer records.
const m=require('./model.cjs'),legacy=require('../customer-activity/records.cjs');
function fail(code){throw Object.assign(Error(code),{code});}
function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00.000Z'))||new Date(value+'T00:00:00.000Z').toISOString().slice(0,10)!==value)fail('INVALID_DAY');return value;}
function transact(doc,kind,body,now,change){
 m.id(body.operationId);const {expectedRevision,...content}=body;const fingerprint=m.hash({kind,...content}),old=doc.operations.find(o=>o.id===body.operationId);
 if(old){if(old.kind!==kind||old.fingerprint!==fingerprint)fail('OPERATION_ID_REUSED');return {document:doc,receipt:old.receipt,replayed:true};}
 const next=m.clone(doc),receipt=change(next);next.revision++;next.operations.push({id:body.operationId,kind,fingerprint,receipt});m.validate(next);return {document:next,receipt};
}
function select(doc,body,now){return transact(doc,'select_daily',body,now,next=>{
 day(body.date);if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>10||new Set(body.ids).size!==body.ids.length)fail('INVALID_SELECTION');
 for(const id of body.ids){m.id(id);if(!next.companies.some(c=>c.id===id))fail('SELECTION_NOT_FOUND');}
 next.dailyLists=next.dailyLists||[];let list=next.dailyLists.find(l=>l.date===body.date);if(!list){list={date:body.date,items:[]};next.dailyLists.push(list);}
 const added=[];for(const id of body.ids)if(!list.items.some(i=>i.companyId===id)){list.items.push({companyId:id,selectedAt:now,status:'pending'});added.push(id);}
 if(list.items.length>10)fail('DAILY_LIMIT');return {date:body.date,added,selected:body.ids,status:'saved'};
});}
function view(doc,date){day(date);const list=doc.dailyLists?.find(l=>l.date===date);return {date,items:(list?.items||[]).map(i=>({...i,company:doc.companies.find(c=>c.id===i.companyId)}))};}
function projection(doc,date){const list=view(doc,date);return {schemaVersion:2,revision:doc.revision,customers:list.items.map(({company:c})=>({...legacy.customer(c),address:c.locations.map(l=>[l.address,l.city,l.state,l.postal_code,l.country].filter(Boolean).join(', ')).join('\n')})),activities:list.items.flatMap(i=>i.company.activities)};}
function record(doc,body,now){return transact(doc,'record_activity',body,now,next=>{
 day(body.date);const a=legacy.activity(body.activity),c=next.companies.find(c=>c.id===a.customerId);
 if(!c||!next.dailyLists?.some(l=>l.date===body.date&&l.items.some(i=>i.companyId===c.id)))fail('SELECTION_NOT_FOUND');
 if(Date.parse(a.occurredAt)>Date.parse(now))fail('INVALID_TIMESTAMP');
 if(a.contactId){const person=c.contacts.find(p=>p.id===a.contactId);if(!person||person.name!==a.contactName)fail('INVALID_CONTACT_REFERENCE');}
 const previous=next.companies.flatMap(c=>c.activities).find(x=>x.id===a.id);if(previous)fail('ACTIVITY_ID_EXISTS');
 c.activities.push(a);c.revision++;c.history.push({kind:'reported_activity',activityId:a.id,at:now});
 const item=next.dailyLists.find(l=>l.date===body.date).items.find(i=>i.companyId===c.id);item.status='recorded';
 return {activityId:a.id,companyId:c.id,status:'saved'};
});}
module.exports={day,select,view,projection,record};
