'use strict';
const {fromVerifiedAA}=require('./mail-trip.cjs');
const {parseAAConfirmation}=require('./aa-confirmation.cjs');

const idRE=/^[a-zA-Z0-9_-]{1,200}$/;
const emailRE=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const extractAddress=value=>{
 if(typeof value!=='string'||value.length>200)return '';
 const trimmed=value.trim(), bracket=/^[^<>\r\n]*<([^<>\s]+)>$/.exec(trimmed);
 const address=(bracket?.[1]||trimmed).toLowerCase();
 return emailRE.test(address)?address:'';
};
const endpointOrigin=value=>{
 try {const u=new URL(value);
  if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/')return u.origin;
 }catch{}
 return '';
};
function qaConfiguration(env=process.env){
 const expectedHost=env.JAMES_TRAVEL_QA_BRANCH_URL;
 const qa=endpointOrigin(env.JAMES_TRAVEL_QA_KV_URL);
 const everyday=endpointOrigin(env.JAMES_TRAVEL_EVERYDAY_KV_URL);
 if(env.JAMES_TRAVEL_QA_REPLAY_ENABLED!=='true'||env.VERCEL_ENV!=='preview'||
    !/^[a-z0-9-]+\.vercel\.app$/.test(expectedHost||'')||env.VERCEL_BRANCH_URL!==expectedHost||
    !qa||!everyday||qa===everyday||endpointOrigin(env.KV_REST_API_URL)!==qa)return null;
 const messageId=env.JAMES_TRAVEL_QA_APPROVED_GMAIL_ID||'';
 const sender=extractAddress(env.JAMES_TRAVEL_QA_APPROVED_SENDER||'');
 if(!idRE.test(messageId)||!sender)return null;
 return {messageId,sender};
}

// Replays exactly one owner-reviewed, immutable provider item. This is not a
// trust rule for arbitrary incoming email: neither subject nor display From
// is independently authoritative. The server-side pin must be set only after
// the operator has independently verified the exact confirmation.
function createPinnedReader({readGmail,messageId,sender}){
 if(typeof readGmail!=='function'||!idRE.test(messageId||'')||extractAddress(sender)!==sender||!sender)throw Error('TRAVEL_REPLAY_NOT_CONFIGURED');
 return async job=>{
  if(job?.provider!=='gmail'||job.messageId!==messageId)throw Error('TRAVEL_REPLAY_SCOPE');
  const result=await readGmail({messageId});
  const m=result?.message;
  const routeSubject=/^(?:FW:\s*)?Your trip confirmation \(LAS - ORD\)$/i;
  if(result?.connected!==true||m?.id!=='gmail:'+messageId||extractAddress(m.sender)!==sender||!routeSubject.test(m.subject||'')||
      m.sourceFolder==='Spam'||m.sourceFolder==='Junk'||m.sourceFolder==='Trash')throw Error('TRAVEL_REPLAY_MESSAGE_MISMATCH');
  const parsed=parseAAConfirmation(m.bodyText);
  if(!parsed||parsed.start!=='2026-12-03'||parsed.end!=='2026-12-04'||
      parsed.segments[0].from!=='LAS'||parsed.segments[0].flight!=='AA 3015'||parsed.destination!=='ORD'||
      parsed.segments[1].flight!=='AA 3081')throw Error('TRAVEL_REPLAY_ITINERARY_MISMATCH');
  const candidate=fromVerifiedAA({body:m.bodyText,receivedDateTime:m.receivedDateTime,authenticatedSender:sender},[sender]);
  if(!candidate)throw Error('TRAVEL_REPLAY_UNPARSEABLE');
  return candidate;
 };
}
module.exports={qaConfiguration,createPinnedReader};
