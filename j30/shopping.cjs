'use strict';
const {parseRequest}=require('./browserbase.cjs');
const {scopeKey}=require('./checkpoints.cjs');
// Register this capability on the EXISTING James bridge; never create another identity.
function createShoppingCapability({verifyScope,checkpoints,provider,now=Date.now}){
 if(typeof verifyScope!=='function'||!checkpoints?.exclusive||!provider?.open)throw Error('HOST_DEPENDENCIES_REQUIRED');
 return async function researchShopping({text,scope,taskId,signal,isCurrent=()=>false,pauseAfter=3}){
  scopeKey(scope,taskId);const sameScope=()=>verifyScope(scope);
  async function current(){if(signal?.aborted||!isCurrent())throw Error('TASK_INTERRUPTED');const verified=await sameScope();if(signal?.aborted||!isCurrent()||!verified)throw Error('TASK_INTERRUPTED')}
  await current();
  return checkpoints.exclusive(scope,taskId,async store=>{
   let task=await store.read();await current();if(task&&task.request!==text)throw Error('TASK_REQUEST_MISMATCH');
   if(!task){const plan=parseRequest(text);task={version:1,scope,taskId,request:text,plan,status:'ready',sessionStarts:0,results:[],failures:[],remainingUrls:null,uncertainSession:false,cleanupUnconfirmed:false};await store.write(task)}
   if(task.uncertainSession||task.cleanupUnconfirmed||task.status==='running')throw Error('RECONCILE_BEFORE_RETRY');
   if(['completed','incomplete'].includes(task.status))return report(task);
   if(task.sessionStarts>=2)throw Error('SESSION_BUDGET_EXHAUSTED');
   let session,started=now(),visited=0;
   try{
    await current();await provider.preflight?.();task.status='running';task.sessionStarts++;task.uncertainSession=true;await store.write(task);
    session=await provider.open();task.sessionId=session.id;task.uncertainSession=false;await store.write(task);
    await current();if(task.remainingUrls===null){task.remainingUrls=[...await session.driver.search(task.plan.searchUrl)];await current();await store.write(task)}
    while(task.remainingUrls.length&&visited<Math.min(3,Math.max(1,pauseAfter))){
     await current();if(now()-started>45000)throw Error('TASK_TIME_LIMIT');const url=task.remainingUrls[0];let item;
     try{item=await session.driver.read(url)}catch(error){if(!['PRODUCT_NOT_VERIFIED','SITE_REQUIRES_USER_REVIEW'].includes(error.message))throw error;task.failures.push({url,error:error.message});}
     await current();if(item)task.results.push(item);task.remainingUrls.shift();visited++;await store.write(task);
    }
    task.status=task.remainingUrls.length?'paused':task.results.filter(p=>p.currency===task.plan.currency&&(task.plan.maxPrice===null||p.price<=task.plan.maxPrice)).length>=2?'completed':'incomplete';
   }catch(error){task.status=error.message==='TASK_INTERRUPTED'?'paused':'blocked';task.error=['TASK_INTERRUPTED','TASK_TIME_LIMIT','EXECUTION_DISABLED','USAGE_APPROVAL_REQUIRED','PROVIDER_NOT_CONFIGURED','SITE_REQUIRES_USER_REVIEW','CLEANUP_UNCONFIRMED'].includes(error.message)?error.message:'EXECUTION_UNCONFIRMED';
   }finally{
    if(session)try{await session.close()}catch{task.cleanupUnconfirmed=true;task.status='blocked';task.error='CLEANUP_UNCONFIRMED'}
    await store.write(task);
   }
   await current();return report(task);
  });
 };
}
function report(task){const products=task.results.filter(p=>p.currency===task.plan.currency&&(task.plan.maxPrice===null||p.price<=task.plan.maxPrice)).sort((a,b)=>a.price-b.price);return {taskId:task.taskId,status:task.status,query:task.plan.query,products,excludedCount:task.results.length-products.length,failures:task.failures,error:task.error||null,comparisonVerified:task.status==='completed'&&products.length>=2,message:products.length>=2?'Compared observed public page names and USD prices. Product fit, stock, shipping and taxes are not fully verified.':'Not enough verified products to complete a comparison.',purchaseAuthorized:false,accountConnections:false};}
module.exports={createShoppingCapability,report};
