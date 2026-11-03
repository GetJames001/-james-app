'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {webkit}=require('playwright');
const root=path.resolve(__dirname,'..');
test('login video is visibly dimmed by overlay above the video and below the panel',async()=>{
 const browser=await webkit.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:820,height:1180}});
  await page.route('https://james.test/**',route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/login')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'login.html'))});
    const files={'/login-art-dark.png':'assets/welcome-dark.png','/login-art-light.png':'assets/welcome-light.png'};
    const filename=files[pathname]||(pathname.startsWith('/login-scene-')?'assets/scenes/'+pathname.slice('/login-scene-'.length):null);
    if(!filename)return route.fulfill({status:404});
    return route.fulfill({contentType:filename.endsWith('.mp4')?'video/mp4':'image/png',body:fs.readFileSync(path.join(root,filename))});
  });
  await page.goto('https://james.test/login');
  await page.waitForFunction(()=>{const v=document.querySelector('#loginScene');return v&&v.currentTime>0&&v.readyState>=2;},null,{timeout:10000});
  const layout=await page.evaluate(()=>{
    const z=s=>getComputedStyle(document.querySelector(s)).zIndex;
    const overlay=getComputedStyle(document.body,'::after');
    return {videoZ:z('#loginScene'),panelZ:z('main'),veilZ:overlay.zIndex,veil:overlay.backgroundColor,pointer:overlay.pointerEvents};
  });
  assert.ok(Number(layout.videoZ)<Number(layout.veilZ)&&Number(layout.veilZ)<Number(layout.panelZ),'veil must be between video and sign-in controls: '+JSON.stringify(layout));
  assert.equal(layout.pointer,'none');
  await page.locator('#loginScene').evaluate(v=>v.pause());
  await page.waitForTimeout(300);
  const withVeil=await page.screenshot({animations:'disabled'});
  await page.addStyleTag({content:'body::after{display:none!important}'});
  const withoutVeil=await page.screenshot({animations:'disabled'});
  assert.equal(withVeil.equals(withoutVeil),false,'overlay must change actual rendered pixels');
 }finally{await browser.close();}
});
