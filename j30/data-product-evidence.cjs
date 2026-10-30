'use strict';
// Retailer-independent selected-product evidence; never search-snippet prices.
const fail=reason=>{const error=Error('PRODUCT_NOT_VERIFIED');error.reason=reason;throw error};
const amount=value=>(typeof value==='number'&&Number.isFinite(value)||typeof value==='string')&&/^\d+(?:\.\d{1,2})?$/.test(String(value))?Number(value):NaN;
const conditional=/\b(?:members?|membership|coupon|code|installments?|months?|monthly|payments?|subscribe|subscription|from|starting|as low|with purchase)\b/i;
function verifyDataProduct(product,evidence){
 if(typeof product?.sku!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(product.sku)||!evidence||evidence.id!==product.sku||evidence.rootCount!==1||evidence.headingRootCount!==1)fail('IDENTITY_UNVERIFIED');
 if(Array.isArray(product.offers)||!product.offers||typeof product.offers!=='object'||product.offers.priceCurrency!=='USD')fail('PRICE_UNVERIFIED');
 const offer=product.offers;let price;
 if(offer['@type']==='AggregateOffer'){
  const low=amount(offer.lowPrice),high=amount(offer.highPrice);
  if(low!==high||offer.offers!==undefined||offer.price!==undefined)fail('PRICE_UNVERIFIED');price=low;
 }else if(offer['@type']===undefined||offer['@type']==='Offer')price=amount(offer.price);else fail('PRICE_UNVERIFIED');
 if(!(price>0&&price<=10000)||!Array.isArray(evidence.prices)||evidence.prices.length!==1)fail('PRICE_UNVERIFIED');
 const visible=evidence.prices[0],text='$'+price.toFixed(2);
 if(typeof evidence.rootContext!=='string'||evidence.rootContext.length>8000||conditional.test(evidence.rootContext))fail('PRICE_UNVERIFIED');
 if(!visible||visible.sameProductRoot!==true||visible.text!==text||!Array.isArray(visible.currentAmounts)||visible.currentAmounts.length!==1||visible.currentAmounts[0]!==text||typeof visible.context!=='string'||visible.context.length>500||conditional.test(visible.context))fail('PRICE_UNVERIFIED');
 return price;
}
module.exports={verifyDataProduct};
