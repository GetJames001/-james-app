'use strict';
const {parseRequest}=require('./browserbase.cjs');
const {scopeKey}=require('./checkpoints.cjs');
// Register this capability on the EXISTING James bridge; never create another identity.
function createShoppingCapability({verifyScope,checkpoints,provider,now=Date.now}){
 if(typeof verifyScope!=='function'||!checkpoints?.exclusive||!provider?.open)throw Error('HOST_DEPENDENCIES_REQUIRED');
 return async function researchShopping({text,scope,taskId,signal,isCurrent=()=>false,pauseAfter=3}){
  if(!Number.isInteger(pauseAfter)||pauseAfter<1||pauseAfter>3)throw Error('REQUEST_INVALID');
  scopeKey(scope,taskId);const sameScope=()=>verifyScope(scope);
  async function current(){if(signal?.aborted||!isCurrent())throw Error('TASK_INTERRUPTED');const verified=await sameScope();if(signal?.aborted||!isCurrent()||!verified)throw Error('TASK_INTERRUPTED')}
  await current();
  return checkpoints.exclusive(scope,taskId,async store=>{
   let task=await store.read();await current();if(task&&task.request!==text)throw Error('TASK_REQUEST_MISMATCH');
   if(!task){const plan=parseRequest(text);task={version:1,verifierVersion:1,scope,taskId,request:text,plan,status:'ready',sessionStarts:0,results:[],failures:[],remainingUrls:null,uncertainSession:false,cleanupUnconfirmed:false};await store.write(task)}
   if(task.uncertainSession||task.cleanupUnconfirmed||task.status==='running')throw Error('RECONCILE_BEFORE_RETRY');
   // One deliberate legacy verifier recheck, preserving failed evidence and session budget.
   // Only confirmed read-verification failures qualify; uncertain sessions never do.
   if(task.status==='incomplete'&&task.verifierVersion===undefined&&task.results.length===0&&task.failures.length>0&&task.failures.every(f=>f.error==='PRODUCT_NOT_VERIFIED')&&task.sessionStarts<2){
    task.legacyVerificationFailures=structuredClone(task.failures);task.remainingUrls=[...new Set(task.failures.map(f=>f.url))].slice(0,3);task.failures=[];task.verifierVersion=1;task.status='ready';
   }
   // A confirmed empty discovery may be retried within the SAME task/session budget.
   // Never retry product failures, uncertain creation or unconfirmed cleanup here.
   if(task.status==='incomplete'&&task.results.length===0&&task.failures.length===0&&task.remainingUrls?.length===0&&task.sessionStarts<2){task.status='ready';task.remainingUrls=null;}
   else if(['completed','incomplete'].includes(task.status))return {...report(task),resultSource:'saved'};
   if(task.sessionStarts>=2)throw Error('SESSION_BUDGET_EXHAUSTED');
   let session,started=now(),visited=0;const timing={browserStartMs:0,discoveryMs:0,productReadMs:[],cleanupMs:0};let stageStarted=now();
   try{
    await current();await provider.preflight?.();task.status='running';task.sessionStarts++;task.uncertainSession=true;await store.write(task);
    stageStarted=now();session=await provider.open();timing.browserStartMs=Math.max(0,now()-stageStarted);task.sessionId=session.id;task.uncertainSession=false;await store.write(task);
    await current();if(task.remainingUrls===null){stageStarted=now();task.remainingUrls=[...await session.driver.search(task.plan.searchUrl)];timing.discoveryMs=Math.max(0,now()-stageStarted);task.searchEvidence=session.driver.diagnostics?.()||null;await current();await store.write(task)}
    timing.productReadMode=typeof session.driver.readBatch==='function'?'batches_of_at_most_two':'sequential';
    while(task.remainingUrls.length&&visited<Math.min(3,Math.max(1,pauseAfter))){
     await current();if(now()-started>45000)throw Error('TASK_TIME_LIMIT');
     const limit=Math.min(typeof session.driver.readBatch==='function'?2:1,task.remainingUrls.length,Math.min(3,Math.max(1,pauseAfter))-visited),urls=task.remainingUrls.slice(0,limit);
     stageStarted=now();const settled=typeof session.driver.readBatch==='function'?await session.driver.readBatch(urls):await Promise.allSettled(urls.map(url=>session.driver.read(url)));
     timing.productReadMs.push(Math.max(0,now()-stageStarted));
     if(!Array.isArray(settled)||settled.length!==urls.length)throw Error('READ_BATCH_INVALID');
     for(let index=0;index<urls.length;index++){
      await current();const entry=settled[index];
      if(entry.status==='fulfilled')task.results.push(entry.value);
      else{const error=entry.reason;if(!['PRODUCT_NOT_VERIFIED','SITE_REQUIRES_USER_REVIEW'].includes(error?.message))throw error||Error('PRODUCT_NOT_VERIFIED');task.failures.push({url:urls[index],error:error.message});}
      task.remainingUrls.shift();visited++;await store.write(task);
     }
    }
    task.status=task.remainingUrls.length?'paused':task.results.filter(p=>p.currency===task.plan.currency&&(task.plan.maxPrice===null||p.price<=task.plan.maxPrice)).length>=2?'completed':'incomplete';
   }catch(error){task.status=error.message==='TASK_INTERRUPTED'?'paused':'blocked';task.error=['TASK_INTERRUPTED','TASK_TIME_LIMIT','EXECUTION_DISABLED','USAGE_APPROVAL_REQUIRED','PROVIDER_NOT_CONFIGURED','SITE_REQUIRES_USER_REVIEW','CLEANUP_UNCONFIRMED'].includes(error.message)?error.message:'EXECUTION_UNCONFIRMED';
   }finally{
    stageStarted=now();if(session)try{await session.close()}catch{task.cleanupUnconfirmed=true;task.status='blocked';task.error='CLEANUP_UNCONFIRMED'}
    timing.cleanupMs=Math.max(0,now()-stageStarted);timing.totalExecutionMs=Math.max(0,now()-started);task.timing=timing;await store.write(task);
   }
   await current();return {...report(task),resultSource:'fresh'};
  });
 };
}
function report(task){const products=task.results.filter(p=>p.currency===task.plan.currency&&(task.plan.maxPrice===null||p.price<=task.plan.maxPrice)).sort((a,b)=>a.price-b.price);return {timing:task.timing||null,taskId:task.taskId,status:task.status,query:task.plan.query,products,excludedCount:task.results.length-products.length,failures:task.failures,searchEvidence:task.searchEvidence||null,sessionStarts:task.sessionStarts,error:task.error||null,comparisonVerified:task.status==='completed'&&products.length>=2,message:products.length>=2?'Compared observed public page names and USD prices. Product fit, stock, shipping and taxes are not fully verified.':'Not enough verified products to complete a comparison.',purchaseAuthorized:false,accountConnections:false};}
module.exports={createShoppingCapability,report};
