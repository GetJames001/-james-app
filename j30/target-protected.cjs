'use strict';
const {productUrl,productId,createTargetReader}=require('./target-reader.cjs');
const {transportUrl,valueWithin,currentWithin}=require('./public-fetch.cjs');
const {createHash}=require('node:crypto');
const fail=code=>{throw Error(code)};
function resourceKind({url,method,type,main=false,requestedUrl}){
 if(method!=='GET')return null;let u;try{u=new URL(transportUrl(url))}catch{return null}
 if(main)return type==='document'&&url===requestedUrl?'document':null;
 if(type==='document')return null;
 if(u.hostname==='assets.targetimg1.com'&&u.pathname.startsWith('/webui/top-of-funnel/_next/static/')){
  if(type==='script'&&/\.js$/.test(u.pathname))return 'script';
  if(type==='stylesheet'&&/\.css$/.test(u.pathname))return 'stylesheet';
 }
 if(type==='image'&&u.hostname==='target.scene7.com'&&u.pathname.startsWith('/is/image/Target/'))return 'image';
 if(['fetch','xhr'].includes(type)&&u.hostname==='redsky.target.com'&&/^\/redsky_aggregations\/v1\/web\/pdp_client_v1$/.test(u.pathname)&&u.searchParams.getAll('tcin').length===1&&u.searchParams.get('tcin')===productId(requestedUrl))return 'json';
 return null;
}
const CSP="default-src 'none'; script-src https://assets.targetimg1.com 'unsafe-inline'; style-src https://assets.targetimg1.com 'unsafe-inline'; img-src https://target.scene7.com; connect-src https://redsky.target.com; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
function createProtectedTargetReader({browser,fetchPublic,now,timeoutMs=30000,cleanupTimeoutMs=3000}){
 if(typeof browser?.newContext!=='function'||typeof fetchPublic!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isInteger(cleanupTimeoutMs)||cleanupTimeoutMs<1||cleanupTimeoutMs>3000)fail('HOST_DEPENDENCIES_REQUIRED');
 return {async read(value,{assertCurrent,signal}={}){
  const requestedUrl=productUrl(value);if(typeof assertCurrent!=='function')fail('PUBLIC_FETCH_INVALID');
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),timeoutMs),activeSignal=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
  const active=fn=>valueWithin(fn,activeSignal),current=()=>currentWithin(assertCurrent,activeSignal);
  let context,acquiring,count=0,reserved=0,stage='context_setup',styleUnconfirmed=false,resourceBudget=false;const closing=new WeakMap();
  function close(ctx){if(closing.has(ctx))return closing.get(ctx);const promise=(async()=>{let timer;try{await Promise.race([Promise.resolve().then(()=>ctx.close()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CLEANUP_UNCONFIRMED')),cleanupTimeoutMs)})])}catch{fail('CLEANUP_UNCONFIRMED')}finally{clearTimeout(timer)}})();closing.set(ctx,promise);return promise}
  try{
   await current();acquiring=Promise.resolve().then(()=>browser.newContext({offline:true,javaScriptEnabled:true,serviceWorkers:'block',acceptDownloads:false}));context=await active(()=>acquiring);await current();
   if(typeof context.routeWebSocket!=='function')fail('WEBSOCKET_GATE_UNAVAILABLE');await active(()=>context.routeWebSocket('**/*',socket=>socket.close()));
   await active(()=>context.route('**/*',async route=>{
    const request=route.request();let main=false;try{main=request.isNavigationRequest()&&request.frame().parentFrame()===null}catch{}
    const kind=resourceKind({url:request.url(),method:request.method(),type:request.resourceType(),main,requestedUrl});
    if(!kind||++count>48){if(kind)resourceBudget=true;if(request.resourceType()==='stylesheet')styleUnconfirmed=true;return route.abort()}reserved+=kind==='stylesheet'?500000:2000000;if(reserved>32000000){resourceBudget=true;if(kind==='stylesheet')styleUnconfirmed=true;return route.abort()}
    try{await current();const response=await fetchPublic(request.url(),{kind,assertCurrent:current,signal:activeSignal});await current();return route.fulfill({status:200,contentType:response.contentType,body:response.body,headers:{'Content-Security-Policy':CSP,'Access-Control-Allow-Origin':'*'}})}catch{if(kind==='stylesheet')styleUnconfirmed=true;return route.abort()}
   }));
   const page=await active(()=>context.newPage());stage='document_navigation';const reader=createTargetReader(page,{now,verifyRender:async()=>{await current();if(styleUnconfirmed){const error=Error('PRODUCT_NOT_VERIFIED');error.reason=resourceBudget?'RESOURCE_BUDGET_EXHAUSTED':'STYLESHEET_FETCH_REJECTED';throw error}}});const result=await active(()=>reader.read(requestedUrl));await current();const receipt={name:result.name,price:result.price,currency:'USD',url:result.url,sourceHost:'www.target.com',verification:'target_selected_product_identity_and_visible_price',observedAt:result.observedAt,availability:'unknown',fitVerified:false,...(result.image?{image:result.image}:{})};return {...receipt,evidenceHash:createHash('sha256').update(JSON.stringify(receipt)).digest('hex')};
  }catch(error){const safe=Error(['TASK_INTERRUPTED','PRODUCT_NOT_VERIFIED','WEBSOCKET_GATE_UNAVAILABLE'].includes(error?.message)?error.message:'READER_EXECUTION_UNCONFIRMED');safe.stage=stage;if(['RESOURCE_BUDGET_EXHAUSTED','STYLESHEET_FETCH_REJECTED','STYLESHEET_AUDIT_FAILED','PRICE_UNVERIFIED','IDENTITY_UNVERIFIED','HEADING_NOT_RENDERED','PRICE_NOT_RENDERED'].includes(error?.reason))safe.reason=error.reason;if(resourceBudget)safe.reason='RESOURCE_BUDGET_EXHAUSTED';else if(styleUnconfirmed)safe.reason='STYLESHEET_FETCH_REJECTED';throw safe}
  finally{deadline.abort();clearTimeout(timer);if(context)await close(context);else if(acquiring){acquiring.then(ctx=>close(ctx)).catch(()=>{});fail('CLEANUP_UNCONFIRMED')}}
 }};
}
module.exports={resourceKind,createProtectedTargetReader};
