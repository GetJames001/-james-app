'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('mail checks on opening and every 30 visible seconds across pages; foreground return is immediate and drafts survive',async()=>{
 let urgent=false,scans=0,saved=null,mailGets=0;
 const message=()=>({id:'urgent',subject:'Action required: confirm today',sender:'Fixture',preview:'Please respond',body:'<p>Confirm the appointment.</p>',importance:'high',isRead:true});
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');
   if(url.pathname==='/api/attention/scan'){scans++;saved={checkedAt:new Date().toISOString(),revision:scans,inventoryCount:urgent?1:0,stale:false,sources:{hotmail:{checkedAt:new Date().toISOString(),stale:false},gmail:{checkedAt:new Date().toISOString(),stale:false}},items:urgent?[{id:'urgent',reviewKey:'a'.repeat(64),subject:message().subject,sender:'Fixture',preview:'Please respond',reasons:['Message explicitly requests a response']}]:[],handledItems:[]};return res.end('{"saved":true}');}
   if(url.pathname==='/api/attention')return res.end(JSON.stringify({schemaVersion:1,status:'available',revision:Math.max(scans,1),attentionItems:[],needsReview:[],coverage:[],sourceHealth:[],mailReview:saved}));
   if(url.pathname==='/api/microsoft/mail'){mailGets++;return res.end(JSON.stringify({connected:true,unreadCount:urgent?1:0,messages:urgent?[message()]:[],attachments:[]}));}
   if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');if(url.pathname==='/api/auth/session')return res.end('{"ok":true,"authenticated":true}');return res.end('{"connected":false}');
  }
  const file=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:768}});await page.route('https://**',r=>r.abort());await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.querySelector('#mailAttentionView').textContent.includes('No suggestions need your review'));assert.ok(scans>=1);assert.equal(await page.locator('#briefing.active').count(),1);
  urgent=true;const before=scans;await page.clock.fastForward(30000);await page.locator('#mailAttentionView article').waitFor({state:'attached'});assert.ok(scans>before);assert.match(await page.locator('nav [data-page=attention]').getAttribute('class'),/has-attention/);assert.equal(await page.locator('#briefing.active').count(),1);
  await page.evaluate(()=>window.page('personalMail'));await page.locator('[data-message-id=urgent]').click();await page.locator('#personalMailReplyButton').click();await page.locator('#personalMailReplyText').fill('Keep this unsent draft');await page.clock.fastForward(30000);await page.waitForFunction(()=>!document.querySelector('#mailAttentionView button').disabled);assert.equal(await page.locator('#personalMailReplyText').inputValue(),'Keep this unsent draft');
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});const hiddenScans=scans;await page.clock.fastForward(60000);assert.equal(scans,hiddenScans);
  const foregroundScan=page.waitForRequest(request=>request.url().includes('/api/attention/scan'));await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});await foregroundScan;await page.waitForFunction(()=>document.querySelector('#mailAttentionView button')?.disabled===false);assert.ok(scans>hiddenScans);assert.ok(mailGets>=3);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
