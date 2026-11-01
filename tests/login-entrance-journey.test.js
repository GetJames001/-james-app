'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
test('login handoff requires signed-in app, continuous entrance and Briefing',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1100,height:800}});
  const page=await context.newPage(); const errors=[];let signedIn=false,appRequestsBeforeAuth=0;
  page.on('pageerror',err=>errors.push(String(err)));
  await page.route('https://james.test/**',async route=>{
   const url=new URL(route.request().url()),relative=decodeURIComponent(url.pathname);
   if(relative==='/api/auth/login'){
    if(route.request().method()==='POST') {signedIn=true;return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});}
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
   const type=filename.endsWith('.mp4')?'video/mp4':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.png')?'image/png':'text/plain';
   return route.fulfill({contentType:type,body:fs.readFileSync(full)});
  });
  await page.goto('https://james.test/login');
  assert.equal(appRequestsBeforeAuth,0,'private app must not load before login');
  await page.locator('#email').fill('example@example.test');
  await page.locator('#password').fill('test-password');
  await page.locator('#submitButton').click();
  await page.waitForTimeout(1500);
  assert.equal(appRequestsBeforeAuth,0,'private app must stay authenticated');
  assert.equal(await page.locator('#app').count(),1,'authenticated app must initialize');
  assert.equal(await page.locator('#briefing').count(),1,'Briefing must exist');
  assert.equal(errors.length,0,'browser errors: '+errors.join('; '));
  await context.close();
 }finally{await browser.close();}
});
