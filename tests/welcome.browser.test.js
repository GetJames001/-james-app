'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.join(__dirname,'..');
function server() { return http.createServer((req,res)=>{
  const p = new URL(req.url,'http://localhost').pathname;
  if (p.startsWith('/api/')) {res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(p==='/api/tasks'?{tasks:[]}:p.includes('events')?{connected:false,events:[],calendars:[],complete:false}:p.includes('mail')?{connected:false,messages:[],unreadCount:null}:{}));}
  const f = path.resolve(root,p==='/'?'index.html':p.slice(1));
  if (!f.startsWith(root+path.sep)||!fs.existsSync(f)) {res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(f));
}); }
async function fixture(fn) {
 const s=server(); await new Promise(r=>s.listen(0,'127.0.0.1',r)); let b;
 try { b=await chromium.launch({headless:true}); await fn(b,'http://127.0.0.1:'+s.address().port); }
 finally {await b?.close();s.closeAllConnections();await new Promise(r=>s.close(r));}
}
async function pageFor(browser,url,options={}) {
 const context=await browser.newContext(options);const page=await context.newPage();
 await page.route('https://**',r=>r.abort());
 await page.addInitScript(()=>{
  try{sessionStorage.setItem('jamesCustomerMode','saved');}catch{}
  window.__speechCount=0;window.__micCount=0;
  if(window.speechSynthesis) window.speechSynthesis.speak=()=>window.__speechCount++;
  class Recognition {start(){window.__micCount++;}} window.SpeechRecognition=Recognition;
 });
 return {page,context};
}
test('welcome auto dissolves once, does not speak or write route, keeps Perspective and restores selected workspace',async()=>fixture(async(b,url)=>{
 const {page,context}=await pageFor(b,url,{viewport:{width:1280,height:850}});
 await page.addInitScript(()=>localStorage.setItem('jamesStart','Existing route'));
 await page.clock.install();await page.goto(url);
 assert.equal(await page.locator('#intro button,#intro input,#intro .orb').count(),0);
 assert.equal(await page.locator('#app').evaluate(e=>e.inert),true);
 await page.clock.fastForward(4900);assert.equal(await page.locator('#intro').isVisible(),true);
 await page.clock.fastForward(900);await page.locator('#intro').waitFor({state:'hidden'});
 assert.equal(await page.locator('#app').evaluate(e=>e.inert),false);
 assert.equal(await page.evaluate(()=>localStorage.getItem('jamesStart')),'Existing route');
 assert.equal(await page.evaluate(()=>window.__speechCount+window.__micCount),0);
 await page.locator('#perspectiveRevisit summary').click();
 assert.equal(await page.locator('#perspectiveBriefText').textContent(),await page.locator('#perspectiveIntroText').textContent());
 await page.locator('nav [data-page="tasks"]').click();await page.reload();
 assert.equal(await page.locator('#intro').isVisible(),false);
 assert.equal(await page.locator('#tasks').evaluate(e=>e.classList.contains('active')),true);
 await context.close();
}));
test('light and dark share layout, theme survives reload, narrow and short welcome fits',async()=>fixture(async(b,url)=>{
 const {page,context}=await pageFor(b,url);await page.clock.install();await page.goto(url);
 for(const [width,height] of [[320,780],[390,844],[820,1180],[1280,850],[844,390]]) {
  await page.setViewportSize({width,height});
  for(const theme of ['light','dark']) {
   await page.evaluate(theme=>JamesWelcome.applyTheme(theme),theme);
   assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
   const box=await page.locator('#intro .intro-copy').boundingBox();assert.ok(box.x>=0&&box.width<=width+1);
   assert.equal(await page.evaluate(()=>document.querySelector('#intro').scrollWidth<=innerWidth),true);
  }
 }
 await page.evaluate(()=>JamesWelcome.finish());await page.clock.fastForward(1000);
 await page.locator('#jamesThemeToggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 await context.close();
}));
test('reduced motion skips welcome while perspective stays accessible; theme remains switchable',async()=>fixture(async(b,url)=>{
 const {page,context}=await pageFor(b,url,{reducedMotion:'reduce'});await page.goto(url);
 assert.equal(await page.locator('#intro').isVisible(),false);assert.equal(await page.locator('#app').evaluate(e=>e.inert),false);
 await page.locator('#perspectiveRevisit summary').click();assert.equal(await page.locator('#perspectiveBriefText').isVisible(),true);
 assert.equal(await page.evaluate(()=>window.__speechCount+window.__micCount),0);
 await context.close();
}));
test('welcome tolerates denied browser storage, repeat start and repeated finish',async()=>fixture(async(b,url)=>{
 const {page,context}=await pageFor(b,url);await page.goto(url);
 // Isolate module from pre-existing app storage access; module must fail open safely.
 await page.evaluate(()=>{
  Object.defineProperty(window,'sessionStorage',{get(){throw Error('denied');},configurable:true});
  Object.defineProperty(window,'localStorage',{get(){throw Error('denied');},configurable:true});
  JamesWelcome.start();JamesWelcome.finish();JamesWelcome.finish();
 });
 await page.locator('#intro').waitFor({state:'hidden'});assert.equal(await page.locator('#app').evaluate(e=>e.inert),false);
 await page.locator('#jamesThemeToggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 await context.close();
}));
test('first-render welcome greeting matches afternoon and evening without a minute delay',async()=>fixture(async(b,url)=>{
 for(const [hour,expected] of [[14,'Good afternoon, Michael.'],[20,'Good evening, Michael.']]){
  const {page,context}=await pageFor(b,url);await page.clock.install({time:new Date(2026,9,21,hour)});await page.goto(url);
  assert.equal(await page.locator('#introGreeting').textContent(),expected);await context.close();
 }
}));

test('Customer Activity follows both themes and preserves its unsaved note across theme and workspace switches',async()=>fixture(async(b,url)=>{
 const {page,context}=await pageFor(b,url,{reducedMotion:'reduce'});
 await page.route('**/api/customer-activity',r=>r.fulfill({json:{ok:true,document:{schemaVersion:2,revision:1,customers:[{id:'fictional-company',name:'Fictional Company',contacts:[],contact:'',phone:'',address:'',source:'manual',sourceRef:''}],activities:[]}}}));
 await page.goto(url);
 await page.locator('#customerActivityOpen').click();
 await page.locator('#customerDemoOutcome').fill('Fictional draft — no visit reported');
 for(const theme of ['light','dark']) {
  await page.evaluate(theme=>JamesWelcome.applyTheme(theme),theme);
  const colors=await page.locator('.customer-workspace').evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
  assert.equal(colors.background,theme==='light'?'rgb(250, 247, 241)':'rgb(16, 36, 59)');
  assert.notEqual(colors.background,colors.color);
  assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'Fictional draft — no visit reported');
 }
 await page.locator('#customerActivityClose').click();
 assert.equal(await page.locator('#customerClosePrompt').isVisible(),true);
 await page.locator('#customerKeepEditing').click();
 assert.equal(await page.locator('#customerActivityOverlay').isVisible(),true);
 assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'Fictional draft — no visit reported');
 await context.close();
}));


test('Mail distinguishes a disconnected workspace from a verified empty inbox, and clears the connection notice on recovery',async()=>fixture(async(b,url)=>{
 const {page,context}=await pageFor(b,url,{reducedMotion:'reduce'});await page.goto(url);
 await page.evaluate(()=>applyPersonalMicrosoftMail({connected:false,unreadCount:null,messages:[]}));
 assert.equal(await page.locator('#personalEmailCount').textContent(),'Not connected');
 assert.match(await page.locator('#personalMailMessages').textContent(),/not connected in this workspace/);
 assert.doesNotMatch(await page.locator('#personalMailMessages').textContent(),/No recent messages/);
 await page.evaluate(()=>applyPersonalMicrosoftMail({connected:true,unreadCount:0,messages:[]}));
 assert.equal(await page.locator('#personalEmailCount').textContent(),'0 unread');
 assert.match(await page.locator('#personalMailMessages').textContent(),/No recent messages/);
 assert.doesNotMatch(await page.locator('.mail-state-notice').first().textContent(),/not connected/);
 await context.close();
}));
