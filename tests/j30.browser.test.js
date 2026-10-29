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
 const browser=await chromium.launch();try{const context=await browser.newContext();const page=await context.newPage();await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<h1>Loading fixture</h1><script>setTimeout(()=>{document.body.insertAdjacentHTML("beforeend",\'<a href="/us/en/p/delayed-fixture/">Delayed</a>\')},250)</script>'}));const driver=createShoppingDriver(page);const links=await driver.search(origin+'/us/en/search/?q=lamps');assert.deepEqual(links,[origin+'/us/en/p/delayed-fixture/']);assert.equal(driver.diagnostics().productLinkCount,1);assert.equal(driver.diagnostics().waitTimedOut,false);assert.ok(driver.diagnostics().bodyCharacters>0);assert.equal(typeof driver.diagnostics().pageTitle,'string');assert.ok(driver.diagnostics().publicPageExcerpt.length<=500);assert.deepEqual(driver.diagnostics().deniedResources,[])}finally{await browser.close()}
});
test('browser resource gate permits static-script and public-search hydration while blocking account and write traffic',async()=>{
 const {allowResource}=require('../j30/browserbase.cjs');const browser=await chromium.launch();try{const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),allowed=[],denied=[];
 await context.route('**/*',async route=>{const req=route.request();let mainDocument=false;try{mainDocument=req.isNavigationRequest()&&req.frame().parentFrame()===null}catch{}const url=new URL(req.url());if(!allowResource({url:req.url(),method:req.method(),type:req.resourceType(),mainDocument,authorizedSearch:req.headers()['content-type']==='application/json'})){denied.push(url.hostname);return route.abort()}allowed.push(url.hostname+url.pathname);let body,contentType='text/html';
 if(url.pathname==='/us/en/search/')body='<h1>Fixture search</h1><script src="/global/assets/dwf/listing/v2/fixture.js"></script>';
 else if(url.hostname==='sik.search.blue.cdtapps.com'){body=JSON.stringify({products:['fixture-one','fixture-two']});contentType='application/json'}
 else{body='fetch("https://accounts.ikea.com/blocked").catch(()=>{});fetch("https://sik.search.blue.cdtapps.com/us/en/search",{method:"POST",body:"blocked"}).catch(()=>{});fetch("https://sik.search.blue.cdtapps.com/us/en/search?q=lamps",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({searchParameters:{input:"desk lamps",type:"QUERY"}})}).then(r=>r.json()).then(v=>{for(const name of v.products){const a=document.createElement("a");a.href="/us/en/p/"+name+"/";a.textContent=name;document.body.append(a)}})';contentType='text/javascript'}
 return route.fulfill({contentType,headers:{'Access-Control-Allow-Origin':origin},body});});
 const links=await createShoppingDriver(page).search(origin+'/us/en/search/?q=lamps');assert.equal(links.length,2);assert.ok(allowed.includes('www.ikea.com/global/assets/dwf/listing/v2/fixture.js'));assert.ok(allowed.includes('sik.search.blue.cdtapps.com/us/en/search'));assert.ok(denied.includes('accounts.ikea.com'));assert.ok(denied.includes('sik.search.blue.cdtapps.com'));
 }finally{await browser.close()}
});
test('actual HTTP redirect is not followed from an accepted resource into a blocked destination',async()=>{
 const http=require('node:http'),{deliverResource}=require('../j30/browserbase.cjs');let outside=0;
 const server=http.createServer((req,res)=>{if(req.url==='/outside'){outside++;res.end('must not load')}else{res.writeHead(302,{Location:'/outside'});res.end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const upstream='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch();try{const context=await browser.newContext(),page=await context.newPage();let denied=0;
 await context.route('**/*',route=>deliverResource({fetch:options=>context.request.get(upstream+'/asset',options),abort:()=>{denied++;return route.abort()},fulfill:options=>route.fulfill(options)}));
 await assert.rejects(page.goto(origin+'/global/assets/dwf/listing/v2/redirect.js'));assert.equal(denied,1);assert.equal(outside,0);
 }finally{await browser.close();await new Promise(r=>server.close(r))}
});
test('product verification normalizes punctuation but requires the full matching variant and price',async()=>{const browser=await chromium.launch();try{const context=await browser.newContext(),page=await context.newPage();let color='dark gray';await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<h1>TERTIAL Work lamp, '+color+'</h1><p>Price $19.99</p><script type="application/ld+json">{"@type":"Product","name":"TERTIAL Work lamp - dark gray","offers":{"price":"19.99","priceCurrency":"USD"}}</script>'}));const driver=createShoppingDriver(page);assert.equal((await driver.read(origin+'/us/en/p/tertial-fixture/')).price,19.99);color='light blue';await assert.rejects(driver.read(origin+'/us/en/p/tertial-fixture/'),/PRODUCT_NOT_VERIFIED/);color='dark gray white';await assert.rejects(driver.read(origin+'/us/en/p/tertial-fixture/'),/PRODUCT_NOT_VERIFIED/)}finally{await browser.close()}});

test('product photo requires matching metadata and a loaded visible image',async()=>{
 const browser=await chromium.launch();try{const context=await browser.newContext(),page=await context.newPage();let matching=true,hidden=false,parentHidden=false;
 const image=origin+'/us/en/images/products/fixture-lamp__123.jpg';
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.pathname.endsWith('.jpg'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 return route.fulfill({contentType:'text/html',body:'<h1>Fixture lamp</h1><p>$19.99</p><div style="'+(parentHidden?'opacity:0':'')+'"><img style="'+(hidden?'visibility:hidden':'')+'" src="'+image+'?f=s" width="100" height="100"></div><script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Fixture lamp',image:matching?image:origin+'/us/en/images/products/different.jpg',offers:{price:'19.99',priceCurrency:'USD'}})+'</script>'});});
 const driver=createShoppingDriver(page);await page.goto(origin+'/us/en/p/fixture/');await page.waitForLoadState('load');
 const first=await driver.read(origin+'/us/en/p/fixture/');assert.equal(first.image?.url,image);assert.equal(first.image?.verification,'product_metadata_and_loaded_visible_image');
 matching=false;const second=await driver.read(origin+'/us/en/p/fixture/');assert.equal(second.image,undefined);matching=true;hidden=true;const third=await driver.read(origin+'/us/en/p/fixture/');assert.equal(third.image,undefined);hidden=false;parentHidden=true;const fourth=await driver.read(origin+'/us/en/p/fixture/');assert.equal(fourth.image,undefined);
 }finally{await browser.close();}
});
