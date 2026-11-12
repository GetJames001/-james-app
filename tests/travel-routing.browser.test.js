'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('Next Appointment uses selected origin, handles unconfigured provider and rejects stale in-flight estimates',async()=>{
 let configured=false,calls=0,release;
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(url.pathname==='/api/james/routing'){
    calls++;let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);assert.equal(body.origin.address,'123 Example Street');
    if(!configured)return res.end(JSON.stringify({status:'unavailable',reason:'configuration_missing'}));
    if(calls===3)await new Promise(resolve=>{release=resolve;});
    return res.end(JSON.stringify({status:'ready',driveSeconds:1200,trafficDelaySeconds:300,estimatedLeaveBy:new Date(Date.now()+1800000).toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()}));
   }
   if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   if(url.pathname==='/api/auth/session')return res.end('{"ok":true,"authenticated":true}');
   return res.end('{"connected":false}');
  }
  const file=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.route('https://**',r=>r.abort());await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{calendarSyncState.hasData=true;calendarSyncState.state='ready';events=[['12:00','13:00','James routing test','456 Example Avenue',null,{id:'test',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),location:'456 Example Avenue'}]];updateHero();});
  assert.equal(await page.locator('#routeOriginAddress').isVisible(),true);await page.locator('#routeEstimate').click();assert.match(await page.locator('#routeStatus').textContent(),/Choose a departure/);assert.equal(calls,0);
  await page.locator('#routeOriginAddress').fill('123 Example Street');await page.locator('#routeUseAddress').click();await page.waitForFunction(()=>document.querySelector('#routeStatus').textContent.includes('not configured'));assert.equal(await page.locator('#driveTime').textContent(),'—');
  configured=true;await page.locator('#routeEstimate').click();await page.waitForFunction(()=>document.querySelector('#driveTime').textContent==='20 min');assert.equal(await page.locator('#traffic').textContent(),'+5 min');
  await page.locator('#routeEstimate').click();await page.waitForFunction(()=>document.querySelector('#routeEstimate').disabled);while(!release)await new Promise(resolve=>setTimeout(resolve,10));
  await page.evaluate(()=>{events[0][5].location='789 Changed Avenue';updateHero();});release();await page.waitForFunction(()=>!document.querySelector('#routeEstimate').disabled);assert.equal(await page.locator('#driveTime').textContent(),'—');
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal(await page.locator('#routeOriginAddress').inputValue(),'');
 }finally{release?.();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('opted-in live location fills departure fields without clicking another route control',async()=>{
 let routeCalls=0;
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(url.pathname==='/api/james/routing'){
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);routeCalls++;
    assert.equal(body.origin.kind,'device');assert.equal(body.origin.latitude,36);assert.equal(body.destination,'456 Example Avenue');
    return res.end(JSON.stringify({status:'ready',driveSeconds:1200,trafficDelaySeconds:300,estimatedLeaveBy:new Date(Date.now()+1800000).toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()}));
   }
   if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   if(url.pathname==='/api/auth/session')return res.end('{"ok":true,"authenticated":true}');
   return res.end('{"connected":false}');
  }
  const file=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({permissions:['geolocation'],geolocation:{latitude:36,longitude:-115,accuracy:10}}),page=await context.newPage();
  await page.route('https://**',r=>r.abort());await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{calendarSyncState.hasData=true;calendarSyncState.state='ready';events=[['12:00','13:00','James routing test','456 Example Avenue',null,{id:'auto-test',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),location:'456 Example Avenue'}]];updateHero();});
  assert.equal(routeCalls,0);await page.locator('#jamesLiveLocation').click();
  await page.waitForFunction(()=>document.querySelector('#driveTime').textContent==='20 min');assert.equal(await page.locator('#traffic').textContent(),'+5 min');assert.notEqual(await page.locator('#leaveBy').textContent(),'—');assert.equal(routeCalls,1);
  await page.evaluate(()=>{updateHero();updateHero();});assert.equal(routeCalls,1);
  await page.locator('#jamesLiveLocation').click();await page.waitForFunction(()=>document.querySelector('#driveTime').textContent==='—');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('remembered live location replaces a superseded startup route and estimates again after reload without a tap',async()=>{
 let calls=0,releaseFirst,firstStartedResolve;const firstStarted=new Promise(resolve=>{firstStartedResolve=resolve;});
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(url.pathname==='/api/james/routing'){
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);assert.equal(body.origin.kind,'device');calls++;
    if(calls===1){firstStartedResolve();await new Promise(resolve=>{releaseFirst=resolve;});}
    return res.end(JSON.stringify({status:'ready',driveSeconds:1200,trafficDelaySeconds:300,estimatedLeaveBy:new Date(Date.now()+1800000).toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()}));
   }
   if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   if(url.pathname==='/api/auth/session')return res.end('{"ok":true,"authenticated":true}');
   return res.end('{"connected":false}');
  }
  const file=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({permissions:['geolocation'],geolocation:{latitude:36,longitude:-115,accuracy:100}}),page=await context.newPage();
  await context.addInitScript(()=>localStorage.setItem('james:live-location:v1','enabled'));
  await page.route('https://**',r=>r.abort());const url='http://127.0.0.1:'+server.address().port;await page.goto(url);
  const calendar=()=>page.evaluate(()=>{calendarSyncState.hasData=true;calendarSyncState.state='fresh';events=[['12:00','13:00','Reload route test','456 Example Avenue',null,{id:'reload-test',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),location:'456 Example Avenue'}]];updateHero();});
  await page.evaluate(()=>{calendarSyncState.hasData=true;calendarSyncState.state='fresh';events=[['12:00','13:00','Missing destination test','',null,{id:'missing-destination',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),location:''}]];updateHero();});
  await page.waitForFunction(()=>document.querySelector('#routeStatus').textContent.includes('destination address'));assert.equal(calls,0);
  await calendar();await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('automatic startup route did not reach fixture')),10000);firstStarted.then(()=>{clearTimeout(timeout);resolve();});});
  // The server deliberately keeps the first provider reply pending while a better device fix arrives.
  await page.waitForFunction(()=>document.querySelector('#routeEstimate').disabled);await context.setGeolocation({latitude:36.02,longitude:-115,accuracy:10});
  await page.waitForFunction(()=>document.querySelector('#driveTime').textContent==='20 min',null,{timeout:15000});assert.equal(calls,2);releaseFirst();
  await page.reload();await calendar();await page.waitForFunction(()=>document.querySelector('#driveTime').textContent==='20 min');assert.equal(await page.locator('#jamesLiveLocation').textContent(),'Live location on');assert.equal(calls,3);
 }finally{releaseFirst?.();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
