'use strict';
const {currentWithin,valueWithin}=require('./public-fetch.cjs');
// Replay already fetched anonymous CSS in CORS mode so CSSOM can inspect it.
// The caller must serve the replay from its exact-URL scoped cache, never HTTP.
async function replayOpaqueStylesheets(page,cachedUrls,{signal,assertCurrent}={}){
 if(!cachedUrls.length)return true;
 if(!signal||typeof assertCurrent!=='function')throw Error('PUBLIC_FETCH_INVALID');
 await currentWithin(assertCurrent,signal);
 const started=await valueWithin(()=>page.evaluate(allowed=>{
  const cache=new Set(allowed),opaque=[];
  for(const link of document.querySelectorAll('link[rel~="stylesheet"]')){
   if(link.disabled)continue;
   if(!link.sheet)return {ok:false};
   try{void link.sheet.cssRules}catch{
    if(!cache.has(link.href)||!link.href.startsWith('https:'))return {ok:false};
    opaque.push(link);
   }
  }
  if(opaque.length>48)return {ok:false};
  // Clones retain href, integrity, media, title, alternate status and tree order.
  // Anonymous mode never introduces browser cookies or authentication.
  for(const link of opaque){
   const copy=link.cloneNode(false);copy.crossOrigin='anonymous';
   link.replaceWith(copy);
  }
  return {ok:true,changed:opaque.length>0};
 },cachedUrls),signal);
 if(!started?.ok)return false;if(!started.changed)return true;
 // Page event callbacks are disabled alongside merchant JavaScript. Poll from
 // the trusted driver instead, under the same cancellation/deadline guard.
 for(let attempt=0;attempt<40;attempt++){
  await currentWithin(assertCurrent,signal);
  if(await valueWithin(()=>page.evaluate(()=>Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).filter(n=>!n.disabled).every(n=>{try{return Boolean(n.sheet&&n.sheet.cssRules)}catch{return false}})),signal))return true;
  let timer;try{await valueWithin(()=>new Promise(resolve=>{timer=setTimeout(resolve,50)}),signal)}finally{clearTimeout(timer)}
 }
 return false;
}
module.exports={replayOpaqueStylesheets};
