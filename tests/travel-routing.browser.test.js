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
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:820,height:1180}});await page.route('https://**',r=>r.abort());await page.goto('http://127.0.0.1:'+server.address().port);
  assert.equal(await page.locator('#appointmentTravel').isVisible(),false);
  await page.evaluate(()=>{calendarSyncState.hasData=true;calendarSyncState.state='ready';events=[['12:00','13:00','James routing test','456 Example Avenue',null,{id:'test',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),location:'456 Example Avenue'}]];updateHero();});
  assert.equal(await page.locator('#routeOriginAddress').isVisible(),true);await page.locator('#routeEstimate').click();assert.match(await page.locator('#routeStatus').textContent(),/Choose a departure/);assert.equal(calls,0);
  await page.locator('#routeOriginAddress').fill('123 Example Street');await page.locator('#routeUseAddress').click();await page.waitForFunction(()=>document.querySelector('#routeStatus').textContent.includes('not configured'));assert.equal(await page.locator('#driveTime').textContent(),'—');
  configured=true;await page.locator('#routeEstimate').click();await page.waitForFunction(()=>document.querySelector('#driveTime').textContent==='20 min');assert.equal(await page.locator('#traffic').textContent(),'+5 min');
  await page.locator('#routeEstimate').click();await page.waitForFunction(()=>document.querySelector('#routeEstimate').disabled);while(!release)await new Promise(resolve=>setTimeout(resolve,10));
  await page.evaluate(()=>{events[0][5].location='789 Changed Avenue';updateHero();});release();await page.waitForFunction(()=>!document.querySelector('#routeEstimate').disabled);assert.equal(await page.locator('#driveTime').textContent(),'—');
  await page.evaluate(()=>{events[0][5].location='Microsoft Teams';updateHero();});
  assert.match(await page.locator('#nextType').textContent(),/Online meeting/);
  assert.equal(await page.locator('.routing-controls').isVisible(),false);
  assert.equal(await page.locator('.next-meta').isVisible(),false);
  await page.evaluate(()=>{events[0][5].location='789 Changed Avenue';events[0][5].onlineMeeting=true;updateHero();});
  assert.equal(await page.locator('.routing-controls').isVisible(),true);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal(await page.locator('#routeOriginAddress').inputValue(),'');
  // Reload through the calendar API with the same provider location format as the iPad appointment.
  await page.clock.setFixedTime(new Date('2026-11-16T18:30:00Z'));
  await page.route('**/api/google/events',route=>route.fulfill({json:{connected:true,complete:true,
   events:[{id:'virtual',calendarId:'primary',title:'Example interview',location:'Microsoft Teams',start:'2026-11-16T21:30:00Z',end:'2026-11-16T22:15:00Z'}]}}));
  const beforeReload=calls;
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#nextTitle').textContent==='Example interview');
  assert.match(await page.locator('#nextType').textContent(),/Online meeting/);
  assert.equal(await page.locator('#appointmentTravel').isVisible(),false);
  assert.equal(calls,beforeReload);

 }finally{release?.();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('opted-in live location fills departure fields without clicking another route control',async()=>{
 let routeCalls=0,weatherCalls=0;
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(url.pathname==='/api/weather'){weatherCalls++;return res.end(JSON.stringify({current:{temperature_2m:75,weather_code:0}}));}
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
  browser=await chromium.launch({headless:true});const context=await browser.newContext({isMobile:true,hasTouch:true,viewport:{width:393,height:851},permissions:['geolocation'],geolocation:{latitude:36,longitude:-115,accuracy:4500}}),page=await context.newPage();
  // The high-accuracy watch gets an unusable first reading. The browser's
  // regional lookup can still supply weather while the same watch improves.
  await context.addInitScript(()=>{
   const geo=navigator.geolocation;
   const watch=geo.watchPosition.bind(geo);
   geo.watchPosition=(receive,fail,options)=>{
    let first=true;
    return watch(position=>{
     if(first){
      first=false;
      receive({coords:{latitude:36,longitude:-115,accuracy:80000},timestamp:position.timestamp});
     }else receive(position);
    },fail,options);
   };
  });
  await page.route('https://**',r=>r.abort());await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{calendarSyncState.hasData=true;calendarSyncState.state='ready';events=[['12:00','13:00','James routing test','456 Example Avenue',null,{id:'auto-test',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),location:'456 Example Avenue'}]];updateHero();});
  assert.equal(routeCalls,0);await page.locator('#jamesLiveLocation').tap();
  await page.waitForFunction(()=>document.querySelector('#weatherTemp').textContent==='75°');
  assert.match(await page.locator('#routeStatus').textContent(),/precise location or enter a departure address/);
  assert.equal(await page.locator('#driveTime').textContent(),'—');assert.equal(routeCalls,0);
  await context.setGeolocation({latitude:36,longitude:-115,accuracy:10});
  await page.waitForFunction(()=>document.querySelector('#driveTime').textContent==='20 min');assert.equal(weatherCalls,1);assert.equal(await page.locator('#traffic').textContent(),'+5 min');assert.notEqual(await page.locator('#leaveBy').textContent(),'—');assert.equal(routeCalls,1);
  await page.evaluate(()=>{updateHero();updateHero();});assert.equal(routeCalls,1);
  await page.locator('#jamesLiveLocation').click();await page.waitForFunction(()=>document.querySelector('#driveTime').textContent==='—');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('remembered live location replaces a superseded startup route and estimates again after reload without a tap',async()=>{
 let calls=0,destination='',releaseFirst,firstStartedResolve;const firstStarted=new Promise(resolve=>{firstStartedResolve=resolve;});
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(url.pathname==='/api/james/routing'){
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);assert.equal(body.origin.kind,'device');calls++;
    if(calls===1){firstStartedResolve();await new Promise(resolve=>{releaseFirst=resolve;});}
    return res.end(JSON.stringify({status:'ready',driveSeconds:1200,trafficDelaySeconds:300,estimatedLeaveBy:new Date(Date.now()+1800000).toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()}));
   }
   if(url.pathname==='/api/google/events')return res.end(JSON.stringify({connected:true,complete:true,partial:false,fetchedAt:new Date().toISOString(),calendars:[{id:'fixture',name:'Fictional routing calendar'}],events:[{id:'reload-test',calendarId:'fixture',title:'Reload route test',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),location:destination}]}));
   if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   if(url.pathname==='/api/auth/session')return res.end('{"ok":true,"authenticated":true}');
   return res.end('{"connected":false}');
  }
  const file=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({timezoneId:'America/Los_Angeles',permissions:['geolocation'],geolocation:{latitude:36,longitude:-115,accuracy:100}}),page=await context.newPage();
  await context.addInitScript(()=>{
   localStorage.setItem('james:live-location:v1','enabled');
   // Some browser sessions report prompt again on reload. James must still call
   // geolocation for an existing opt-in; the actual browser grant gates access.
   const query=navigator.permissions.query.bind(navigator.permissions);
   navigator.permissions.query=descriptor=>descriptor.name==='geolocation'?Promise.resolve({state:'prompt'}):query(descriptor);
  });
  await page.route('https://**',r=>r.abort());const url='http://127.0.0.1:'+server.address().port;await page.goto(url);
  await page.waitForFunction(()=>document.querySelector('#routeStatus').textContent.includes('destination address'));assert.equal(calls,0);
  destination='456 Example Avenue';
  await page.evaluate(async()=>applyGoogleEvents(await JamesCalendarSync.readCalendar(fetch)));await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('automatic startup route did not reach fixture')),10000);firstStarted.then(()=>{clearTimeout(timeout);resolve();});});
  // The server deliberately keeps the first provider reply pending while a better device fix arrives.
  await page.waitForFunction(()=>document.querySelector('#routeEstimate').disabled);await context.setGeolocation({latitude:36.02,longitude:-115,accuracy:10});
  await page.waitForFunction(()=>document.querySelector('#driveTime').textContent==='20 min',null,{timeout:15000});assert.equal(calls,2);releaseFirst();
  await page.reload();
  try{await page.waitForFunction(()=>document.querySelector('#driveTime').textContent==='20 min');}
  catch(error){throw Error('Automatic reload route did not complete: '+JSON.stringify(await page.evaluate(()=>({routeStatus:document.querySelector('#routeStatus').textContent,location:window.jamesLocation.snapshot(),calendarState:calendarSyncState.state,routePending:document.querySelector('#routeEstimate').disabled}))),{cause:error});}
  assert.equal(await page.locator('#jamesLiveLocation').textContent(),'Live location on');assert.equal(calls,3);
 }finally{releaseFirst?.();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
