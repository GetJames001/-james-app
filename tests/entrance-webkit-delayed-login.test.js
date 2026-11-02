'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {webkit}=require('playwright');
const root=path.resolve(__dirname,'..');
test('WebKit delayed login holds last frame and reaches Briefing',async()=>{
 const browser=await webkit.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:820,height:1180},isMobile:true,hasTouch:true});
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
   const type=filename.endsWith('.mp4')?'video/mp4':(filename.endsWith('.js')||filename.endsWith('.mjs'))?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.png')?'image/png':'text/plain';
   const bytes=fs.readFileSync(full);
   if(filename.endsWith('.mp4')){
     const range=route.request().headers()['range'];
     if(range){
       const m=/^bytes=(\d*)-(\d*)$/.exec(range);let start,end;
       if(m&&(m[1]||m[2])){start=m[1]?Number(m[1]):Math.max(0,bytes.length-Number(m[2]));end=m[1]?(m[2]?Number(m[2]):bytes.length-1):bytes.length-1;}
       if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=bytes.length||end<start)return route.fulfill({status:416,headers:{'content-range':'bytes */'+bytes.length},body:''});
       end=Math.min(end,bytes.length-1);
       return route.fulfill({status:206,contentType:type,headers:{'accept-ranges':'bytes','content-range':'bytes '+start+'-'+end+'/'+bytes.length,'content-length':String(end-start+1)},body:bytes.subarray(start,end+1)});
     }
     return route.fulfill({status:200,contentType:type,headers:{'accept-ranges':'bytes','content-length':String(bytes.length)},body:bytes});
   }
   return route.fulfill({contentType:type,body:bytes});
  });
  await page.goto('https://james.test/login');
  assert.equal(appRequestsBeforeAuth,0,'private app must not load before login');
  const initialVideo=page.locator('#loginScene');
  assert.equal(await initialVideo.count(),1,'entrance video must already exist behind sign-in');
  await page.waitForFunction(()=>{const v=document.querySelector('#loginScene');return v&&v.currentTime>0&&!v.paused;},{timeout:10000});
  const initialTime=await initialVideo.evaluate(v=>v.currentTime);
  await page.evaluate(()=>{window.__entranceOriginalDocument=document;window.__entranceOriginalVideo=document.getElementById('loginScene');});
  await page.evaluate(()=>{window.__mediaTrace=[];const v=document.getElementById('loginScene');for(const type of ['play','playing','pause','waiting','stalled','suspend','progress','timeupdate','error','ended'])v.addEventListener(type,()=>window.__mediaTrace.push({type,at:performance.now(),t:v.currentTime,ready:v.readyState}),{passive:true});});
  // An MP4 may stop a fraction of a frame before duration without firing ended.
  // Require stable near-final playback, elapsed time >5s, and no backwards reset.
  await page.evaluate(()=>{window.__videoWaitStart=performance.now();window.__nearFinalSamples=[];});
  await page.waitForFunction(()=>{
    const v=document.getElementById('loginScene'),arr=window.__nearFinalSamples;
    if(!v||!Number.isFinite(v.duration)||v.duration<=0)return false;
    arr.push({at:performance.now(),time:v.currentTime});
    if(arr.length>80)arr.shift();
    const close=v.duration-v.currentTime<=0.05;
    const last=arr.slice(-3);
    const stable=last.length===3&&last.every(x=>v.duration-x.time<=0.05)&&last.every((x,i)=>i===0||x.time>=last[i-1].time-0.001);
    return close&&stable&&performance.now()-window.__videoWaitStart>=5000;
  },null,{timeout:12000}).catch(async err=>{
    const state=await page.evaluate(()=>{const v=document.getElementById('loginScene');return {duration:v?.duration,time:v?.currentTime,ended:v?.ended,paused:v?.paused,readyState:v?.readyState,networkState:v?.networkState,buffered:v?Array.from({length:v.buffered.length},(_,i)=>[v.buffered.start(i),v.buffered.end(i)]):[],trace:window.__mediaTrace,samples:window.__nearFinalSamples};});
    throw new Error('WebKit near-final video stability failed: '+JSON.stringify(state)+'; '+err.message);
  });
  const videoEndDiagnostic=await page.locator('#loginScene').evaluate(v=>({ended:v.ended,delta:v.duration-v.currentTime}));
  console.log('WEBKIT_NATURAL_END_DIAGNOSTIC '+JSON.stringify(videoEndDiagnostic));
  assert.equal(await page.locator('#loginScene').evaluate(v=>v.loop),false,'slow sign-in must not loop');
  await page.locator('#email').fill('example@example.test');
  await page.locator('#password').fill('test-password');
  await page.evaluate(()=>{
    window.__perspectiveTrace={visibleAt:null,hideAt:null,fadeEndAt:null,samples:[]};
    const trace=window.__perspectiveTrace;
    const watch=setInterval(()=>{
      const el=document.querySelector('#intro');
      if(!el)return;
      const style=getComputedStyle(el),now=performance.now(),opacity=Number(style.opacity);
      const visible=style.display!=='none'&&style.visibility!=='hidden'&&opacity>0&&!el.classList.contains('hide');
      if(visible&&trace.visibleAt===null)trace.visibleAt=now;
      if(el.classList.contains('hide')&&trace.hideAt===null)trace.hideAt=now;
      if(trace.hideAt!==null&&trace.samples.length<80)trace.samples.push({ms:Math.round(now-trace.hideAt),opacity,videoOpacity:Number(getComputedStyle(document.getElementById('loginScene')||el).opacity)});
      if(trace.hideAt!==null&&opacity<0.02&&trace.fadeEndAt===null){trace.fadeEndAt=now;clearInterval(watch);}
    },25);
    window.__stopPerspectiveTrace=()=>clearInterval(watch);
  });
  await page.locator('#submitButton').click();
  await page.waitForFunction(()=>location.pathname==='/'&&document.getElementById('intro')&&document.getElementById('app'));
  assert.equal(await page.evaluate(()=>document===window.__entranceOriginalDocument),true,'the document must be retained through login');
  assert.equal(await page.evaluate(()=>document.getElementById('loginScene')===window.__entranceOriginalVideo),true,'exact video node must survive authentication');
  assert.ok(await page.evaluate(()=>document.getElementById('loginScene').currentTime)>=initialTime,'video must not reset through login');
  const introBegin=Date.now();
  const transition=await page.locator('#intro').evaluate(el=>getComputedStyle(el).transitionDuration);
  assert.ok(transition.split(',').map(x=>x.trim()).every(x=>x==='0.65s'||x==='650ms'),'Perspective fade must be 650ms; got '+transition);
  await page.waitForFunction(()=>document.getElementById('intro')?.getAttribute('aria-hidden')==='true',{timeout:10000});
  const introElapsed=Date.now()-introBegin;
  assert.ok(introElapsed>=3000&&introElapsed<=6200,'Perspective duration after mounted app must be in bounded 3–6.2s range: '+introElapsed);

  await page.waitForTimeout(900);
  const perspectiveTrace=await page.evaluate(()=>window.__perspectiveTrace);
  await page.evaluate(()=>window.__stopPerspectiveTrace?.());
  assert.ok(perspectiveTrace.visibleAt!==null&&perspectiveTrace.hideAt!==null,'Perspective visibility/hide timestamps required: '+JSON.stringify(perspectiveTrace));
  const visibleMs=perspectiveTrace.hideAt-perspectiveTrace.visibleAt;
  assert.ok(visibleMs>=3000&&visibleMs<=5500,'Visible Perspective must last 3–5s plus sampling allowance, measured '+visibleMs+' ms');
  const sampled=perspectiveTrace.samples.map(x=>x.opacity);
  assert.ok(sampled.some(x=>x>0.05&&x<0.95),'Perspective fade must have intermediate rendered opacity: '+JSON.stringify(sampled));
  assert.ok(sampled.at(-1)<0.03,'Perspective opacity must finish near zero: '+JSON.stringify(sampled));
  assert.ok(perspectiveTrace.fadeEndAt!==null,'Perspective fade must reach completion');
  const videoOpacity=perspectiveTrace.samples.map(x=>x.videoOpacity);
  assert.ok(videoOpacity.some(x=>x<0.95),'Video opacity must decrease during cleanup: '+JSON.stringify(videoOpacity));
  console.log('WEBKIT_PERSPECTIVE_TRACE '+JSON.stringify({visibleMs:Math.round(visibleMs),fadeMs:perspectiveTrace.fadeEndAt===null?null:Math.round(perspectiveTrace.fadeEndAt-perspectiveTrace.hideAt),opacity:perspectiveTrace.samples}));

  assert.equal(appRequestsBeforeAuth,0,'private app must stay authenticated');
  assert.equal(await page.locator('#loginScene').count(),0,'video removed after completed transition');
  assert.equal(await page.evaluate(()=>performance.getEntriesByType('navigation').length),1,'login must not navigate document');
  assert.ok(await page.locator('#loginScene').count()<=1,'video must not be duplicated');
  const mobileState=await page.evaluate(()=>({url:location.href,message:document.querySelector('#message')?.textContent,app:!!document.querySelector('#app'),intro:!!document.querySelector('#intro'),hidden:document.querySelector('#intro')?.getAttribute('aria-hidden'),scriptCount:document.scripts.length,errors:window.__jamesErrors||[]}));
  assert.equal(mobileState.hidden,'true','Perspective must complete on phone: '+JSON.stringify(mobileState));
  assert.equal(await page.locator('#app').evaluate(e=>e.inert),false,'Briefing must be interactive');
  assert.equal(await page.locator('#briefing').isVisible(),true,'Briefing visible on phone');
  assert.equal(await page.locator('#app').count(),1,'authenticated app must initialize');
  assert.equal(await page.locator('#briefing').count(),1,'Briefing must exist');
  assert.equal(errors.length,0,'browser errors: '+errors.join('; '));
  await context.close();
 }finally{await browser.close();}
});
