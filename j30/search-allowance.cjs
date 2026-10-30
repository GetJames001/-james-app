'use strict';
const {createHash}=require('node:crypto');
// Trusted host configuration only. Never accept a grant or balance from a browser request.
// This caps James calls under a verified included allowance; it is not an account-wide billing cap.
function validGrant(grant,now){
 if(!grant||grant.version!==1||grant.plan!=='free'||typeof grant.grantId!=='string'||!/^[\w-]{16,80}$/.test(grant.grantId)||!Number.isInteger(grant.maxCalls)||grant.maxCalls<1||grant.maxCalls>5||!Number.isInteger(grant.remainingSearchCalls)||grant.remainingSearchCalls<grant.maxCalls||grant.remainingSearchCalls>1000||typeof grant.verifiedAt!=='string'||typeof grant.periodEndsAt!=='string')return false;
 const verified=Date.parse(grant.verifiedAt),periodEnd=Date.parse(grant.periodEndsAt);return Number.isFinite(verified)&&Number.isFinite(periodEnd)&&verified<=now&&now-verified<86400000&&now<periodEnd;
}
function createFreeSearchReservation({checkpoints,providerIdentity,grant,now=Date.now}){
 if(!checkpoints?.exclusive||typeof providerIdentity!=='string'||!providerIdentity||typeof now!=='function')throw Error('HOST_DEPENDENCIES_REQUIRED');
 const identity=createHash('sha256').update(providerIdentity).digest('hex'),scope={accountId:identity,conversationId:'included-search-usage',generation:1};
 const snapshot=grant&&structuredClone(grant),fingerprint=snapshot?createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'):null;
 return async function reserveFreeCall(){
  if(!validGrant(snapshot,now()))return false;
  const taskId='search-grant-'+snapshot.grantId;
  return checkpoints.exclusive(scope,taskId,async store=>{
   if(!validGrant(snapshot,now()))return false;
   const existing=await store.read();
   let row=existing;
   if(row){if(row.kind!=='included-search-reservations'||row.grantFingerprint!==fingerprint||!Number.isInteger(row.reserved)||row.reserved<0||row.reserved>snapshot.maxCalls)throw Error('SEARCH_ALLOWANCE_UNCONFIRMED')}
   else row={version:1,kind:'included-search-reservations',scope,taskId,grantFingerprint:fingerprint,reserved:0};
   if(!validGrant(snapshot,now()))return false;
   if(row.reserved>=snapshot.maxCalls)throw Error('FREE_SEARCH_LIMIT_REACHED');
   row.reserved++;await store.write(row);
   // A write that became stale still consumes its reservation, but starts no search.
   return validGrant(snapshot,now());
  });
 };
}
module.exports={validGrant,createFreeSearchReservation};
