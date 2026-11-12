'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
async function fixture(fn){
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1024,height:768}}),page=await context.newPage();
    let signedIn=false,delay=false,release;
    const pending=new Promise(resolve=>release=resolve),requested=[];
    await page.route('https://entrance.test/**',async route=>{
      const url=new URL(route.request().url()),p=url.pathname;requested.push(p);
      if(p==='/api/auth/login'){signedIn=true;return route.fulfill({json:{ok:true}});}
      if(p==='/api/auth/logout'){signedIn=false;return route.fulfill({json:{ok:true}});}
      if(p.startsWith('/api/'))return route.fulfill({json:{ok:true,connected:false,events:[],tasks:[],messages:[],complete:false}});
      if(p==='/'&&!signedIn)return route.fulfill({status:302,headers:{location:'/login'}});
      if(delay&&p.endsWith('.mp4'))await pending;
      let name=p.slice(1)||'index.html';
      if(name==='login')name='login.html';
      if(name.startsWith('login-scene-'))name='assets/scenes/'+name.slice(12);
      if(name.startsWith('login-poster-'))name='assets/scenes/'+name.slice(13);
      if(name==='login-art-dark.png')name='assets/welcome-dark.png';
      if(name==='login-art-light.png')name='assets/welcome-light.png';
      const file=path.resolve(root,name);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404});
      const contentType=name.endsWith('.mp4')?'video/mp4':name.endsWith('.jpg')?'image/jpeg':name.endsWith('.png')?'image/png':name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html';
      return route.fulfill({contentType,body:fs.readFileSync(file)});
    });
    await fn({page,context,requested,block:()=>delay=true,release});
  }finally{await browser.close();}
}
test('fixed selection survives slow video, refresh, sign-in, selection change and sign-out without Waterfront requests',async()=>fixture(async({page,requested,block,release})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('jamesIntroScreen'))localStorage.setItem('jamesIntroScreen',JSON.stringify({mode:'fixed',scene:'aurora-from-orbit',favorites:[]}));});
  block();await page.goto('https://entrance.test/login',{waitUntil:'domcontentloaded'});
  assert.match(await page.locator('body').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),/login-poster-aurora-from-orbit/);
  assert.equal(await page.locator('#loginScene').getAttribute('src'),'/login-scene-aurora-from-orbit.mp4');
  assert.equal(requested.some(p=>/login-art-|login-scene-(morning|noon|evening|night)\./.test(p)),false);
  release();await page.waitForFunction(()=>document.querySelector('video').currentTime>0);
  await page.reload();assert.equal(await page.locator('#loginScene').getAttribute('poster'),'/login-poster-aurora-from-orbit.jpg');
  await page.locator('#email').fill('fictional@example.test');await page.locator('#password').fill('synthetic-password');await page.locator('#submitButton').click();
  await page.waitForFunction(()=>document.querySelector('#app')&&!document.querySelector('#app').inert);
  await page.locator('.header-preferences > summary').click();
  await page.getByRole('button',{name:'Entrance',exact:true}).click();
  await page.getByRole('button',{name:'Use Moonlit Forest Retreat',exact:true}).click();
  assert.match(await page.locator('#introModeNote').innerText(),/keep it/);
  await page.getByRole('button',{name:'Close intro settings',exact:true}).click();
  await page.evaluate(()=>sessionStorage.removeItem('jamesIntroDate'));
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#intro video')?.getAttribute('src')==='assets/scenes/moonlit-forest.mp4');
  await page.waitForFunction(()=>!document.querySelector('#app').inert);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.waitForURL('**/login');
  assert.equal(await page.locator('#loginScene').getAttribute('src'),'/login-scene-moonlit-forest.mp4');
  assert.match(await page.locator('body').evaluate(el=>getComputedStyle(el,'::before').backgroundImage),/login-poster-moonlit-forest/);
  assert.equal(requested.some(p=>/login-art-|assets\/welcome-|(?:login-scene-|assets\/scenes\/)(morning|noon|evening|night)\./.test(p)),false);
}));
test('favorites rotate on repeated sign-in refreshes without showing an unrelated scene',async()=>fixture(async({page,requested})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('jamesIntroScreen'))localStorage.setItem('jamesIntroScreen',JSON.stringify({mode:'rotate',favorites:['strip-terrace','aurora-from-orbit']}));});
  let previous;
  for(let i=0;i<4;i++){
    await page.goto('https://entrance.test/login');
    const source=await page.locator('#loginScene').getAttribute('src');
    assert.notEqual(source,previous);previous=source;
    assert.match(source,/login-scene-(strip-terrace|aurora-from-orbit)\.mp4/);
    assert.equal(await page.locator('#loginScene').getAttribute('poster'),source.replace('login-scene-','login-poster-').replace('.mp4','.jpg'));
  }
  assert.equal(requested.some(p=>/login-art-|assets\/welcome-|(?:login-scene-|assets\/scenes\/)(morning|noon|evening|night)\./.test(p)),false);
}));
test('scene panels stay transparent and within tablet and phone viewports',async()=>fixture(async({page})=>{
  await page.goto('https://entrance.test/login');
  for(const scene of ['oceanfront','fontainebleau-penthouse','moonlit-forest']){
    await page.evaluate(scene=>localStorage.setItem('jamesIntroScreen',JSON.stringify({mode:'fixed',scene})),scene);
    for(const viewport of [{width:1024,height:768},{width:390,height:844}]){
      await page.setViewportSize(viewport);await page.reload();
      const panel=await page.locator('main').evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,background:s.backgroundColor,blur:s.backdropFilter};});
      assert.equal(panel.background,'rgba(0, 0, 0, 0)');assert.equal(panel.blur,'none');
      assert.ok(panel.left>=0&&panel.top>=0&&panel.right<=viewport.width&&panel.bottom<=viewport.height+1,JSON.stringify({scene,viewport,panel}));
      if(viewport.width===1024)await page.screenshot({path:'/tmp/james-panel-'+scene+'.png'});
    }
  }
}));
