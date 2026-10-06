const TYPES=['callback','next_action','appointment_draft'];
const FIELDS=['type','domain','title','notes','contact','dueDate','start','end','timeZone','status'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value){return value && typeof value==='object' && !Array.isArray(value);}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value;}
function instant(value){return typeof value==='string'&&date(value.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));}
function validateRecord(record){
  if(!object(record)||Object.keys(record).some(key=>!FIELDS.includes(key)))throw new Error('INVALID_RECORD');
  const r={};for(const field of FIELDS)r[field]=record[field]===undefined?'':record[field];
  if(!TYPES.includes(r.type)||!['work','personal'].includes(r.domain)||!['open','completed'].includes(r.status))throw new Error('INVALID_RECORD');
  for(const [field,max]of [['title',200],['notes',2000],['contact',200]]){
    if(typeof r[field]!=='string'||r[field].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(r[field]))throw new Error('INVALID_RECORD');r[field]=r[field].trim();
  }
  if(!r.title || (r.dueDate!==''&&!date(r.dueDate)))throw new Error('INVALID_RECORD');
  if(r.type==='appointment_draft'){
    if(!instant(r.start)||!instant(r.end)||Date.parse(r.end)<=Date.parse(r.start)||Date.parse(r.end)-Date.parse(r.start)>7*86400000||typeof r.timeZone!=='string'||r.timeZone.length>100)throw new Error('INVALID_RECORD');
    try{new Intl.DateTimeFormat('en',{timeZone:r.timeZone});}catch{throw new Error('INVALID_RECORD');}
    r.start=new Date(r.start).toISOString();r.end=new Date(r.end).toISOString();
  }else if(r.start!==''||r.end!==''||r.timeZone!=='')throw new Error('INVALID_RECORD');
  return r;
}
function validateMutation(body){
  if(!object(body)||Object.keys(body).sort().join(',')!=='expectedRevision,id,operationId,record'||typeof body.id!=='string'||typeof body.operationId!=='string'||!UUID.test(body.id)||!UUID.test(body.operationId)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>1000000)throw new Error('INVALID_RECORD');
  return {operationId:body.operationId,id:body.id,expectedRevision:body.expectedRevision,record:validateRecord(body.record)};
}
function validateStored(value){
  if(!object(value)||Object.keys(value).sort().join(',')!==['id','revision','createdAt','updatedAt',...FIELDS].sort().join(',')||typeof value.id!=='string'||!UUID.test(value.id)||!Number.isSafeInteger(value.revision)||value.revision<1||!instant(value.createdAt)||!instant(value.updatedAt))throw new Error('INVALID_STORE');
  const fields={};for(const field of FIELDS)fields[field]=value[field];return {...validateRecord(fields),id:value.id,revision:value.revision,createdAt:value.createdAt,updatedAt:value.updatedAt};
}
module.exports={validateRecord,validateMutation,validateStored,UUID};
