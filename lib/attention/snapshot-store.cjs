'use strict';
const crypto=require('node:crypto');
const {evaluateAttention}=require('./evaluator.cjs');
// Single Redis key, no TTL. Execute only through a separately authorized transport.
const CAS_SCRIPT=`local current = redis.call('GET', KEYS[1])
if current == ARGV[3] then return 2 end
if ARGV[1] == 'absent' then
  if current then return 0 end
elseif current ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[1], ARGV[3])
return 1`;
const fail=code=>Object.assign(new Error(code),{code});
function createSnapshotStore({command,maxBytes}){
 if(typeof command!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw fail('EXPLICIT_STORAGE_LIMIT_REQUIRED');
 function key(accountId){if(typeof accountId!=='string'||!accountId.trim())throw fail('ACCOUNT_REQUIRED');return 'james:attention:v1:'+crypto.createHash('sha256').update(accountId).digest('hex');}
 function parse(raw,accountId){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>maxBytes)throw fail('INVALID_STORED_BYTES');
  let s;try{s=JSON.parse(raw);}catch{throw fail('CORRUPT_SNAPSHOT');}
  if(s?.schemaVersion!==1||s.accountId!==accountId||!Number.isSafeInteger(s.revision)||s.revision<1||s.state?.accountId!==accountId||!s.policy||!Array.isArray(s.provenance)||!Array.isArray(s.coverage)||!s.coverage.every(c=>typeof c?.label==='string'&&c.mailboxWide===false))throw fail('INVALID_SNAPSHOT');
  // Reconstruct from persisted facts at its persisted evaluation instant.
  evaluateAttention({accountId,previousState:s.state,scans:[],policy:s.policy,evaluatedAt:s.state.asOf});
  return s;
 }
 async function readRaw(accountId){const raw=await command(['GET',key(accountId)]);if(raw!==null)parse(raw,accountId);return raw;}
 async function load(accountId){const raw=await readRaw(accountId);return raw===null?null:parse(raw,accountId);}
 async function save({accountId,expectedRevision,state,policy,coverage,provenance}){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)throw fail('INVALID_REVISION');
  const k=key(accountId),prior=await readRaw(accountId),previous=prior===null?null:parse(prior,accountId);
  if((previous?.revision||0)!==expectedRevision)throw fail('REVISION_CONFLICT');
  const raw=JSON.stringify({schemaVersion:1,accountId,revision:expectedRevision+1,state,policy,coverage,provenance});
  const snapshot=parse(raw,accountId);
  let result;
  try{result=await command(['EVAL',CAS_SCRIPT,'1',k,prior===null?'absent':'present',prior||'',raw]);}
  catch{
   // A dropped acknowledgement must not cause a duplicate blind write.
   try{if(await readRaw(accountId)===raw)return {snapshot,acknowledgement:'recovered_by_read'};}catch{}
   throw fail('COMMIT_OUTCOME_UNKNOWN');
  }
  if(result===0)throw fail('REVISION_CONFLICT');
  if(result!==1&&result!==2)throw fail('COMMIT_OUTCOME_UNKNOWN');
  return {snapshot,acknowledgement:result===2?'already_committed':'confirmed'};
 }
 return {load,save};
}
async function evaluateAndSaveSnapshot({store,accountId,expectedRevision,scans,policy,evaluatedAt,coverage,provenance}){
 const previous=await store.load(accountId);
 if((previous?.revision||0)!==expectedRevision)throw fail('REVISION_CONFLICT');
 if(!Array.isArray(provenance))throw fail('PROVENANCE_REQUIRED');
 const result=evaluateAttention({accountId,scans,policy,evaluatedAt,...(previous?{previousState:previous.state}:{})});
 const committed=await store.save({accountId,expectedRevision,state:result.nextState,policy,coverage,provenance:[...(previous?.provenance||[]),...provenance]});
 return {result,revision:committed.snapshot.revision,acknowledgement:committed.acknowledgement};
}
module.exports={createSnapshotStore,evaluateAndSaveSnapshot,CAS_SCRIPT};
