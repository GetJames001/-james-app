'use strict';
// Replay already fetched anonymous CSS in CORS mode so CSSOM can inspect it.
// The caller must serve the replay from its exact-URL scoped cache, never HTTP.
async function replayOpaqueStylesheets(page,cachedUrls){
 if(!cachedUrls.length)return true;
 return page.evaluate(async allowed=>{
  const cache=new Set(allowed),opaque=[];
  for(const link of document.querySelectorAll('link[rel~="stylesheet"]')){
   if(link.disabled)continue;
   if(!link.sheet)return false;
   try{void link.sheet.cssRules}catch{
    if(!cache.has(link.href)||!link.href.startsWith('https:'))return false;
    opaque.push(link);
   }
  }
  if(opaque.length>48)return false;
  // Clones retain href, integrity, media, title, alternate status and tree order.
  // Anonymous mode never introduces browser cookies or authentication.
  return (await Promise.all(opaque.map(link=>new Promise(resolve=>{
   const copy=link.cloneNode(false);copy.crossOrigin='anonymous';
   copy.addEventListener('load',()=>resolve(true),{once:true});
   copy.addEventListener('error',()=>resolve(false),{once:true});
   link.replaceWith(copy);
  })))).every(Boolean);
 },cachedUrls);
}
module.exports={replayOpaqueStylesheets};
