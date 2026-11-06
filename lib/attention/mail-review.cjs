'use strict';
const {createHash}=require('node:crypto');
const {candidates}=require('../../mail-attention.js');
const {evaluateAttention}=require('./evaluator.cjs');
const SOURCE=['microsoft','personal-inbox-review'];
const same=scan=>JSON.stringify(scan.source)===JSON.stringify(SOURCE);
const policy={freshnessMs:3600000,unansweredAfterMs:86400000,dueSoonWithinMs:86400000,cooldownMs:86400000,quietHours:{enabled:true,timeZone:'America/Los_Angeles',startHour:22,endHour:8}};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function collectReview(previous,accountId,messages,at){
 if(!Array.isArray(messages)||messages.length>25)throw Error('INVALID_MAIL_PAGE');
 const events=new Map();
 for(const scan of previous?.state.scans||[])if(same(scan))for(const event of scan.pages.flat())events.set(event.id,event);
 for(const message of messages){
  if(typeof message?.id!=='string'||!message.id||message.id.length>2048)throw Error('INVALID_MAIL_MESSAGE');
  const mail={id:message.id,subject:String(message.subject||'(No subject)').slice(0,300),sender:String(message.sender||'Unknown sender').slice(0,200),preview:String(message.preview||'').slice(0,1200),receivedDateTime:typeof message.receivedDateTime==='string'?message.receivedDateTime.slice(0,60):null,importance:message.importance==='high'?'high':'normal',flagStatus:message.flagStatus==='flagged'?'flagged':'notFlagged'};
  const id=digest(mail);if(events.has(id))continue;
  events.set(id,{id,source:SOURCE,thread:digest(message.id),action:'Review email: '+mail.subject,kind:'draft',at,automated:null,extraction:{complete:true,confident:false},evidence:{reference:'microsoft-mail:'+message.id},mail});
 }
 if(events.size>300)throw Error('MAIL_REVIEW_CAPACITY');
 const revision=previous?.revision||0;
 // Preserve every observed message/version and every other source. Only obsolete
 // collector envelopes are compacted; no task or obligation is resolved here.
 const retained=(previous?.state.scans||[]).filter(scan=>!same(scan));
 const scan={id:'mail-review-'+(revision+1),source:SOURCE,at,sequence:revision+1,pages:[[...events.values()]],complete:true,extractionComplete:true,checkpoint:null};
 const selectedPolicy=previous?.policy||policy;
 const result=evaluateAttention({accountId,evaluatedAt:at,policy:selectedPolicy,scans:[scan],...(previous?{previousState:{...previous.state,scans:retained}}:{})});
 const coverage=[...(previous?.coverage||[]).filter(c=>c.collector!=='personal-inbox-review'),{collector:'personal-inbox-review',label:'Hotmail: latest returned Inbox page only (up to 25 messages). Headers/previews inventoried; semantic review incomplete. Gmail, older mail, Junk, Deleted and Sent not scanned. No background monitoring.',mailboxWide:false}];
 const provenance=[...(previous?.provenance||[]).filter(p=>p?.collector!=='personal-inbox-review'),{collector:'personal-inbox-review',at,retrieved:messages.length,inventory:events.size,semanticReviewComplete:false}];
 return {state:result.nextState,policy:selectedPolicy,coverage,provenance};
}
function projectReview(snapshot){
 const scans=(snapshot?.state?.scans||[]).filter(same);if(!scans.length)return null;
 const last=scans.at(-1),good=scans.filter(scan=>scan.complete===true&&scan.extractionComplete===true&&!scan.error).at(-1),latest=new Map();
 for(const scan of scans)for(const event of scan.pages.flat())if(event.mail){const old=latest.get(event.mail.id);if(!old||event.at>=old.at)latest.set(event.mail.id,event);}
 const messages=[...latest.values()].map(e=>e.mail);
 return {checkedAt:good?.at||null,stale:!!last.error,failedAt:last.error?last.at:null,scope:'latest_inbox_page',mailboxWide:false,semanticReviewComplete:false,inventoryCount:messages.length,items:candidates(messages)};
}
function collectFailure(previous,accountId,at){
 if(!previous)return null;
 const scan={id:'mail-review-failed-'+(previous.revision+1),source:SOURCE,at,sequence:previous.revision+1,pages:[[]],complete:false,extractionComplete:false,error:'MAIL_READ_FAILED',checkpoint:null};
 const state=evaluateAttention({accountId,previousState:{...previous.state,scans:previous.state.scans.filter(scan=>!same(scan)||!scan.error)},scans:[scan],policy:previous.policy,evaluatedAt:at}).nextState;
 return {state,policy:previous.policy,coverage:previous.coverage,provenance:previous.provenance};
}
module.exports={collectReview,projectReview,collectFailure};
