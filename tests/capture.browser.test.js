const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
test('iPad capture requires confirmation, preserves retry identity, safely displays records and labels appointment drafts',async()=>{
 let records=[],attempts=[],failNext=true;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(url.pathname==='/api/capture'){
    if(req.method==='GET')return res.end(JSON.stringify({records}));
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const mutation=JSON.parse(body);attempts.push(mutation);if(failNext){failNext=false;res.statusCode=503;return res.end('{}');}const timestamp=new Date().toISOString();const record={...mutation.record,id:mutation.id,revision:mutation.expectedRevision+1,createdAt:timestamp,updatedAt:timestamp};records=records.filter(r=>r.id!==record.id).concat(record);res.end(JSON.stringify({saved:true,record}));});return;
   }
   if(url.pathname==='/api/google/events')return res.end('{"connected":true,"complete":true,"events":[],"calendars":[]}');
   if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   return res.end('{"connected":false,"unreadCount":0,"messages":[]}');
  }
  const file=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));try{res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:768},timezoneId:'America/Los_Angeles'});
  await page.route('https://**',route=>route.abort());await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('#captureStatus').textContent.includes('records loaded'));
  await page.evaluate(()=>{document.querySelector('#intro')?.classList.add('hide');document.querySelector('nav button[data-page="capture"]').click();});
  const title='<img src=x onerror="window.captureInjected=true">';
  await page.locator('#captureForm [name=title]').fill(title);await page.locator('#captureForm button[type=submit]').click();assert.equal(attempts.length,0);assert.equal(await page.locator('#captureConfirm').isVisible(),true);
  await page.locator('#captureSave').click();await page.waitForFunction(()=>document.querySelector('#captureStatus').textContent.includes('Retry Save'));
  await page.locator('#captureBack').click();assert.match(await page.locator('#captureStatus').textContent(),/may already exist/);assert.equal(await page.locator('#captureConfirm').isVisible(),true);
  await page.locator('#captureSave').click();await page.waitForFunction(()=>document.querySelector('#captureStatus').textContent.includes('Saved in James'));
  assert.equal(attempts.length,2);assert.deepEqual(attempts[0],attempts[1]);assert.equal(await page.evaluate(()=>Boolean(window.captureInjected)),false);assert.ok((await page.locator('#captureList').textContent()).includes(title));
  await page.locator('#captureList button').first().click();await page.locator('#captureForm [name=status]').selectOption('completed');await page.locator('#captureForm button[type=submit]').click();await page.locator('#captureSave').click();await page.waitForFunction(()=>document.querySelector('#captureList').textContent.includes('completed'));assert.equal(records[0].revision,2);assert.equal(await page.locator('#captureCallbackCount').textContent(),'0');
  await page.locator('#captureNew').click();await page.locator('#captureForm [name=type]').selectOption('appointment_draft');await page.locator('#captureForm [name=domain]').selectOption('personal');await page.locator('#captureForm [name=title]').fill('Synthetic personal appointment');await page.locator('#captureForm [name=start]').fill('2026-10-07T09:00');await page.locator('#captureForm [name=end]').fill('2026-10-07T10:00');await page.locator('#captureForm button[type=submit]').click();assert.match(await page.locator('#captureReview').textContent(),/Not added to Google Calendar/);await page.locator('#captureSave').click();await page.waitForFunction(()=>document.querySelector('#captureList').textContent.includes('Synthetic personal appointment'));
  assert.match(await page.locator('#captureList').textContent(),/America\/Los_Angeles.*Not added to Google Calendar/);
  await page.locator('#captureForm [name=filter]').selectOption('personal');assert.equal((await page.locator('#captureList').textContent()).includes(title),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  if(process.env.JAMES_CAPTURE_SCREENSHOT)await page.screenshot({path:process.env.JAMES_CAPTURE_SCREENSHOT,fullPage:true,animations:'disabled'});
  await page.evaluate(()=>JamesCapture.stop());assert.equal(await page.locator('#captureList').textContent(),'');assert.match(await page.locator('#captureStatus').textContent(),/session ended/);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});
