"use strict";
const crypto=require("node:crypto");
const MAX_CUSTOMERS=5000,MAX_ACTIVITIES=20000,MAX_DOC_BYTES=2*1024*1024;
const allowedOutcomes=new Set(["met","not_available","phone","email","attempted","other"]);
function string(value,max,label,{required=false}={}){
 if(typeof value!=="string"||value.length>max|| (required&&!value.trim()))throw new Error("INVALID_"+label);
 return value.trim();
}
function plainObject(x){return !!x&&typeof x==="object"&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
function validDate(x){return typeof x==="string"&&x.length===24&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;}
function contact(input){
 if(!plainObject(input))throw new Error('INVALID_CONTACT');
 return {id:string(input.id,100,'CONTACT_ID',{required:true}),name:string(input.name,150,'CONTACT_NAME',{required:true}),phone:string(input.phone||'',80,'CONTACT_PHONE'),email:string(input.email||'',254,'CONTACT_EMAIL')};
}
function customer(input){
 if(!plainObject(input))throw new Error("INVALID_CUSTOMER");
 const id=string(input.id,100,"ID",{required:true});
 if(input.contacts!==undefined&&(!Array.isArray(input.contacts)||input.contacts.length>50))throw new Error('INVALID_CONTACTS');
 const contacts=input.contacts?.map(contact);
 if(contacts&&new Set(contacts.map(c=>c.id)).size!==contacts.length)throw new Error('DUPLICATE_CONTACT');
 return {...(contacts?{contacts}:{}),id,name:string(input.name,180,"NAME",{required:true}),contact:string(input.contact||"",150,"CONTACT"),
  phone:string(input.phone||"",80,"PHONE"),address:string(input.address||"",400,"ADDRESS"),
  source:string(input.source||"manual",60,"SOURCE"),sourceRef:string(input.sourceRef||"",120,"SOURCE_REF")};
}
function activity(input){
 if(!plainObject(input))throw new Error("INVALID_ACTIVITY");
 const outcome=string(input.outcome,30,"OUTCOME",{required:true});
 if(!allowedOutcomes.has(outcome))throw new Error("INVALID_OUTCOME");
 if(input.nextActionDue && (!/^\d{4}-\d{2}-\d{2}$/.test(input.nextActionDue)||!validDate(input.nextActionDue+'T00:00:00.000Z')))throw new Error('INVALID_NEXT_DUE');
 if(input.nextActionAt!==undefined&&!validDate(input.nextActionAt))throw new Error('INVALID_NEXT_TIMESTAMP');
 if(input.followUpCompletedAt!==undefined&&!validDate(input.followUpCompletedAt))throw new Error('INVALID_FOLLOWUP_COMPLETION');
 if(input.remindAt!==undefined&&!validDate(input.remindAt))throw new Error('INVALID_REMINDER_TIME');
 if(!validDate(input.occurredAt))throw new Error("INVALID_TIMESTAMP");
 return {
  id:string(input.id,100,"ID",{required:true}),customerId:string(input.customerId,100,"CUSTOMER_ID",{required:true}),
  occurredAt:input.occurredAt,outcome,
  ...(input.contactId?{contactId:string(input.contactId,100,'CONTACT_ID',{required:true}),contactName:string(input.contactName,150,'CONTACT_NAME',{required:true})}:{}),
  notes:string(input.notes||"",2000,"NOTES"),
  ...(input.nextActionAt?{nextActionAt:input.nextActionAt,nextActionDetails:string(input.nextActionDetails,250,'NEXT_DETAILS',{required:true})}:{}),
  ...(input.followUpCompletedAt!==undefined?{followUpCompletedAt:input.followUpCompletedAt}:{}),
  ...(input.remindAt!==undefined?{remindAt:input.remindAt}:{}),
  nextAction:string(input.nextAction||"",250,"NEXT_ACTION"),
  nextActionDue:input.nextActionDue==null?"":string(input.nextActionDue,10,"NEXT_DUE"),
  initiatedBy:input.initiatedBy==="voice"?"voice":"typed"
 };
}
function validateSnapshot(doc){
 if(!plainObject(doc)||![1,2].includes(doc.schemaVersion)||!Number.isSafeInteger(doc.revision)||doc.revision<0||!Array.isArray(doc.customers)||!Array.isArray(doc.activities))throw new Error("INVALID_SNAPSHOT");
 if(doc.customers.length>MAX_CUSTOMERS||doc.activities.length>MAX_ACTIVITIES)throw new Error("CAPACITY_EXCEEDED");
 const customers=doc.customers.map(customer),ids=new Set(customers.map(c=>c.id));
 if(ids.size!==customers.length)throw new Error("DUPLICATE_CUSTOMER");
 const activities=doc.activities.map(activity),aid=new Set();
 for(const a of activities){
  if(aid.has(a.id)||!ids.has(a.customerId))throw new Error("INVALID_ACTIVITY_REFERENCE");
  aid.add(a.id);
 }
 const clean={schemaVersion:doc.schemaVersion,revision:doc.revision,customers,activities};
 if(Buffer.byteLength(JSON.stringify(clean))>MAX_DOC_BYTES)throw new Error("SNAPSHOT_TOO_LARGE");
 return clean;
}
const empty=()=>({schemaVersion:1,revision:0,customers:[],activities:[]});
function evolve(original,command){
 const doc=validateSnapshot(original);
 if(!plainObject(command)||!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0)throw new Error("INVALID_COMMAND");
 if(doc.revision!==command.expectedRevision)return {conflict:true,document:doc};
 let next;
 if(command.type==="upsert_customer"){
  const c=customer(command.customer);
  const list=doc.customers.slice(),idx=list.findIndex(x=>x.id===c.id);
  if(idx>=0)list[idx]=c;else list.push(c);
  next={...doc,customers:list};
 }else if(command.type==="record_activity"){
  const a=activity(command.activity);
  if(a.contactId){const person=doc.customers.find(c=>c.id===a.customerId)?.contacts?.find(c=>c.id===a.contactId);if(!person)throw new Error('CONTACT_NOT_FOUND');a.contactName=person.name;}
  if(!doc.customers.some(c=>c.id===a.customerId))throw new Error("CUSTOMER_NOT_FOUND");
  if(doc.activities.some(x=>x.id===a.id))throw new Error("DUPLICATE_ACTIVITY");
  next={...doc,activities:[...doc.activities,a]};
 }else if(command.type==='update_followup'){
  const update=command.followUp;
  if(!plainObject(update)||!['complete','reschedule'].includes(update.operation)||!validDate(update.at))throw new Error('INVALID_FOLLOWUP_UPDATE');
  const existing=doc.activities.find(a=>a.id===update.id);
  if(!existing?.nextActionAt||existing.nextAction==='No follow-up needed')throw new Error('FOLLOWUP_NOT_FOUND');
  if(update.operation==='reschedule'&&existing.followUpCompletedAt)throw new Error('FOLLOWUP_ALREADY_COMPLETED');
  if(update.operation==='complete'&&existing.followUpCompletedAt)return {conflict:false,document:doc};
  const changes=update.operation==='complete'?{followUpCompletedAt:update.at}:{remindAt:update.at};
  next={...doc,activities:doc.activities.map(a=>a.id===update.id?{...a,...changes}:a)};
 }else throw new Error("INVALID_COMMAND");
 next.schemaVersion=2;
 next.revision++;
 return {conflict:false,document:validateSnapshot(next)};
}
function scopedKey(identity){
 if(typeof identity!=="string"||identity.length>320||!identity.trim())throw new Error("INVALID_IDENTITY");
 return "james:customer-activity:v1:"+crypto.createHash("sha256").update(identity.trim().toLowerCase()).digest("hex");
}
function makeStore({read,compareAndSwap}){
 if(typeof read!=="function"||typeof compareAndSwap!=="function")throw new Error("INVALID_ADAPTER");
 return {
  async load(identity){
   const raw=await read(scopedKey(identity));
   return raw===null?empty():validateSnapshot(JSON.parse(raw));
  },
  async commit(identity,command){
   const key=scopedKey(identity),raw=await read(key),prev=raw===null?empty():validateSnapshot(JSON.parse(raw));
   const result=evolve(prev,command);
   if(result.conflict)return {ok:false,conflict:true,revision:prev.revision};
   const nextRaw=JSON.stringify(result.document);
   const success=await compareAndSwap(key,raw,nextRaw);
   if(!success)return {ok:false,conflict:true,revision:null};
   return {ok:true,conflict:false,document:result.document};
  }
 };
}
module.exports={empty,customer,activity,validateSnapshot,evolve,scopedKey,makeStore,MAX_CUSTOMERS,MAX_ACTIVITIES};
