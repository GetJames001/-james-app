'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('review restores across browser sessions, keeps saved candidates after failure, and suppresses late logout reads',async()=>{
 let saved=null,saves=0,broken=false;
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/saved')return res.end(JSON.stringify(saved));
  if(req.url==='/scan'){
   if(broken){res.statusCode=503;return res.end('{}');}
   saves++;saved={checkedAt:'2026-11-05T20:00:00Z',inventoryCount:1,items:[{id:'source',subject:'Flight confirmation',sender:'Fixture airline',preview:'Review dates and timezone',reasons:['Possible itinerary — verify before import']}]};return res.end('{}');
  }
  if(req.url==='/mail-attention.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(__dirname,'..','mail-attention.js')));}
  res.setHeader('Content-Type','text/html');res.end('<main id="review"></main><script src="/mail-attention.js"></script><script>window.controller=JamesMailAttention.mount(document.querySelector("main"),{refresh:async()=>{},review:()=>{},draft:()=>{},readSaved:async()=>{const r=await fetch("/saved");return r.json();},saveReview:async()=>{const r=await fetch("/scan",{method:"POST"});if(!r.ok)throw Error();}});</script>');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch();let page=await browser.newPage();const url='http://127.0.0.1:'+server.address().port;
  await page.goto(url);assert.equal(saves,0,'mount only reads saved state');
  await page.getByRole('button',{name:'Check recent mail'}).click();await page.getByText('Flight confirmation',{exact:true}).waitFor({state:'visible'});assert.equal(saves,1);
  await page.close();page=await browser.newPage();await page.goto(url);await page.getByText('Flight confirmation',{exact:true}).waitFor({state:'visible'});assert.match(await page.locator('main').textContent(),/Saved review available across devices/);assert.equal(saves,1);
  broken=true;await page.getByRole('button',{name:'Check recent mail'}).click();await page.getByText(/may be out of date/).waitFor({state:'visible'});assert.equal(await page.locator('article').count(),1);
  await page.evaluate(()=>{window.resolveLate=null;window.late=JamesMailAttention.mount(document.querySelector('main'),{refresh:async()=>{},review:()=>{},draft:()=>{},readSaved:()=>new Promise(resolve=>window.resolveLate=resolve)});window.late.clear();window.resolveLate({checkedAt:'2026-11-05T20:00:00Z',inventoryCount:1,items:[{id:'private',subject:'Late account result',sender:'Fixture',preview:'',reasons:[]}]});});
  assert.equal(await page.getByText('Late account result',{exact:true}).count(),0);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
