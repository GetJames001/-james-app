'use strict';
// Server-only. No arbitrary click/fill/evaluate capability is exposed to James.
const {createHash}=require('node:crypto');
const fail=code=>{throw Error(code)};
const HOST='www.ikea.com';
const SEARCH_HOST='sik.search.blue.cdtapps.com';
function catalogSearchPayload(){
 // Trusted fixed public catalog read for this isolated pilot. No page data is copied.
 return JSON.stringify({searchParameters:{input:'desk lamps',type:'QUERY'},components:[{component:'PRIMARY_AREA',columns:4,types:{main:'PRODUCT',breakouts:['CONTENT','PLANNER']}}]});
}
function allowResource({url,method,type,mainDocument=false,authorizedSearch=false}){
 let u;try{u=new URL(url)}catch{return false}
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.pathname.includes('%'))return false;
 const search=u.hostname===SEARCH_HOST&&['fetch','xhr'].includes(type)&&/^\/us\/en\/search\/?$/.test(u.pathname)&&![...u.searchParams.keys()].some(k=>/token|password|email|auth|cookie/i.test(k));
 if(method==='POST')return !mainDocument&&search&&authorizedSearch===true;
 if(!['GET','HEAD'].includes(method))return false;
 if(mainDocument){try{publicUrl(url);return type==='document'}catch{return false}}
 if(type==='document')return false;
 if(type==='image'&&productImageUrl(url))return true;
 if(/cart|checkout|account|profile|login|signin|payment|order|gtag|tracking/i.test(u.pathname))return false;
 if(u.hostname===HOST&&['script','stylesheet','font','image'].includes(type)&&
    /^(?:\/global\/assets\/|\/us\/en\/(?:search|product-lists|products|recommendations|nudge|experiment-fragment)\/)/.test(u.pathname)&&
    /\.(?:m?js|css|woff2?|svg|png|jpe?g|webp)$/i.test(u.pathname))return true;
 if(u.hostname===HOST&&['fetch','xhr'].includes(type)&&/^\/us\/en\/products\/price-package-(?:scripts|styles)\.html$/.test(u.pathname))return true;
 return search;
}
async function deliverResource(route,requestOptions={},observeResponse=()=>{}){
 // route.continue follows redirects without rechecking this policy. Never follow one.
 try{const response=await route.fetch({...requestOptions,maxRedirects:0,maxRetries:0,timeout:10000});
  observeResponse(response.status());
  if(response.status()>=300&&response.status()<400)return route.abort();
  return route.fulfill({response});
 }catch{return route.abort()}
}
function publicUrl(value,{product=false}={}){
 let u;try{u=new URL(value)}catch{fail('URL_DENIED')}
 if(u.protocol!=='https:'||u.hostname!==HOST||u.port||u.username||u.password||u.hash||/cart|checkout|account|profile|favorites|login|signin|payment|order/i.test(u.pathname))fail('URL_DENIED');
 if(!u.pathname.startsWith('/us/en/')||(product&&!u.pathname.startsWith('/us/en/p/')))fail('URL_DENIED');
 if(product)u.search='';else if([...u.searchParams.keys()].some(k=>k!=='q'))fail('URL_DENIED');
 return u.href;
}
function productImageUrl(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!==HOST||u.port||u.username||u.password||u.hash||u.search||!/^\/us\/en\/images\/products\/[a-zA-Z0-9_/-]+\.(?:avif|jpe?g|png|webp)$/i.test(u.pathname))return null;return u.href;}catch{return null;}
}
function parseRequest(text){
 if(typeof text!=='string'||!text.trim()||text.length>1000)fail('REQUEST_INVALID');
 if(/\b(buy|purchase|checkout|log\s*in|sign\s*in|connect|subscribe|add\s+to\s+cart)\b/i.test(text))fail('ACTION_NOT_AUTHORIZED');
 const budget=text.match(/(?:under|below|up to|maximum|max)\s*\$\s*(\d+(?:\.\d{1,2})?)/i);
 const maxPrice=budget?Number(budget[1]):null;if(maxPrice!==null&&!(maxPrice>0&&maxPrice<=10000))fail('REQUEST_INVALID');
 const query=text.replace(/^(?:please\s+)?(?:find|compare|research|show me)\s+/i,'').replace(/(?:under|below|up to|maximum|max)\s*\$\s*\d+(?:\.\d{1,2})?.*$/i,'').replace(/[.!?]+$/,'').trim();
 if(!query||query.length>150||/https?:|[<>]/i.test(query))fail('REQUEST_INVALID');
 return {query,maxPrice,currency:'USD',searchUrl:publicUrl('https://'+HOST+'/us/en/search/?q='+encodeURIComponent(query))};
}
function createBrowserbase({apiKey,projectId,enabled=false,usageApproved=false,maxUsageMinutes=null,fetchImpl=fetch,connectOverCDP}){
 async function api(path,body,method='POST'){
  let r;try{r=await fetchImpl('https://api.browserbase.com/v1/'+path,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{'X-BB-API-Key':apiKey,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})})}catch{fail('PROVIDER_REQUEST_UNCONFIRMED')}
  if(!r.ok)fail('PROVIDER_REQUEST_REJECTED');let data;try{data=await r.json()}catch{fail('PROVIDER_RESPONSE_INVALID')}return data;
 }
 function preflight(){
  if(!enabled)fail('EXECUTION_DISABLED');if(!usageApproved)fail('USAGE_APPROVAL_REQUIRED');if(!apiKey||!projectId)fail('PROVIDER_NOT_CONFIGURED');if(typeof connectOverCDP!=='function')fail('DRIVER_NOT_CONFIGURED');
  return {provider:'browserbase',sessionTimeoutSeconds:60,maxSessionsPerTask:2};
 }
 return {preflight,async open(){
  preflight();
  if(maxUsageMinutes!==null){
   if(!Number.isSafeInteger(maxUsageMinutes)||maxUsageMinutes<0)fail('USAGE_UNCONFIRMED');
   const usage=await api('projects/'+encodeURIComponent(projectId)+'/usage',undefined,'GET');
   if(!Number.isSafeInteger(usage.browserMinutes)||usage.browserMinutes<0||usage.browserMinutes>maxUsageMinutes)fail('USAGE_ALLOWANCE_UNCONFIRMED');
  }
  // No keepAlive/Contexts/proxies, automatic CAPTCHA solving, logs or recordings.
  const session=await api('sessions',{projectId,timeout:60,keepAlive:false,proxies:false,browserSettings:{solveCaptchas:false,recordSession:false,logSession:false,ignoreCertificateErrors:false,allowedDomains:[HOST,SEARCH_HOST]}});
  if(typeof session.id!=='string'||!/^[\w-]{1,160}$/.test(session.id))fail('PROVIDER_RESPONSE_INVALID');
  let browser,closed=false;
  async function close(){
   if(closed)return;
   try{await api('sessions/'+session.id,{status:'REQUEST_RELEASE'})}finally{try{await browser?.close()}catch{}}
   for(let attempt=0;attempt<3;attempt++){
    const state=await api('sessions/'+session.id,undefined,'GET');
    if(['COMPLETED','TIMED_OUT','ERROR'].includes(state.status)){closed=true;return}
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,100));
   }
   fail('CLEANUP_UNCONFIRMED');
  }
  try{
   const url=new URL(session.connectUrl);if(url.protocol!=='wss:'||!(url.hostname==='connect.browserbase.com'||url.hostname.endsWith('.browserbase.com')))fail('PROVIDER_RESPONSE_INVALID');
   browser=await connectOverCDP(session.connectUrl,{timeout:10000});
   const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});if(!context)fail('BROWSER_CONTEXT_UNAVAILABLE');
   if(typeof context.routeWebSocket!=='function')fail('WEBSOCKET_GATE_UNAVAILABLE');
   await context.routeWebSocket('**/*',socket=>socket.close());
   // Deny writes and off-merchant traffic even if a page tries to redirect us.
   const denied=new Map(),catalogResponseStatuses=[];let authorizedSearch=false;
   await context.route('**/*',async route=>{const req=route.request();let mainDocument=false;try{mainDocument=req.isNavigationRequest()&&req.frame().parentFrame()===null}catch{}
    if(allowResource({url:req.url(),method:req.method(),type:req.resourceType(),mainDocument,authorizedSearch})){
     if(req.method()==='POST')return deliverResource(route,{url:'https://sik.search.blue.cdtapps.com/us/en/search',postData:catalogSearchPayload(),headers:{'Content-Type':'application/json',Accept:'application/json',Origin:'https://www.ikea.com'}},status=>{if(catalogResponseStatuses.length<3)catalogResponseStatuses.push(status)});
     return deliverResource(route);
    }
    try{const u=new URL(req.url()),key=u.hostname+u.pathname.slice(0,180)+' ['+req.method()+' '+req.resourceType()+']';
     if(!denied.has(key)&&denied.size>=32&&['fetch','xhr'].includes(req.resourceType())){const first=[...denied.keys()].find(k=>!/(fetch|xhr)\]$/.test(k));if(first)denied.delete(first)}
     if(denied.has(key)||denied.size<32)denied.set(key,(denied.get(key)||0)+1)}catch{}return route.abort()});
   const page=await context.newPage();page.setDefaultTimeout(8000);
   return {id:session.id,driver:createShoppingDriver(page,()=>[...denied].map(([resource,count])=>({resource,count})),url=>{authorizedSearch=new URL(url).searchParams.get('q')==='desk lamps';},()=>[...catalogResponseStatuses]),close};
  }catch{try{await close()}catch{fail('CLEANUP_UNCONFIRMED')}fail('BROWSER_CONNECTION_FAILED')}
 }};
}
function createShoppingDriver(page,networkEvidence=()=>[],authorizeSearch=()=>{},catalogEvidence=()=>[]){
 let searchEvidence=null;
 async function visit(url,product=false){publicUrl(url,{product});const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:12000});const actual=publicUrl(page.url(),{product});
  if(response&&response.status()>=400)fail('PAGE_RESPONSE_UNVERIFIED');
  const blocked=await page.locator('body').innerText({timeout:5000});if(/verify you are human|captcha|access denied|unusual traffic|checking your browser/i.test(blocked.slice(0,12000)))fail('SITE_REQUIRES_USER_REVIEW');return actual;
 }
 return {
  diagnostics(){return searchEvidence?{...searchEvidence}:null;},
  async search(url){publicUrl(url);authorizeSearch(url);await visit(url);
   // Search results may hydrate after DOMContentLoaded. Wait for a real product link.
   let timedOut=false;try{await page.locator('a[href*="/us/en/p/"]').first().waitFor({state:'attached',timeout:8000})}catch{timedOut=true}
   const body=await page.locator('body').innerText({timeout:5000});
   if(/verify you are human|captcha|access denied|unusual traffic|checking your browser/i.test(body.slice(0,12000)))fail('SITE_REQUIRES_USER_REVIEW');
   const links=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(n=>n.href));const products=[...new Set(links.flatMap(href=>{try{return [publicUrl(href,{product:true})]}catch{return []}}))].slice(0,3);
   searchEvidence={stage:'discovery',anchorCount:links.length,productLinkCount:products.length,bodyCharacters:body.length,waitTimedOut:timedOut,pageTitle:(await page.title()).slice(0,160),publicPageExcerpt:body.slice(0,500),deniedResources:networkEvidence(),catalogResponseStatuses:catalogEvidence()};
   return products;},
  async read(url){const actual=await visit(url,true);
   try{await page.waitForFunction(()=>Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some(node=>{const text=node.textContent||'';return text.length<=100000&&/"@type"\s*:\s*(?:"Product"|\[[^\]]*"Product")/.test(text)}),undefined,{timeout:8000});await page.locator('h1').first().waitFor({state:'visible',timeout:5000})}catch{fail('PRODUCT_NOT_VERIFIED')}
   const raw=await page.locator('script[type="application/ld+json"]').allTextContents();
   let found;function scan(v){if(!v||typeof v!=='object'||found)return;if(Array.isArray(v)){v.forEach(scan);return}const type=Array.isArray(v['@type'])?v['@type']:[v['@type']];if(type.includes('Product'))found=v;else if(v['@graph'])scan(v['@graph']);}
   for(const item of raw){if(item.length>100000)continue;try{scan(JSON.parse(item))}catch{}}
   const offers=Array.isArray(found?.offers)?found.offers:[found?.offers];const offer=offers.find(o=>o&&o.priceCurrency==='USD'&&o.price!==undefined&&/^\d+(\.\d{1,2})?$/.test(String(o.price)));
   if(typeof found?.name!=='string'||!found.name.trim()||!offer||!Number.isFinite(Number(offer.price))||Number(offer.price)<=0)fail('PRODUCT_NOT_VERIFIED');
   const visible=(await page.locator('body').innerText({timeout:5000})).replace(/\s+/g,'').toLowerCase();
   const identityText=value=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
   const heading=page.locator('h1').first();if(!await heading.isVisible())fail('PRODUCT_NOT_VERIFIED');
   const visibleName=identityText(found.name),visibleIdentity=identityText(await heading.innerText({timeout:5000}));
   const amount=Number(offer.price),pricePattern=Number.isInteger(amount)?String(amount)+'(?:\\.00)?':amount.toFixed(2).replace('.','\\.');
   if(!visibleName||visibleIdentity!==visibleName||!new RegExp('(?:^|[^0-9])'+pricePattern+'(?:[^0-9]|$)').test(visible))fail('PRODUCT_NOT_VERIFIED');
   const metadataImages=(Array.isArray(found.image)?found.image:[found.image]).flatMap(v=>{const url=productImageUrl(typeof v==='string'?v:v?.url||v?.contentUrl);return url?[url]:[];});
   if(metadataImages.length)try{await page.waitForFunction(urls=>Array.from(document.querySelectorAll('img')).some(n=>typeof n.checkVisibility==='function'&&n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&getComputedStyle(n).visibility!=='collapse'&&Number(getComputedStyle(n).opacity)>0&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0&&n.complete&&n.naturalWidth>0&&urls.includes(n.currentSrc||n.src)),metadataImages,{timeout:1500})}catch{}
   const visibleImages=await page.locator('img').evaluateAll(nodes=>nodes.filter(n=>typeof n.checkVisibility==='function'&&n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&getComputedStyle(n).visibility!=='collapse'&&Number(getComputedStyle(n).opacity)>0&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0&&n.complete&&n.naturalWidth>0).map(n=>n.currentSrc||n.src));
   const imageUrl=metadataImages.find(url=>visibleImages.includes(url));
   const evidence={...(imageUrl?{image:{url:imageUrl,verification:'product_metadata_and_loaded_visible_image'}}:{}),verification:'jsonld_and_visible_text',name:found.name.slice(0,250),price:Number(offer.price),currency:'USD',url:actual,availability:typeof offer.availability==='string'?offer.availability.slice(0,150):'unknown',observedAt:new Date().toISOString()};
   return {...evidence,evidenceHash:createHash('sha256').update(JSON.stringify(evidence)).digest('hex')};
  }
 };
}
module.exports={createBrowserbase,createShoppingDriver,parseRequest,publicUrl,allowResource,deliverResource,catalogSearchPayload,productImageUrl};
