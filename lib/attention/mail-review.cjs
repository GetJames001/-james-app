'use strict';
const {createHash}=require('node:crypto');
const {candidates}=require('../../mail-attention.js');
const {evaluateAttention}=require('./evaluator.cjs');
const SOURCE=['microsoft','personal-inbox-review'];
const sourceFor=provider=>{if(!['microsoft','gmail'].includes(provider))throw Error('INVALID_MAIL_SOURCE');return provider==='gmail'?['google','gmail-inbox-review']:SOURCE;};
const same=(scan,source=SOURCE)=>JSON.stringify(scan.source)===JSON.stringify(source);
const policy={freshnessMs:3600000,unansweredAfterMs:86400000,dueSoonWithinMs:86400000,cooldownMs:86400000,quietHours:{enabled:true,timeZone:'America/Los_Angeles',startHour:22,endHour:8}};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function collectReview(previous,accountId,messages,at,provider='microsoft'){
 const source=sourceFor(provider),collector=source[1],prefix=provider==='gmail'?'gmail-review-':'mail-review-';
 if(!Array.isArray(messages)||messages.length>25)throw Error('INVALID_MAIL_PAGE');
 const events=new Map();
 for(const scan of previous?.state.scans||[])if(same(scan,source))for(const event of scan.pages.flat())events.set(event.id,event);
 for(const message of messages){
  if(typeof message?.id!=='string'||!message.id||message.id.length>2048)throw Error('INVALID_MAIL_MESSAGE');
  const mail={id:message.id,subject:String(message.subject||'(No subject)').slice(0,300),sender:String(message.sender||'Unknown sender').slice(0,200),preview:String(message.preview||'').slice(0,1200),receivedDateTime:typeof message.receivedDateTime==='string'?message.receivedDateTime.slice(0,60):null,importance:message.importance==='high'?'high':'normal',flagStatus:message.flagStatus==='flagged'?'flagged':'notFlagged'};
  const id=digest(mail);if(events.has(id))continue;
  events.set(id,{id,source,thread:digest(message.id),action:'Review email: '+mail.subject,kind:'draft',at,automated:null,extraction:{complete:true,confident:false},evidence:{reference:provider+'-mail:'+message.id},mail});
 }
 if(events.size>300)throw Error('MAIL_REVIEW_CAPACITY');
 const revision=previous?.revision||0;
 // Preserve every observed message/version and every other source. Only obsolete
 // collector envelopes are compacted; no task or obligation is resolved here.
 const retained=(previous?.state.scans||[]).filter(scan=>!same(scan,source));
 const scan={id:prefix+(revision+1),source,at,sequence:revision+1,pages:[[...events.values()]],complete:true,extractionComplete:true,checkpoint:null};
 const selectedPolicy=previous?.policy||policy;
 const result=evaluateAttention({accountId,evaluatedAt:at,policy:selectedPolicy,scans:[scan],...(previous?{previousState:{...previous.state,scans:retained}}:{})});
 const coverage=[...(previous?.coverage||[]).filter(c=>c.collector!==collector),{collector,label:provider==='gmail'?'Gmail: latest returned Inbox page only (up to 25 messages). Headers/previews inventoried; semantic review incomplete. Older mail, Spam, Trash and Sent not scanned. No background monitoring.':'Hotmail: latest returned Inbox page only (up to 25 messages). Headers/previews inventoried; semantic review incomplete. Gmail is separately checked only when connected; older mail, Junk, Deleted and Sent not scanned. No background monitoring.',mailboxWide:false}];
 const provenance=[...(previous?.provenance||[]).filter(p=>p?.collector!==collector),{collector,at,retrieved:messages.length,inventory:events.size,semanticReviewComplete:false}];
 return {state:result.nextState,policy:selectedPolicy,coverage,provenance};
}
function projectSource(snapshot,provider){
 const source=sourceFor(provider);
 const scans=(snapshot?.state?.scans||[]).filter(scan=>same(scan,source));if(!scans.length)return null;
 const last=scans.at(-1),good=scans.filter(scan=>scan.complete===true&&scan.extractionComplete===true&&!scan.error).at(-1),latest=new Map();
 for(const scan of scans)for(const event of scan.pages.flat())if(event.mail){const old=latest.get(event.mail.id);if(!old||event.at>=old.at)latest.set(event.mail.id,event);}
 const messages=[...latest.values()].map(e=>e.mail);
 return {checkedAt:good?.at||null,stale:!!last.error,failedAt:last.error?last.at:null,scope:'latest_inbox_page',mailboxWide:false,semanticReviewComplete:false,inventoryCount:messages.length,items:candidates(messages).map(item=>({...item,reviewKey:latest.get(item.id).id}))};
}
function projectReview(snapshot){
 const hotmail=projectSource(snapshot,'microsoft'),gmail=projectSource(snapshot,'gmail');
 if(!hotmail&&!gmail)return null;
 const sources={hotmail:hotmail?{checkedAt:hotmail.checkedAt,stale:hotmail.stale}:null,gmail:gmail?{checkedAt:gmail.checkedAt,stale:gmail.stale}:null};
 const decisions=readDecisions(snapshot),all=[...(hotmail?.items||[]),...(gmail?.items||[])];
 return {...(hotmail||gmail),handledItems:all.filter(item=>decisions.has(item.reviewKey)),checkedAt:[hotmail?.checkedAt,gmail?.checkedAt].filter(Boolean).sort()[0]||null,stale:!!(hotmail?.stale||gmail?.stale),inventoryCount:(hotmail?.inventoryCount||0)+(gmail?.inventoryCount||0),items:all.filter(item=>!decisions.has(item.reviewKey)),sources};
}
const DECISIONS='mail-review-decisions';
function readDecisions(snapshot){
 const entries=(snapshot?.provenance||[]).filter(p=>p?.collector===DECISIONS);
 if(entries.length>1)throw Error('INVALID_REVIEW_DECISIONS');
 const decisions=entries.length?entries[0].handled:[];
 if(!Array.isArray(decisions)||decisions.length>600||decisions.some(key=>typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))||new Set(decisions).size!==decisions.length)throw Error('INVALID_REVIEW_DECISIONS');
 return new Set(decisions);
}
function decideReview(snapshot,reviewKey,action,at){
 if(!snapshot||!['handled','undo'].includes(action)||typeof reviewKey!=='string'||!/^[a-f0-9]{64}$/.test(reviewKey))throw Error('INVALID_REVIEW_DECISION');
 const current=projectReview(snapshot);
 if(![...(current?.items||[]),...(current?.handledItems||[])].some(item=>item.reviewKey===reviewKey))throw Object.assign(Error('REVIEW_CHANGED_RETRY'),{code:'REVIEW_CHANGED_RETRY'});
 const handled=readDecisions(snapshot);if(action==='handled')handled.add(reviewKey);else handled.delete(reviewKey);
 if(handled.size>600)throw Error('MAIL_REVIEW_CAPACITY');
 return {state:snapshot.state,policy:snapshot.policy,coverage:snapshot.coverage,provenance:[...snapshot.provenance.filter(p=>p?.collector!==DECISIONS),{collector:DECISIONS,at,handled:[...handled]}]};
}
function collectFailure(previous,accountId,at,provider='microsoft'){
 const source=sourceFor(provider);
 if(!previous)return null;
 const scan={id:provider+'-review-failed-'+(previous.revision+1),source,at,sequence:previous.revision+1,pages:[[]],complete:false,extractionComplete:false,error:'MAIL_READ_FAILED',checkpoint:null};
 const state=evaluateAttention({accountId,previousState:{...previous.state,scans:previous.state.scans.filter(scan=>!same(scan,source)||!scan.error)},scans:[scan],policy:previous.policy,evaluatedAt:at}).nextState;
 return {state,policy:previous.policy,coverage:previous.coverage,provenance:previous.provenance};
}
module.exports={collectReview,projectReview,collectFailure,decideReview};
