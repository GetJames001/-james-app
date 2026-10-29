'use strict';
const {createHash}=require('node:crypto');
const {transportUrl,currentWithin,valueWithin}=require('./public-fetch.cjs');
const fail=code=>{throw Error(code)};
const transportErrors=new Set(['PUBLIC_URL_DENIED','PUBLIC_DNS_DENIED','PUBLIC_DNS_UNCONFIRMED','PUBLIC_RESPONSE_UNVERIFIED','PUBLIC_CONTENT_UNSUPPORTED','PUBLIC_RESPONSE_TOO_LARGE','PUBLIC_REQUEST_UNCONFIRMED','TASK_INTERRUPTED']);
const identity=v=>typeof v==='string'?v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''):'';
function verifyPublicProduct(observation,{requestedUrl,observedAt}={}){
 const url=transportUrl(requestedUrl);if(transportUrl(observation?.url)!==url||transportUrl(observation?.canonical)!==url||observation.cssVerified!==true||observation.headingCount!==1||!identity(observation.heading)||!Array.isArray(observation.products)||observation.products.length>100)fail('PRODUCT_NOT_VERIFIED');
 const matches=observation.products.filter(p=>p&&identity(p.name)===identity(observation.heading)&&(!p.url||(()=>{try{return transportUrl(p.url)===url}catch{return false}})()));
 if(matches.length!==1)fail('PRODUCT_NOT_VERIFIED');const p=matches[0],offers=Array.isArray(p.offers)?p.offers:[p.offers];
 if(offers.length!==1)fail('PRODUCT_NOT_VERIFIED');const offer=offers[0];
 if(!offer||offer.priceCurrency!=='USD'||!/^\d+(?:\.\d{1,2})?$/.test(String(offer.price)))fail('PRODUCT_NOT_VERIFIED');
 const price=Number(offer.price);if(!(price>0&&price<=10000))fail('PRODUCT_NOT_VERIFIED');
 // Generic path accepts one current, visible price in Product microdata containing the heading.
 // Unsupported or ambiguous layouts stay unverified; retailer adapters may add stronger specific evidence.
 if(!Array.isArray(observation.prices)||observation.prices.length!==1||!observation.prices[0].sameProductRoot||!new RegExp('^\\$?'+price.toFixed(2).replace('.','\\.')+'$').test(observation.prices[0].text.trim()))fail('PRODUCT_NOT_VERIFIED');
 if(typeof p.name!=='string'||p.name.length>500||!Number.isFinite(Date.parse(observedAt)))fail('PRODUCT_NOT_VERIFIED');
 const metadataImages=(Array.isArray(p.image)?p.image:[p.image]).flatMap(v=>{try{return [transportUrl(typeof v==='string'?v:v?.url)]}catch{return []}});
 const image=metadataImages.find(value=>Array.isArray(observation.images)&&observation.images.some(n=>n?.url===value&&n.visible&&n.loaded));
 const receipt={name:p.name,price,currency:'USD',url,sourceHost:new URL(url).hostname,verification:'static_rendered_product_microdata_and_jsonld',observedAt,availability:'unknown',fitVerified:false,...(image?{image:{url:image,verification:'product_metadata_and_loaded_visible_image'}}:{})};
 return {...receipt,evidenceHash:createHash('sha256').update(JSON.stringify(receipt)).digest('hex')};
}
function createPublicProductReader({browser,fetchPublic,now=()=>new Date().toISOString(),timeoutMs=30000,cleanupTimeoutMs=3000}){
 if(typeof browser?.newContext!=='function'||typeof fetchPublic!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isInteger(cleanupTimeoutMs)||cleanupTimeoutMs<1||cleanupTimeoutMs>3000)fail('HOST_DEPENDENCIES_REQUIRED');
 return {async read(value,{assertCurrent,signal}={}){
  const url=transportUrl(value);if(typeof assertCurrent!=='function')fail('PUBLIC_FETCH_INVALID');
  const stopped=new AbortController(),deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),timeoutMs),activeSignal=AbortSignal.any([stopped.signal,deadline.signal,...(signal?[signal]:[])]);
  async function current(){await currentWithin(assertCurrent,activeSignal)}
  const active=operation=>valueWithin(operation,activeSignal),closures=new WeakMap();
  function closeContext(ctx){if(closures.has(ctx))return closures.get(ctx);const promise=(async()=>{let closeTimer;try{await Promise.race([Promise.resolve().then(()=>ctx.close()),new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('CLEANUP_UNCONFIRMED')),cleanupTimeoutMs)})])}catch{fail('CLEANUP_UNCONFIRMED')}finally{clearTimeout(closeTimer)}})();closures.set(ctx,promise);return promise;}
  let context,acquiring;let stage='context_setup',documentError=null;let count=0,reserved=0,styleUnconfirmed=false;
  try{
   await current();acquiring=Promise.resolve().then(()=>browser.newContext({offline:true,javaScriptEnabled:false,serviceWorkers:'block',acceptDownloads:false}));
   // A context can arrive after cancellation. Attempt bounded cleanup, but keep the
   // original read unconfirmed until the host reconciles its provider session.
   context=await active(()=>acquiring);await current();
   if(typeof context.routeWebSocket!=='function')fail('WEBSOCKET_GATE_UNAVAILABLE');await active(()=>context.routeWebSocket('**/*',socket=>socket.close()));
   await active(()=>context.route('**/*',async route=>{
    const request=route.request(),type=request.resourceType();let main=false;try{main=request.isNavigationRequest()&&request.frame().parentFrame()===null}catch{}
    const kind=main&&request.url()===url?'document':!request.isNavigationRequest()&&type==='stylesheet'?'stylesheet':!request.isNavigationRequest()&&type==='image'?'image':null;
    if(request.method()!=='GET'||!kind||++count>20){if(type==='stylesheet')styleUnconfirmed=true;return route.abort()}
    reserved+=kind==='stylesheet'?500000:2000000;if(reserved>12000000){if(type==='stylesheet')styleUnconfirmed=true;return route.abort()}
    try{await current();const response=await fetchPublic(request.url(),{kind,assertCurrent:current,signal:activeSignal});await current();await route.fulfill({status:200,contentType:response.contentType,body:response.body,headers:{'Content-Security-Policy':"default-src 'none'; style-src https: 'unsafe-inline'; img-src https:; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"}})}catch(error){if(main&&request.url()===url)documentError=transportErrors.has(error?.message)?error.message:'PUBLIC_REQUEST_UNCONFIRMED';if(type==='stylesheet')styleUnconfirmed=true;return route.abort()}
   }));
   const page=await active(()=>context.newPage());stage='document_navigation';try{await active(()=>page.goto(url,{waitUntil:'load',timeout:20000}))}catch(error){if(documentError)fail(documentError);throw error}await current();if(styleUnconfirmed)fail('PRODUCT_NOT_VERIFIED');stage='product_observation';
   const observation=await active(()=>page.evaluate(()=>{
    const visible=n=>Boolean(n&&typeof n.checkVisibility==='function'&&n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);
    const hs=Array.from(document.querySelectorAll('h1')).filter(visible),h=hs[0],products=[];let scanned=0;
    // CSP/offline failures can occur before a route callback. Require inspectable,
    // loaded stylesheets/imports; opaque or missing CSS keeps this strict path unverified.
    let cssVerified=!Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).some(n=>!n.disabled&&!n.sheet),ruleCount=0;const sheets=new Set();
    function audit(sheet){if(!sheet||sheets.has(sheet))return; sheets.add(sheet);if(sheets.size>100){cssVerified=false;return}try{for(const rule of sheet.cssRules){if(++ruleCount>5000){cssVerified=false;return}if(rule.type===CSSRule.IMPORT_RULE){if(!rule.styleSheet||!rule.href.startsWith('https:'))cssVerified=false;else audit(rule.styleSheet)}}}catch{cssVerified=false}}
    for(const sheet of document.styleSheets)if(!sheet.disabled)audit(sheet);
    function scan(v,depth=0){if(!v||typeof v!=='object'||++scanned>500||depth>8)return;if(Array.isArray(v)){for(const item of v)scan(item,depth+1);return}const types=Array.isArray(v['@type'])?v['@type']:[v['@type']];if(types.includes('Product'))products.push(v);else if(v['@graph'])scan(v['@graph'],depth+1)}
    for(const n of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0,20)){const text=n.textContent||'';if(text.length>200000)continue;try{scan(JSON.parse(text))}catch{}}
    const roots=Array.from(document.querySelectorAll('[itemscope][itemtype="https://schema.org/Product"],[itemscope][itemtype="http://schema.org/Product"]')).filter(n=>h&&n.contains(h));
    const prices=roots.length===1?Array.from(roots[0].querySelectorAll('[itemprop="price"]')).filter(n=>visible(n)&&n.closest('[itemscope][itemtype="https://schema.org/Product"],[itemscope][itemtype="http://schema.org/Product"]')===roots[0]).map(n=>({text:n.innerText,sameProductRoot:true})):[];
    return {url:location.href,canonical:document.querySelector('link[rel="canonical"]')?.href,cssVerified,headingCount:hs.length,heading:h?.innerText,products,prices,images:Array.from(document.querySelectorAll('img')).slice(0,100).map(n=>({url:n.currentSrc||n.src,visible:visible(n),loaded:n.complete&&n.naturalWidth>0}))};
   }));
   await current();return verifyPublicProduct(observation,{requestedUrl:url,observedAt:now()});
  }catch(error){const safe=Error(transportErrors.has(error?.message)||['PRODUCT_NOT_VERIFIED','WEBSOCKET_GATE_UNAVAILABLE'].includes(error?.message)?error.message:'READER_EXECUTION_UNCONFIRMED');safe.stage=stage;throw safe;}finally{stopped.abort();clearTimeout(timer);if(context)await closeContext(context);else if(acquiring){acquiring.then(ctx=>closeContext(ctx)).catch(()=>{});fail('CLEANUP_UNCONFIRMED')}}
 }};
}
module.exports={verifyPublicProduct,createPublicProductReader};
