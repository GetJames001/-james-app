'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs');
const {chromium}=require('playwright');
const auth=require('../lib/auth.js'),gateway=require('../api/gateway.js');
// Synthetic identity, no hosted credentials, customer data or provider calls.
process.env.JAMES_AUTH_EMAIL='scene-browser@example.test';
process.env.JAMES_SESSION_SECRET='scene-browser-fixture-secret-over-thirty-two-characters';
test('four original MP4s decode inline through protected range handler and dissolve to Briefing',async()=>{
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/assets/scenes/')){
   req.headers.host='www.getjames.ai';req.headers.cookie=auth.SESSION_COOKIE+'='+auth.createSessionToken(process.env.JAMES_AUTH_EMAIL);
   req.query={path:pathname.slice(1)};res.status=n=>(res.statusCode=n,res);res.send=b=>res.end(b);res.json=b=>res.end(JSON.stringify(b));
   return gateway(req,res);
  }
  if(pathname==='/welcome.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync('welcome.js'));}
  res.setHeader('Content-Type','text/html');
  res.end('<style>#intro{position:fixed;inset:0}.hide{display:none}.living-scene{width:100%;height:100%}</style><section id="intro"><div class="intro-copy">JAMES</div></section><main id="app" inert>Briefing</main><script src="/welcome.js"></script><script>JamesWelcome.start()</script>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});
  for(const [hour,name] of [[8,'morning'],[13,'noon'],[18,'evening'],[23,'night']]){
   const context=await browser.newContext({viewport:{width:820,height:1180}}),page=await context.newPage();
   await page.addInitScript(hour=>{const NativeDate=Date;window.Date=class extends NativeDate{getHours(){return hour;}};},hour);
   await page.goto('http://127.0.0.1:'+server.address().port);
   const video=page.locator('video.living-scene');
   await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.videoWidth===1280&&v.currentTime>0&&!v.paused;});
   assert.match(await video.getAttribute('src'),new RegExp('/'+name+'\\.mp4$'));
   assert.equal(await video.evaluate(v=>v.muted&&v.playsInline&&v.videoHeight===720),true);
   await page.waitForFunction(()=>!document.querySelector('#app').inert);
   await page.waitForFunction(()=>!document.querySelector('video'));
   assert.equal(await page.locator('#intro').getAttribute('aria-hidden'),'true');
   await context.close();
  }
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
