'use strict';
const {evaluateAttention}=require('./evaluator.cjs');
// Dependency-injected offline handler. No route registration or live transport.
function createReadHandler({authorize,resolveAccount,loadSnapshot,now}){
 if([authorize,resolveAccount,loadSnapshot,now].some(f=>typeof f!=='function'))throw new TypeError('Explicit server dependencies required');
 return async function(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
  const session=await authorize(req,res);if(!session)return;
  if(req.method!=='GET'&&req.method!=='HEAD'){res.setHeader('Allow','GET, HEAD');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  // No client-selected account, state, policy, model, or scan controls.
  if(Object.keys(req.query||{}).length){res.status(400);return req.method==='HEAD'?res.end():res.json({error:'QUERY_NOT_SUPPORTED'});}
  try{
   const accountId=await resolveAccount(session);
   if(typeof accountId!=='string'||!accountId.trim())throw Error('ACCOUNT_UNAVAILABLE');
   const snapshot=await loadSnapshot(accountId);
   if(snapshot===null){res.status(200);return req.method==='HEAD'?res.end():res.json({schemaVersion:1,status:'not_checked',revision:0,attentionItems:[],sourceHealth:[],needsReview:[],coverage:[]});}
   if(!snapshot||snapshot.accountId!==accountId||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<1||snapshot.state?.accountId!==accountId||!Array.isArray(snapshot.coverage))throw Error('INVALID_SNAPSHOT');
   const evaluatedAt=now();
   const result=evaluateAttention({accountId,previousState:snapshot.state,scans:[],policy:snapshot.policy,evaluatedAt});
   const safeUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
   const attentionItems=result.attentionItems.map(item=>({id:item.id,title:item.action,kind:item.kind,status:item.status,deadline:item.deadline,deadlineStatus:item.deadlineStatus,sourceStatus:item.effectiveSourceStatus,evidenceLinks:(item.requestEvidence||[item.evidence]).filter(Boolean).map(e=>safeUrl(e.sourceUrl||e.evidence?.reference)).filter(Boolean)}));
   const sourceHealth=result.sourceHealth.map(s=>({id:s.id,status:s.effectiveStatus,lastSuccessfulScanAt:s.lastSuccessfulScanAt,pageCoverage:s.pageCoverage,extractionCoverage:s.extractionCoverage}));
   const needsReview=result.needsReview.map(r=>({id:r.id,reasons:r.reasons}));
   // Only a compact display label is exposed; raw provenance remains server-side.
   const coverage=snapshot.coverage.map(c=>{if(typeof c?.label!=='string'||c.mailboxWide!==false)throw Error('INVALID_COVERAGE');return {label:c.label,mailboxWide:false};});
   res.status(200);if(req.method==='HEAD')return res.end();
   return res.json({schemaVersion:1,status:'available',revision:snapshot.revision,evaluatedAt,attentionItems,sourceHealth,needsReview,coverage});
  }catch{res.status(503);return req.method==='HEAD'?res.end():res.json({error:'ATTENTION_UNAVAILABLE'});}
 };
}
module.exports={createReadHandler};
