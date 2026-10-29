'use strict';
// Server-owned retailer adapter used only through protected hosted rendering.
const {createHash}=require('node:crypto');
const fail=(reason='IDENTITY_UNVERIFIED')=>{const error=Error('PRODUCT_NOT_VERIFIED');error.reason=reason;throw error};
function productUrl(value){
 let u;try{u=new URL(value)}catch{fail()}
 if(u.protocol!=='https:'||u.hostname!=='www.target.com'||u.port||u.username||u.password||u.hash||u.pathname.includes('%')||!/^\/p\/(?:[a-z0-9-]+\/)?-\/A-\d{5,12}$/.test(u.pathname))fail();
 u.search='';return u.href;
}
function productId(value){return new URL(productUrl(value)).pathname.match(/A-(\d+)$/)[1]}
function imageUrl(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='target.scene7.com'||u.port||u.username||u.password||u.hash||!/^\/is\/image\/Target\/GUEST_[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(u.pathname))return null;
 const allowed={wid:/^\d{1,4}$/,hei:/^\d{1,4}$/,qlt:/^\d{1,3}$/,fmt:/^(?:webp|avif|jpeg|png)$/};
 for(const [key,val]of u.searchParams)if(!allowed[key]||!allowed[key].test(val))return null;
 u.search='';return u.href;}catch{return null}
}
function identity(value){return typeof value==='string'?value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''):''}
function verifyObservation(observation,{requestedUrl,observedAt=new Date().toISOString()}={}){
 const actual=productUrl(observation?.url),requested=productUrl(requestedUrl),canonical=productUrl(observation?.canonical);
 if(productId(actual)!==productId(requested)||productId(actual)!==productId(canonical))fail();
 if(observation.cssVerified!==true)fail('STYLESHEET_AUDIT_FAILED');
 const name=observation.heading;
 if(typeof name!=='string'||!name.trim()||name.length>500||!observation.headingVisible||identity(name)!==identity(observation.ogTitle))fail();
 // Read the selected product's main price only. Recommendation/old/member/range prices do not qualify.
 if(observation.priceCount!==1||!observation.priceVisible||typeof observation.priceText!=='string')fail('PRICE_UNVERIFIED');
 let selected=observation.priceText.trim();
 const parts=observation.priceParts;
 if(Array.isArray(parts)&&parts.length===3&&parts.every(p=>p?.visible===true&&typeof p.text==='string')&&parts[0].decoration==='none'&&parts[1].text.trim()==='reg'&&parts[2].decoration==='line-through'&&/^\$\d+(?:,\d{3})*\.\d{2}$/.test(parts[0].text)&&/^\$\d+(?:,\d{3})*\.\d{2}$/.test(parts[2].text)&&parts.map(p=>p.text).join('')===selected&&Number(parts[0].text.replace(/[$,]/g,''))<Number(parts[2].text.replace(/[$,]/g,'')))selected=parts[0].text;
 const match=selected.match(/^\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
 if(!match)fail('PRICE_UNVERIFIED');const price=Number(match[1].replaceAll(',','')+'.'+match[2]);
 if(!(price>0&&price<=10000)||!Number.isFinite(Date.parse(observedAt)))fail();
 const metadataImage=imageUrl(observation.ogImage);
 const photo=metadataImage&&Array.isArray(observation.images)&&observation.images.some(n=>n.visible&&n.loaded&&imageUrl(n.url)===metadataImage)?metadataImage:null;
 const receipt={retailer:'Target',verification:'canonical_product_identity_and_visible_selected_price',name:name.trim(),price,currency:'USD',url:actual,availability:'unknown',observedAt,...(photo?{image:{url:photo,verification:'product_metadata_and_loaded_visible_image'}}:{})};
 return {...receipt,evidenceHash:createHash('sha256').update(JSON.stringify(receipt)).digest('hex')};
}
// The host MUST supply a fresh protected page with deny-by-default network,
// redirect, write, iframe, WebSocket and download gates before registering this.
// This adapter verifies receipts; it does not create or secure browser sessions.
function createTargetReader(page,{now=()=>new Date().toISOString(),verifyRender=async()=>{}}={}){
 return {async read(url){
  const requested=productUrl(url);const response=await page.goto(requested,{waitUntil:'domcontentloaded',timeout:12000});
  if(!response||response.status()!==200)fail();
  productUrl(page.url());
  await page.locator('h1').first().waitFor({state:'visible',timeout:8000});
  await page.locator('[data-test="module-product-detail-price-v2"] [data-test="price-cdui-row"]').filter({hasText:/\$/}).first().waitFor({state:'visible',timeout:8000});
  await verifyRender();
  const observation=await page.evaluate(()=>{
   const visible=n=>Boolean(n&&typeof n.checkVisibility==='function'&&n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);
   const headings=Array.from(document.querySelectorAll('h1')).filter(visible),prices=Array.from(document.querySelectorAll('[data-test="module-product-detail-price-v2"] [data-test="price-cdui-row"]')).filter(n=>visible(n)&&n.innerText.includes('$')),h=headings[0],p=prices[0];
   let cssVerified=!Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).some(n=>!n.disabled&&!n.sheet),ruleCount=0;const sheets=new Set();
   function audit(sheet){if(!sheet||sheets.has(sheet))return;sheets.add(sheet);if(sheets.size>100){cssVerified=false;return}try{for(const rule of sheet.cssRules){if(++ruleCount>5000){cssVerified=false;return}if(rule.type===CSSRule.IMPORT_RULE){if(!rule.styleSheet||!rule.href.startsWith('https:'))cssVerified=false;else audit(rule.styleSheet)}}}catch{cssVerified=false}}
   for(const sheet of document.styleSheets)if(!sheet.disabled)audit(sheet);
   return {cssVerified,url:location.href,canonical:document.querySelector('link[rel="canonical"]')?.href,heading:h?.innerText,headingVisible:headings.length===1,ogTitle:document.querySelector('meta[property="og:title"]')?.content,ogImage:document.querySelector('meta[property="og:image"]')?.content,priceCount:prices.length,priceText:p?.innerText,priceParts:p?Array.from(p.querySelectorAll('span')).map(n=>({text:n.innerText,visible:visible(n),decoration:getComputedStyle(n).textDecorationLine})):[],priceVisible:visible(p),images:Array.from(document.querySelectorAll('img')).slice(0,100).map(n=>({url:n.currentSrc||n.src,visible:visible(n),loaded:n.complete&&n.naturalWidth>0}))};
  });
  return verifyObservation(observation,{requestedUrl:requested,observedAt:now()});
 }};
}
module.exports={productUrl,productId,imageUrl,verifyObservation,createTargetReader};
