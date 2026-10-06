const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');

test('rendered calendar keeps cached failed-source events and names, shows stale status and treats provider titles as text',async()=>{
  let mode='full',reads=0;
  const date=new Date().toISOString().slice(0,10);
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const tomorrowEvent={id:'tomorrow',calendarId:'work',calendarName:'Synthetic work',title:'Synthetic tomorrow visit',location:'Synthetic location',start:tomorrow+'T13:00:00Z',end:tomorrow+'T14:00:00Z',allDay:false};
  const title='<img src=x onerror="window.calendarInjected=true">';
  const event={id:'synthetic',calendarId:'work',calendarName:'Synthetic work',title,location:'<script>unsafe</script>',start:date+'T00:00:00Z',end:date+'T23:59:59Z',allDay:false};
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      res.setHeader('content-type','application/json');
      if(url.pathname==='/api/google/events'){
        reads++;assert.equal(req.method,'GET');
        if(mode==='failure'){res.statusCode=503;return res.end('{}');}
        return res.end(JSON.stringify({connected:true,complete:mode==='full',partial:mode!=='full',fetchedAt:new Date().toISOString(),calendars:mode==='full'?[{id:'work',name:'Synthetic work'},{id:'empty',name:'Synthetic personal'}]:[{id:'empty',name:'Synthetic personal'}],completedCalendarIds:mode==='full'?['work','empty']:['empty'],events:mode==='full'?[event,tomorrowEvent]:[]}));
      }
      if(url.pathname==='/api/auth/session')return res.end('{"ok":true,"authenticated":true}');
      if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
      return res.end('{"connected":false,"messages":[],"unreadCount":0}');
    }
    const filename=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));
    try{res.setHeader('content-type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(filename));}catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:768},timezoneId:'UTC'});
    await page.route('https://**',route=>route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>document.querySelector('#calendarSyncStatus').textContent.includes('read successfully'));
    assert.match(await page.locator('#calendarSyncSources').textContent(),/Synthetic work.*Synthetic personal/);
    assert.equal(await page.evaluate(()=>Boolean(window.calendarInjected)),false);
    assert.ok((await page.locator('#apptList').textContent()).includes(title));
    await page.evaluate(()=>document.querySelectorAll('.intro,.intro-overlay').forEach(el=>el.remove()));
    assert.equal(await page.locator('#calendarDetails').evaluate(el=>el.open),false);
    assert.equal(await page.locator('#calendarVisibleWarning').isVisible(),false);
    await page.evaluate(()=>document.querySelector('[data-page=appointments]').click());
    await page.locator('#appointmentsTomorrow').click();
    assert.match(await page.locator('#apptList').textContent(),/Synthetic tomorrow visit/);
    assert.equal(await page.locator('#calendar').textContent().then(text=>text.includes('Synthetic tomorrow visit')),false);
    await page.locator('#appointmentsWeek').click();
    assert.equal(await page.locator('#apptList .appointment-day-heading').count(),7);
    await page.locator('#appointmentsToday').click();
    assert.ok((await page.locator('#apptList').textContent()).includes(title));
    for(const width of [390,820,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:el.getBoundingClientRect().right})))));}
    await page.clock.install();await page.clock.runFor(5001);mode='partial';
    await page.evaluate(()=>document.querySelector('#calendarRefreshButton').click());
    await page.waitForFunction(()=>document.querySelector('#calendarSyncStatus').textContent.includes('Incomplete coverage'));
    assert.match(await page.locator('#calendarSyncSources').textContent(),/Synthetic work/);
    assert.ok((await page.locator('#apptList').textContent()).includes(title));
    await page.clock.runFor(5001);mode='failure';await page.evaluate(()=>document.querySelector('#appointmentsRefreshButton').click());
    await page.waitForFunction(()=>document.querySelector('#calendarSyncStatus').textContent.includes('may be stale'));
    assert.ok((await page.locator('#apptList').textContent()).includes(title));assert.ok(reads>=3);assert.equal(await page.locator('#calendarVisibleWarning').evaluate(el=>el.hidden),false);await page.locator('#appointmentsTomorrow').click();assert.match(await page.locator('#apptList').textContent(),/Synthetic tomorrow visit/);assert.match(await page.locator('#appointmentsViewStatus').textContent(),/previously received/);
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
});
