'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');

function testServer(){
 return http.createServer((req,res)=>{
  const uri=new URL(req.url,'http://localhost');
  if(uri.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(uri.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   if(uri.pathname==='/api/google/events')return res.end('{"connected":false,"events":[],"calendars":[],"complete":false}');
   if(uri.pathname==='/api/microsoft/mail')return res.end('{"connected":false,"messages":[],"unreadCount":null}');
   return res.end('{}');
  }
  const file=path.join(root,uri.pathname==='/'?'index.html':uri.pathname.slice(1));
  if(!file.startsWith(root)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  res.end(fs.readFileSync(file));
 });
}

test('daily Perspective attribution is explicit; checked quote and originals never misattributed',()=>{
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(app,/Seek first to understand, then to be understood\./);
 assert.match(app,/Stephen R\. Covey/);
 assert.match(app,/The 7 Habits of Highly Effective People · Habit 5/);
 assert.match(app,/Original reflection/);
 assert.match(app,/jamesPerspectiveForDate/);
 assert.match(html,/id="perspectiveIntro"/);
 assert.match(html,/id="perspectiveRevisit"/);
 assert.doesNotMatch(app,/fetch\([^)]*perspective/i);
});

test('intro and briefing show same daily perspective, no navigation regression, narrow devices fit',async()=>{
 const server=testServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:820,height:820}});
  const page=await context.newPage();
  await page.route('https://**',r=>r.abort());
  const address='http://127.0.0.1:'+server.address().port;
  await page.goto(address);
  const intro=page.locator('#perspectiveIntroText');
  await intro.waitFor();
  const today=await intro.textContent();
  assert.ok(today.length>20);
  assert.equal(await page.locator('#perspectiveIntroAuthor').textContent(),await page.locator('#perspectiveBriefAuthor').textContent());
  assert.equal(today,await page.locator('#perspectiveBriefText').textContent());
  assert.equal(await page.locator('#routePrompt').count(),0);
  assert.equal(await page.locator('#intro button, #intro input, #intro textarea').count(),0);
  await page.locator('#intro').waitFor({state:'hidden'});
  assert.equal(await page.locator('#briefing').evaluate(el=>el.classList.contains('active')),true);
  const revisit=page.locator('#perspectiveRevisit');
  await revisit.locator('summary').click();
  assert.equal(await revisit.locator('blockquote').isVisible(),true);
  assert.equal(await revisit.locator('blockquote').textContent(),today);
  await page.locator('nav [data-page="tasks"]').click();
  await page.locator('nav [data-page="briefing"]').click();
  assert.equal(await revisit.locator('blockquote').textContent(),today);
  await page.reload();
  assert.equal(await page.locator('#intro').isVisible(),false,'same-day intro is not repeated');
  assert.equal(await page.locator('#perspectiveBriefText').textContent(),today,'same day selection is stable after refresh');
  const texts=await page.evaluate(()=>{
   const today=new Date();
   return [jamesPerspectiveForDate(today).text,jamesPerspectiveForDate(new Date(today.getFullYear(),today.getMonth(),today.getDate()+1)).text];
  });
  assert.notEqual(texts[0],texts[1],'a new local day rotates the perspective');
  // A tablet can remain open overnight: reopening the words must use today.
  await page.clock.setFixedTime(new Date(2026,9,21,12));
  await page.reload();
  if(await page.locator('#intro').isVisible()){
   await page.locator('#intro').waitFor({state:'hidden'});
  }
  const previousDay=await page.locator('#perspectiveBriefText').textContent();
  await page.clock.setFixedTime(new Date(2026,9,22,12));
  await revisit.locator('summary').click();
  const nextDay=await page.evaluate(()=>jamesPerspectiveForDate(new Date()).text);
  assert.notEqual(nextDay,previousDay);
  await page.waitForFunction(text=>document.getElementById('perspectiveBriefText').textContent===text,nextDay,{timeout:3000});
  assert.equal(await page.locator('#perspectiveBriefText').textContent(),nextDay,'reopen after midnight refreshes displayed words');
  await page.clock.setFixedTime(new Date(2026,9,23,12));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.equal(await page.locator('#perspectiveBriefText').textContent(),await page.evaluate(()=>jamesPerspectiveForDate(new Date()).text),'resuming a tab refreshes the day');
  assert.equal(await page.locator('#intro').isVisible(),false,'refresh never replays the intro');
  for(const width of [320,390,820,1280]){
   await page.setViewportSize({width,height:780});
   const m=await page.locator('#perspectiveRevisit').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}});
   assert.ok(m.left>=-1 && m.right<=width+1,JSON.stringify(m));
  }
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
