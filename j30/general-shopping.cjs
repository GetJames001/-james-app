'use strict';
const {createHash}=require('node:crypto');
const {scopeKey}=require('./checkpoints.cjs');
const {discoveryRequest}=require('./discovery.cjs');
const {transportUrl,currentWithin,valueWithin}=require('./public-fetch.cjs');
const fail=code=>{throw Error(code)};
const stages=new Set(['provider_open','context_setup','document_navigation','product_observation','cleanup']);
const diagnosticCodes=new Set(['BROWSER_CONNECTION_FAILED','CLEANUP_UNCONFIRMED','PROVIDER_REQUEST_UNCONFIRMED','PROVIDER_REQUEST_REJECTED','PROVIDER_RESPONSE_INVALID','USAGE_ALLOWANCE_UNCONFIRMED','USAGE_UNCONFIRMED','WEBSOCKET_GATE_UNAVAILABLE','READER_EXECUTION_UNCONFIRMED','TASK_INTERRUPTED','PUBLIC_URL_DENIED','PUBLIC_DNS_DENIED','PUBLIC_DNS_UNCONFIRMED','PUBLIC_RESPONSE_UNVERIFIED','PUBLIC_CONTENT_UNSUPPORTED','PUBLIC_RESPONSE_TOO_LARGE','PUBLIC_REQUEST_UNCONFIRMED','PRODUCT_NOT_VERIFIED']);
const reasons=new Set(['RESOURCE_BUDGET_EXHAUSTED','REQUEST_LIMIT_EXHAUSTED','BYTE_BUDGET_EXHAUSTED','STYLESHEET_FETCH_REJECTED','STYLESHEET_AUDIT_FAILED','STYLESHEET_RENDER_CHANGED','PRICE_UNVERIFIED','IDENTITY_UNVERIFIED','HEADING_NOT_RENDERED','PRICE_NOT_RENDERED']);
function safeDiagnostic(value){return value&&stages.has(value.stage)&&diagnosticCodes.has(value.code)?{stage:value.stage,code:value.code,...(reasons.has(value.reason)?{reason:value.reason}:{}),...(value.code==='PUBLIC_RESPONSE_UNVERIFIED'&&value.stage==='document_navigation'&&Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599?{httpStatus:value.httpStatus}:{})}:undefined;}
function productReceipt(value){
 if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>500||value.currency!=='USD'||typeof value.price!=='number'||!Number.isFinite(value.price)||value.price<=0||value.price>10000||typeof value.observedAt!=='string'||!Number.isFinite(Date.parse(value.observedAt))||!['static_rendered_product_microdata_and_jsonld','target_selected_product_identity_and_visible_price'].includes(value.verification)||value.fitVerified!==false||value.availability!=='unknown')fail('PRODUCT_NOT_VERIFIED');
 if(value.verification==='target_selected_product_identity_and_visible_price'&&require('./target-reader.cjs').productUrl(value.url)!==value.url)fail('PRODUCT_NOT_VERIFIED');
 const url=transportUrl(value.url);if(url!==value.url||value.sourceHost!==new URL(url).hostname)fail('PRODUCT_NOT_VERIFIED');
 const receipt={name:value.name,price:value.price,currency:'USD',url,sourceHost:value.sourceHost,verification:value.verification,observedAt:value.observedAt,availability:'unknown',fitVerified:false};
 if(value.image){if(value.image.verification!=='product_metadata_and_loaded_visible_image'||transportUrl(value.image.url)!==value.image.url)fail('PRODUCT_NOT_VERIFIED');receipt.image={url:value.image.url,verification:value.image.verification}}
 const hash=createHash('sha256').update(JSON.stringify(receipt)).digest('hex');if(hash!==value.evidenceHash)fail('PRODUCT_NOT_VERIFIED');return {...receipt,evidenceHash:hash};
}
function generalReport(task){
 const all=task.results.map(productReceipt),products=all.filter(p=>task.plan.maxPrice===null||p.price<=task.plan.maxPrice).sort((a,b)=>a.price-b.price);
 if(new Set(all.map(p=>p.url)).size!==all.length)fail('CHECKPOINT_INVALID');
 return {...(safeDiagnostic(task.diagnostic)?{diagnostic:safeDiagnostic(task.diagnostic)}:{}),taskId:task.taskId,status:task.status,query:task.plan.query,maxPrice:task.plan.maxPrice,searchScope:'web',products,sourceHostCount:new Set(products.map(p=>p.sourceHost.replace(/^www\./,''))).size,excludedCount:all.length-products.length,failures:task.failures.map(f=>({url:transportUrl(f.url),error:'PRODUCT_NOT_VERIFIED',...(safeDiagnostic(f.diagnostic)?{diagnostic:safeDiagnostic(f.diagnostic)}:{})})),sessionStarts:task.sessionStarts,error:['TASK_INTERRUPTED','CLEANUP_UNCONFIRMED','EXECUTION_UNCONFIRMED'].includes(task.error)?task.error:null,comparisonVerified:task.status==='completed'&&products.length>=2,fitVerified:false,purchaseAuthorized:false,accountConnections:false};
}
function validateCheckpoint(task,plan,scope,taskId){
 try{
  if(task.version!==1||JSON.stringify(task.scope)!==JSON.stringify(scope)||task.taskId!==taskId||JSON.stringify(task.plan)!==JSON.stringify(plan)||!['ready','running','paused','blocked','completed','incomplete'].includes(task.status)||typeof task.uncertainSession!=='boolean'||typeof task.cleanupUnconfirmed!=='boolean'||!Array.isArray(task.results)||task.results.length>5||!Array.isArray(task.failures)||task.failures.length>5||!(task.remaining===null||Array.isArray(task.remaining)&&task.remaining.length<=5)||!Number.isInteger(task.sessionStarts)||task.sessionStarts<0||task.sessionStarts>2)throw Error();
  const products=task.results.map(productReceipt),urls=[...products.map(p=>p.url),...task.failures.map(f=>{if(f.error!=='PRODUCT_NOT_VERIFIED'||transportUrl(f.url)!==f.url)throw Error();return f.url}),...(task.remaining||[]).map(url=>{if(transportUrl(url)!==url)throw Error();return url})];
  if(urls.length>5||new Set(urls).size!==urls.length||task.remaining===null&&urls.length)throw Error();
  const eligible=products.filter(p=>plan.maxPrice===null||p.price<=plan.maxPrice).length;
  if(['completed','incomplete'].includes(task.status)&&(task.remaining===null||task.remaining.length||task.status==='completed'&&eligible<2||task.status==='incomplete'&&eligible>=2))throw Error();
 }catch{fail('CHECKPOINT_INVALID')}
}
function createGeneralShoppingCapability({verifyScope,checkpoints,discover,provider,timeoutMs=45000,cleanupTimeoutMs=10000}){
 if(typeof verifyScope!=='function'||!checkpoints?.exclusive||typeof discover!=='function'||typeof provider?.open!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000||!Number.isInteger(cleanupTimeoutMs)||cleanupTimeoutMs<1||cleanupTimeoutMs>10000)fail('HOST_DEPENDENCIES_REQUIRED');
 return async function research({text,scope,taskId,signal,isCurrent=()=>false,pauseAfter=5,recheckIncomplete=false}){
  scopeKey(scope,taskId);const plan=discoveryRequest(text);if(!Number.isInteger(pauseAfter)||pauseAfter<1||pauseAfter>5)fail('REQUEST_INVALID');
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),timeoutMs),activeSignal=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
  async function current(){await currentWithin(async()=>{if(!isCurrent()||!await verifyScope(scope)||!isCurrent())fail('TASK_INTERRUPTED')},activeSignal)}
  try{await current();return await checkpoints.exclusive(scope,taskId,async store=>{
   let task=await store.read();await current();
   if(task){if(task.kind!=='general-shopping'||task.request!==text)fail('TASK_REQUEST_MISMATCH');validateCheckpoint(task,plan,scope,taskId);if(task.uncertainSession||task.cleanupUnconfirmed||task.status==='running')fail('RECONCILE_BEFORE_RETRY');if(task.status==='incomplete'&&recheckIncomplete===true&&task.failures.length){if(task.sessionStarts>=2)fail('SESSION_BUDGET_EXHAUSTED');task.previousFailures=task.failures;task.remaining=task.failures.map(f=>f.url);task.failures=[];task.status='ready'}else if(['completed','incomplete'].includes(task.status))return {...generalReport(task),resultSource:'saved'}}
   else{task={version:1,kind:'general-shopping',scope,taskId,request:text,plan,status:'ready',results:[],failures:[],remaining:null,sessionStarts:0,uncertainSession:false,cleanupUnconfirmed:false};await store.write(task)}
   let discoverySource='saved';if(task.remaining===null){
    const discoveryId='discover-'+createHash('sha256').update(taskId).digest('hex').slice(0,40);
    const found=await valueWithin(()=>discover({text,scope,taskId:discoveryId,signal:activeSignal,isCurrent}),activeSignal);await current();
    if(found?.comparisonVerified!==false||found.requiresProductVerification!==true||!Array.isArray(found.candidates)||found.candidates.length>5)fail('DISCOVERY_RESPONSE_INVALID');
    discoverySource=found.resultSource==='saved'?'saved':'fresh';task.remaining=[...new Set(found.candidates.map(c=>{if(c.productVerified!==false||c.navigationApproved!==false)fail('DISCOVERY_RESPONSE_INVALID');return transportUrl(c.url)}))];await store.write(task);
   }
   if(!task.remaining.length){task.status=task.results.filter(p=>task.plan.maxPrice===null||p.price<=task.plan.maxPrice).length>=2?'completed':'incomplete';await store.write(task);await current();return {...generalReport(task),resultSource:discoverySource}}
   if(task.sessionStarts>=2)fail('SESSION_BUDGET_EXHAUSTED');
   let session,opening,visited=0,stage='provider_open';const closures=new WeakMap();
   function closeSession(value){if(closures.has(value))return closures.get(value);const closing=(async()=>{let stop;try{await Promise.race([Promise.resolve().then(()=>value.close()),new Promise((_,reject)=>{stop=setTimeout(()=>reject(Error('CLEANUP_UNCONFIRMED')),cleanupTimeoutMs)})])}catch{fail('CLEANUP_UNCONFIRMED')}finally{clearTimeout(stop)}})();closures.set(value,closing);return closing}
   try{
    await current();await valueWithin(()=>provider.preflight?.(),activeSignal);await current();
    task.status='running';task.sessionStarts++;task.uncertainSession=true;await store.write(task);
    opening=Promise.resolve().then(async()=>{await current();return provider.open({assertCurrent:current,signal:activeSignal,navigationHosts:[...new Set(task.remaining.map(url=>new URL(url).hostname))]})});session=await valueWithin(()=>opening,activeSignal);task.uncertainSession=false;task.sessionId=session.id;await store.write(task);await current();
    while(task.remaining.length&&visited<pauseAfter){
     await current();stage='product_observation';const url=task.remaining[0];
     try{const receipt=await valueWithin(()=>session.driver.read(url,{assertCurrent:current,signal:activeSignal}),activeSignal);await current();const product=productReceipt(receipt);if(product.url!==url)fail('PRODUCT_NOT_VERIFIED');task.results.push(product)}
     catch(error){if(!['PRODUCT_NOT_VERIFIED','PUBLIC_URL_DENIED','PUBLIC_DNS_DENIED','PUBLIC_DNS_UNCONFIRMED','PUBLIC_RESPONSE_UNVERIFIED','PUBLIC_CONTENT_UNSUPPORTED','PUBLIC_RESPONSE_TOO_LARGE','PUBLIC_REQUEST_UNCONFIRMED'].includes(error?.message))throw error;await current();task.failures.push({url,error:'PRODUCT_NOT_VERIFIED',diagnostic:safeDiagnostic({stage:stages.has(error?.stage)?error.stage:stage,code:error.message,reason:error.reason,httpStatus:error.httpStatus})})}
     task.remaining.shift();visited++;await store.write(task);
    }
    task.status=task.remaining.length?'paused':task.results.filter(p=>task.plan.maxPrice===null||p.price<=task.plan.maxPrice).length>=2?'completed':'incomplete';delete task.error;delete task.diagnostic;
   }catch(error){task.diagnostic={stage:stages.has(error?.stage)?error.stage:stage,code:diagnosticCodes.has(error?.message)?error.message:'READER_EXECUTION_UNCONFIRMED',...(reasons.has(error.reason)?{reason:error.reason}:{})};task.status=error?.message==='TASK_INTERRUPTED'?'paused':'blocked';task.error=error?.message==='TASK_INTERRUPTED'?'TASK_INTERRUPTED':'EXECUTION_UNCONFIRMED';if(error?.message==='CLEANUP_UNCONFIRMED'){task.cleanupUnconfirmed=true;task.error='CLEANUP_UNCONFIRMED'}}
   finally{
    if(session)try{await closeSession(session)}catch{task.cleanupUnconfirmed=true;task.status='blocked';task.error='CLEANUP_UNCONFIRMED';task.diagnostic={stage:'cleanup',code:'CLEANUP_UNCONFIRMED'}}
    else if(opening){opening.then(value=>closeSession(value)).catch(()=>{});task.uncertainSession=true;task.status='blocked';task.error='CLEANUP_UNCONFIRMED'}
    await store.write(task);
   }
   await current();return {...generalReport(task),resultSource:'fresh'};
  })}finally{clearTimeout(timer)}
 };
}
module.exports={productReceipt,generalReport,createGeneralShoppingCapability};
