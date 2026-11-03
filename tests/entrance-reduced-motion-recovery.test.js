'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
test('reduced motion and failed login recover to usable Briefing',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:820,height:1180},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage(); const errors=[];let signedIn=false,appRequestsBeforeAuth=0,attempts=0;
  page.on('pageerror',err=>errors.push(String(err)));
  await page.route('https://james.test/**',async route=>{
   const url=new URL(route.request().url()),relative=decodeURIComponent(url.pathname);
   if(relative==='/api/auth/login'){
    if(route.request().method()==='POST') {attempts++;if(attempts===1)return route.fulfill({status:401,contentType:'application/json',body:'{"ok":false}'});signedIn=true;return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});}
    return route.fulfill({status:405});
   }
   if(relative==='/'||relative==='/index.html'){
    if(!signedIn){appRequestsBeforeAuth++;return route.fulfill({status:401,body:'Unauthorized'});}
    return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'index.html'),'utf8')});
   }
   if(relative==='/login'||relative==='/login.html')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'login.html'),'utf8')});
   let filename=relative.replace(/^\//,'');
   if(filename.startsWith('login-scene-'))filename='assets/scenes/'+filename.replace('login-scene-','');
   if(filename==='login-art-dark.png')filename='assets/welcome-dark.png';
   if(filename==='login-art-light.png')filename='assets/welcome-light.png';
   const full=path.resolve(root,filename);
   if(!full.startsWith(root+path.sep)||!fs.existsSync(full)||!fs.statSync(full).isFile())return route.fulfill({status:404});
   const type=filename.endsWith('.mp4')?'video/mp4':(filename.endsWith('.js')||filename.endsWith('.mjs'))?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.png')?'image/png':'text/plain';
   return route.fulfill({contentType:type,body:fs.readFileSync(full)});
  });
  await page.goto('https://james.test/login');
  assert.equal(appRequestsBeforeAuth,0,'private app must not load before login');
  assert.equal(await page.locator('#loginScene').getAttribute('src'),null,'reduced motion must not request video');
  await page.locator('#email').fill('example@example.test');
  await page.locator('#password').fill('wrong-password');
  await page.locator('#submitButton').click();
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent.includes('could not verify'));
  assert.equal(await page.locator('#password').inputValue(),'','failed login clears password');
  assert.equal(await page.locator('#app').count(),0,'failed login must not expose app');
  await page.locator('#password').fill('right-password');
  await page.locator('#submitButton').click();
  await page.waitForFunction(()=>location.pathname==='/'&&document.querySelector('#intro')?.getAttribute('aria-hidden')==='true',null,{timeout:15000});
  assert.equal(attempts,2,'one failed then one successful authentication');
  assert.equal(await page.locator('#app').evaluate(e=>e.inert),false,'app must be interactive');
  assert.equal(await page.locator('#briefing').isVisible(),true,'Briefing must be visible');
  assert.equal(await page.locator('#loginScene').evaluate(v=>!v.currentSrc&&!v.getAttribute('src')&&v.paused),true,'reduced-motion video must remain inert with no source or playback');
  await page.locator('#loginScene').waitFor({state:'detached',timeout:2500});
  assert.equal(errors.length,0,'browser errors: '+errors.join('; '));
  await context.close();
 }finally{await browser.close();}
});
