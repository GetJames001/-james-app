'use strict';
const {createHash}=require('node:crypto');
const {validTrip}=require('../../travel.js');
const {parseAAConfirmation}=require('./aa-confirmation.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const clean=value=>typeof value==='string'&&value.trim().length<=500&&!/[\x00-\x1f<>]/.test(value)?value.trim():null;
// Deliberately conservative: no inferred dates, booking codes, destinations or
// extraction from quoted instructions. Ambiguous mail stays in mail review.
function extract(message){
 if(!message||message.reviewHandled||['Spam','Junk'].includes(message.sourceFolder))return null;
 const text=String(message.preview||'');
 if(text.length>1200||/\b(cancelled|canceled|pending|promo code|book now)\b/i.test(text))return null;
 if(!/\b(booking|reservation|itinerary)\s+(confirmed|confirmation|updated)\b/i.test(message.subject+' '+text))return null;
 const fields={};
 for(const line of text.split(/\r?\n/)){
  const match=/^(Provider|Booking reference|Trip start|Trip end|Destination|Hotel|Pickup):\s*(.+)$/i.exec(line.trim());
  if(match){const name=match[1].toLowerCase(),value=clean(match[2]);if(!value||Object.hasOwn(fields,name))return null;fields[name]=value;}
 }
 const provider=fields.provider?.toLowerCase(),reference=fields['booking reference']?.toUpperCase();
 if(!provider||!reference||!/^[-A-Z0-9]{4,40}$/.test(reference)||!fields['trip start']||!fields.destination)return null;
 const at=Date.parse(message.receivedDateTime);if(!Number.isFinite(at))return null;
 const values={start:fields['trip start'],destination:fields.destination};
 for(const [label,key] of [['trip end','end'],['hotel','hotel'],['pickup','pickup']])if(fields[label])values[key]=fields[label];
 const trip=render(values);if(!validTrip(trip))return null;
 return {id:hash(JSON.stringify(['mail-trip-v1',provider,reference])),at,values};
}
function render(values){return {title:values.title||values.destination+' trip',start:values.start,...(values.end?{end:values.end}:{}),stops:[values.destination,...(values.flights||[]),...(values.hotel?['Hotel: '+values.hotel]:[]),...(values.pickup?['Pickup: '+values.pickup]:[])]};}
function validateCandidate(candidate){
 if(!candidate||!/^[a-f0-9]{64}$/.test(candidate.id)||!Number.isSafeInteger(candidate.at)||candidate.at<0||!candidate.values||typeof candidate.values!=='object'||Array.isArray(candidate.values))throw Error('INVALID_MAIL_TRIP');
 for(const [key,value] of Object.entries(candidate.values)){
  if(!['start','end','destination','title','hotel','pickup','flights'].includes(key))throw Error('INVALID_MAIL_TRIP');
  if(key==='flights'){if(!Array.isArray(value)||value.length>10||value.some(v=>!clean(v)))throw Error('INVALID_MAIL_TRIP');}
  else if(!clean(value))throw Error('INVALID_MAIL_TRIP');
 }
 if(!candidate.values.destination||!validTrip(render(candidate.values)))throw Error('INVALID_MAIL_TRIP');
}
// Internal adapter contract: authenticatedSender is supplied by a provider reader,
// never extracted from forwarded body text. No HTTP endpoint accepts this object.
function fromVerifiedAA(message,allowedSenders){
 const sender=String(message?.authenticatedSender||'').trim().toLowerCase();
 if(!Array.isArray(allowedSenders)||!allowedSenders.length||!allowedSenders.map(s=>s.toLowerCase()).includes(sender)||message.sourceFolder==='Spam'||message.sourceFolder==='Junk')return null;
 const parsed=parseAAConfirmation(message.body);const at=Date.parse(message.receivedDateTime);
 if(!parsed||!Number.isFinite(at))return null;
 return {id:hash(JSON.stringify(['mail-trip-v1','aa',parsed.bookingReference])),at,values:{start:parsed.start,end:parsed.end,destination:parsed.destination,title:parsed.title,flights:parsed.segments.map(s=>s.date+' · '+s.flight+' · '+s.from+' '+s.departure+' → '+s.to+' '+s.arrival+' (local times)')}};
}
function merge(previous,candidate){
 validateCandidate(candidate);
 const fields={...(previous?.fields||{})};
 // Booking codes can be reused; changed itinerary identity requires review.
 for(const key of ['start','destination'])if(fields[key]&&fields[key].value!==candidate.values[key])throw Error('TRAVEL_IDENTITY_CONFLICT');
 for(const [key,value] of Object.entries(candidate.values)){
  const old=fields[key];
  // Equal-time conflicting copies never silently overwrite each other.
  if(!old||candidate.at>old.at)fields[key]={value,at:candidate.at};
 }
 const trip=render(Object.fromEntries(Object.entries(fields).map(([key,entry])=>[key,entry.value])));
 if(!validTrip(trip))throw Error('INVALID_MAIL_TRIP');
 return {fields,trip};
}
function candidates(snapshot){
 const result=[];
 for(const scan of snapshot?.state?.scans||[]){
  if(![['microsoft','personal-inbox-review'],['google','gmail-inbox-review']].some(source=>JSON.stringify(source)===JSON.stringify(scan.source)))continue;
  for(const event of (scan.pages||[]).flat()){const candidate=extract(event.mail);if(candidate)result.push(candidate);}
 }
 return result.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
}
module.exports={extract,render,merge,candidates,fromVerifiedAA,validateCandidate};
