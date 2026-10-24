const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
test('Next Appointment opens the same event, restores position and supports keyboard in both themes at three viewport sizes',async()=>{
 const event={id:'qa-next',calendarId:'qa',calendarName:'Synthetic calendar',title:'Synthetic appointment',location:'Test room',description:'Verified fixture agenda',start:'2026-10-23T13:00:00Z',end:'2026-10-23T14:00:00Z',allDay:false,links:[{label:'Calendar source',url:'https://calendar.google.com/calendar/event?eid=synthetic'}]};
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(u.pathname==='/api/google/events')return res.end(JSON.stringify({connected:true,complete:true,partial:false,fetchedAt:'2026-10-23T12:00:00Z',calendars:[{id:'qa',name:'Synthetic calendar'}],completedCalendarIds:['qa'],events:[event]}));
   if(u.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   return res.end('{"connected":false,"messages":[],"unreadCount":0}');
  }
  const filename=path.join(__dirname,'..',u.pathname==='/'?'index.html':u.pathname.slice(1));
  try{res.setHeader('Content-Type',filename.endsWith('.js')||filename.endsWith('.mjs')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(filename));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});
  for(const viewport of [{width:390,height:844},{width:820,height:1180},{width:1440,height:900}])for(const theme of ['dark','light']){
   const context=await browser.newContext({timezoneId:'UTC',viewport});const page=await context.newPage();
   await page.route('https://**',route=>route.abort());
   await page.addInitScript(({theme})=>{const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-23T12:00:00Z']))}static now(){return +new RealDate('2026-10-23T12:00:00Z')}};sessionStorage.setItem('jamesIntroDate',new Date().toDateString());localStorage.setItem('jamesTheme',theme);},{theme});
   await page.goto('http://127.0.0.1:'+server.address().port);
   const button=page.getByRole('button',{name:'Open details for Synthetic appointment',exact:true});await button.waitFor({state:'visible'});
   assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
   await button.scrollIntoViewIfNeeded();
   const originalY=await page.evaluate(()=>window.scrollY);
   await button.focus();await button.press('Enter');
   const dialog=page.getByRole('dialog');assert.equal(await dialog.isVisible(),true);assert.match(await dialog.innerText(),/Verified fixture agenda/);assert.match(await dialog.innerText(),/Test room/);
   assert.equal(await page.locator('#close').evaluate(el=>el===document.activeElement),true);
   await page.locator('#close').press('Shift+Tab');assert.equal(await page.locator('#panelBody a').evaluate(el=>el===document.activeElement),true);
   await page.locator('#panelBody a').press('Tab');assert.equal(await page.locator('#close').evaluate(el=>el===document.activeElement),true);
   await page.locator('#close').press('Escape');assert.equal(await dialog.isVisible(),false);assert.equal(await page.evaluate(()=>window.scrollY),originalY);assert.equal(await button.evaluate(el=>el===document.activeElement),true);
   await page.locator('#nextTitle').click();assert.equal(await dialog.isVisible(),true);assert.equal(await page.locator('#panelTitle').innerText(),event.title);
   await page.getByRole('button',{name:'Close details',exact:true}).click();assert.equal(await dialog.isVisible(),false);assert.equal(await page.locator('#briefing').evaluate(el=>el.classList.contains('active')),true);
   await context.close();
  }
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
