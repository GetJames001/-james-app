'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
function fixture(){let allow=false,loginCalls=0;const server=http.createServer((req,res)=>{
 const route=new URL(req.url,'http://localhost').pathname;
 if(route==='/api/auth/login'){loginCalls++;res.statusCode=allow?200:401;res.setHeader('Content-Type','application/json');return res.end('{}');}
 if(route.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(route==='/api/tasks'?{tasks:[]}:route.includes('events')?{connected:false,complete:false,events:[],calendars:[]}:route.includes('mail')?{connected:false,messages:[],unreadCount:null}:{}));}
 const aliases={'/':'index.html','/login':'login.html','/login-art-dark.png':'assets/welcome-dark.png','/login-art-light.png':'assets/welcome-light.png'};
 const filename=path.resolve(root,aliases[route]||route.slice(1));
 if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(filename));
 });return {server,allow:()=>allow=true,count:()=>loginCalls};}
test('failed sign-in keeps the intro checkpoint; successful sign-in shows five-second intro then briefing in the saved theme',async()=>{
 const f=fixture();await new Promise(r=>f.server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({headless:true});for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage();await page.route('https://**',r=>r.abort());
  await page.clock.install();await page.goto('http://127.0.0.1:'+f.server.address().port+'/login');
  await page.evaluate(theme=>{localStorage.setItem('jamesTheme',theme);sessionStorage.setItem('jamesIntroDate',new Date().toDateString());},theme);await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
  assert.match(await page.locator('body').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),new RegExp('login-art-'+theme));
  for(const width of [320,820,1920]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  if(process.env.JAMES_QA_SCREENSHOTS) await page.screenshot({path:'/tmp/james-login-'+theme+'.png'});
  await page.locator('#email').fill('fictional@example.test');await page.locator('#password').fill('fictional-password');
  if(theme==='dark'){await page.locator('#submitButton').click();await page.waitForFunction(()=>document.getElementById('message').textContent.includes('could not verify'));assert.equal(await page.locator('#password').inputValue(),'');assert.equal(await page.evaluate(()=>sessionStorage.getItem('jamesIntroDate')),new Date().toDateString());f.allow();await page.locator('#password').fill('fictional-password');}
  await page.locator('#submitButton').click();await page.waitForURL('**/');
  assert.equal(await page.locator('#intro').isVisible(),true);assert.equal(await page.locator('#app').evaluate(el=>el.inert),true);
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
  await page.clock.fastForward(6000);await page.locator('#intro').waitFor({state:'hidden'});assert.equal(await page.locator('#intro').isVisible(),false);assert.equal(await page.locator('#briefing').evaluate(el=>el.classList.contains('active')),true);
  assert.equal(await page.locator('.calendar-actions #calendarDetails').count(),0);assert.equal(await page.locator('.calendar-diagnostics #calendarDetails').count(),1);
  await context.close();
 }assert.equal(f.count(),3);
 }finally{await browser?.close();f.server.closeAllConnections();await new Promise(r=>f.server.close(r));}
});
