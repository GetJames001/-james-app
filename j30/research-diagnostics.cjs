'use strict';
const {createHash}=require('node:crypto');
const {transportUrl}=require('./public-fetch.cjs');
const {safeDiagnostic}=require('./general-shopping.cjs');
const statuses=new Set(['ready','running','paused','blocked','completed','incomplete']);
const errors=new Set(['ACTION_NOT_AUTHORIZED','REQUEST_INVALID','SCOPE_INVALID','TASK_INTERRUPTED','TASK_BUSY_OR_INTERRUPTED','RECONCILE_BEFORE_RETRY','TASK_REQUEST_MISMATCH','SESSION_BUDGET_EXHAUSTED','DISCOVERY_DISABLED','DISCOVERY_NOT_CONFIGURED','FREE_SEARCH_ALLOWANCE_UNVERIFIED','FREE_SEARCH_LIMIT_REACHED','DISCOVERY_REQUEST_UNSUPPORTED','FRESH_RESEARCH_NOT_ALLOWED','TASK_HISTORY_LIMIT','TASK_UNCONFIRMED','J30_RUNTIME_UNAVAILABLE']);
function researchDiagnostic({result,errorCode,requestedTaskId,commit,elapsedMs}={}){
 const id=result?.taskId||requestedTaskId;
 const task=typeof id==='string'&&/^[\w-]{1,160}$/.test(id)?createHash('sha256').update(id).digest('hex').slice(0,20):undefined;
 const failures=Array.isArray(result?.failures)?result.failures.slice(0,5).map(f=>{
  const diagnostic=safeDiagnostic(f?.diagnostic);let sourceHost;
  try{sourceHost=new URL(transportUrl(f?.url)).hostname;if(sourceHost.length>253)sourceHost=undefined}catch{}
  return {...(sourceHost?{sourceHost}:{}),...(diagnostic?{diagnostic}:{})};
 }):[];
 return {event:'j30.research_outcome',version:1,...(typeof commit==='string'&&/^[a-f0-9]{40}$/i.test(commit)?{commit:commit.toLowerCase()}:{}),...(task?{task}:{}),outcome:result&&statuses.has(result.status)?result.status:'request_rejected',...(errorCode?{errorCode:errors.has(errorCode)?errorCode:'TASK_UNCONFIRMED'}:{}),...(Number.isInteger(elapsedMs)&&elapsedMs>=0&&elapsedMs<=120000?{elapsedMs}:{}),...(Array.isArray(result?.products)&&result.products.length<=5?{productCount:result.products.length}:{}),...(Number.isInteger(result?.sessionStarts)&&result.sessionStarts>=0&&result.sessionStarts<=2?{sessionStarts:result.sessionStarts}:{}),...(result?.resultSource==='saved'||result?.resultSource==='fresh'?{resultSource:result.resultSource}:{}),...(result?.recoveredTask===true?{recoveredTask:true}:{}),...(safeDiagnostic(result?.diagnostic)?{diagnostic:safeDiagnostic(result.diagnostic)}:{}),failures};
}
module.exports={researchDiagnostic};
