const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');

const root=path.join(__dirname,'..');
const demo=fs.readFileSync(path.join(root,'customer-demo.html'),'utf8');
const gateway=fs.readFileSync(path.join(root,'api/gateway.js'),'utf8');

test('Standalone Customer Activity preview is branch locked, fictional and network-free',()=>{
 assert.match(gateway,/process\.env\.VERCEL_ENV === "preview"/);
 assert.match(gateway,/process\.env\.VERCEL_GIT_COMMIT_REF === "feature\/customer-activity-overlay-prototype-20261020"/);
 assert.match(gateway,/route === "customer-demo"/);
 assert.match(gateway,/default-src 'none'/);
 assert.match(gateway,/X-James-Demo-Only/);
 assert.doesNotMatch(demo,/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage/);
 assert.doesNotMatch(demo,/\/api\/|www\.getjames\.ai|JAMES_AUTH_PASSWORD_HASH|JAMES_SESSION_SECRET/);
 assert.match(demo,/Fictional Northside Cabinetry/);
 assert.match(demo,/No real customer data/);
});

test('Standalone fictional Customer Activity opens, saves only in-page drafts, closes, and fits devices',async()=>{
 let requests=0,posts=0;
 const server=http.createServer((req,res)=>{
  requests++;
  if(req.method!=='GET')posts++;
  if(req.url!=='/customer-demo'){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(demo);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:800}});
  await page.route('https://**',route=>route.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+'/customer-demo');
  for(const width of [320,390,820,1280]){
   await page.setViewportSize({width,height:850});
   assert.equal(await page.locator('#overlay').isVisible(),false);
   await page.locator('#open').click();
   assert.equal(await page.locator('#overlay').isVisible(),true);
   const x=await page.locator('.workspace').evaluate(el=>{const r=el.getBoundingClientRect();return {l:r.left,r:r.right,w:innerWidth}});
   assert.ok(x.l>=-1&&x.r<=x.w+1,JSON.stringify(x));
   assert.equal(await page.locator('#stops button').count(),5);
   await page.locator('#close').click();
   assert.equal(await page.locator('#open').evaluate(el=>el===document.activeElement),true);
  }
  await page.locator('#open').click();
  await page.locator('#outcome').fill('Sample notes for only this demo');
  await page.locator('#next').fill('Sample follow-up');
  await page.locator('#stops button').nth(1).click();
  assert.equal(await page.locator('#visitStatus').textContent(),'Previously visited');
  await page.locator('#stops button').first().click();
  assert.equal(await page.locator('#outcome').inputValue(),'Sample notes for only this demo');
  await page.locator('#keep').click();
  assert.match(await page.locator('#saveStatus').textContent(),/Nothing sent or permanently saved/);
  await page.keyboard.press('Escape');
  await page.locator('#open').click();
  assert.equal(await page.locator('#next').inputValue(),'Sample follow-up');
  await page.reload();
  await page.locator('#open').click();
  assert.equal(await page.locator('#outcome').inputValue(),'');
  assert.equal(requests,2);
  assert.equal(posts,0);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
