'use strict';
// Real Chromium, intercepted synthetic merchant pages. No Browserbase or retailer call.
const test=require('node:test'),assert=require('node:assert/strict');const {chromium}=require('playwright');
const {createShoppingDriver}=require('../j30/browserbase.cjs');
const origin='https://www.ikea.com';
test('real browser discovers product links and verifies names/prices against rendered page content',async()=>{
 const browser=await chromium.launch();try{
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});const page=await context.newPage();const visits=[];
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());visits.push({method:request.method(),path:url.pathname});assert.equal(url.origin,origin);assert.equal(request.method(),'GET');let html;
   if(url.pathname==='/us/en/search/')html='<h1>Fixture lamps</h1><a href="/us/en/p/lamp-one/">One</a><a href="/us/en/p/lamp-two/">Two</a><a href="https://evil.test/checkout">Ignore</a><a href="/us/en/cart/">Cart</a>';
   else {const second=url.pathname.includes('two');const product={'@context':'https://schema.org','@type':'Product',name:second?'Fixture lamp Two':'Fixture lamp One',offers:{price:second?'24.99':'19.99',priceCurrency:'USD',availability:'https://schema.org/InStock'}};html='<h1>'+product.name+'</h1><p>$'+product.offers.price+'</p><script type="application/ld+json">'+JSON.stringify(product)+'</script>';}
   await route.fulfill({contentType:'text/html',body:html});
  });
  const driver=createShoppingDriver(page),links=await driver.search(origin+'/us/en/search/?q=lamps');assert.equal(links.length,2);const a=await driver.read(links[0]),b=await driver.read(links[1]);assert.equal(a.price,19.99);assert.equal(b.price,24.99);assert.equal(a.verification,'jsonld_and_visible_text');assert.match(a.evidenceHash,/^[a-f0-9]{64}$/);assert.equal(visits.length,3);
 }finally{await browser.close();}
});
test('real browser rejects hidden/stale price metadata and site verification challenges',async()=>{
 const browser=await chromium.launch();try{
  const context=await browser.newContext();const page=await context.newPage();let blocked=false;
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:blocked?'<h1>Verify you are human</h1>':'<h1>Fixture lamp</h1><p>$99.99</p><script type="application/ld+json">{"@type":"Product","name":"Fixture lamp","offers":{"price":"19.99","priceCurrency":"USD"}}</script>'}));
  const driver=createShoppingDriver(page);await assert.rejects(driver.read(origin+'/us/en/p/lamp/'),/PRODUCT_NOT_VERIFIED/);blocked=true;await assert.rejects(driver.read(origin+'/us/en/p/lamp/'),/SITE_REQUIRES_USER_REVIEW/);
 }finally{await browser.close();}
});
test('discovery waits for asynchronously rendered products and records bounded diagnostics',async()=>{
 const browser=await chromium.launch();try{const context=await browser.newContext();const page=await context.newPage();await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<h1>Loading fixture</h1><script>setTimeout(()=>{document.body.insertAdjacentHTML("beforeend",\'<a href="/us/en/p/delayed-fixture/">Delayed</a>\')},250)</script>'}));const driver=createShoppingDriver(page);const links=await driver.search(origin+'/us/en/search/?q=lamps');assert.deepEqual(links,[origin+'/us/en/p/delayed-fixture/']);assert.equal(driver.diagnostics().productLinkCount,1);assert.equal(driver.diagnostics().waitTimedOut,false);assert.ok(driver.diagnostics().bodyCharacters>0)}finally{await browser.close()}
});
