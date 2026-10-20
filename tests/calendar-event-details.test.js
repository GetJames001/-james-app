const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const auth=require('../lib/auth.js');
const {createEventsHandler}=require('../lib/google/events.js');

test('Google Calendar event details preserve bounded notes and only HTTPS links',async()=>{
  const original={ JAMES_AUTH_EMAIL:process.env.JAMES_AUTH_EMAIL,JAMES_SESSION_SECRET:process.env.JAMES_SESSION_SECRET,
    KV_REST_API_URL:process.env.KV_REST_API_URL, KV_REST_API_TOKEN:process.env.KV_REST_API_TOKEN };
  process.env.JAMES_AUTH_EMAIL='detail-review@example.test';
  process.env.JAMES_SESSION_SECRET='synthetic-calendar-detail-session-secret-123456';
  process.env.KV_REST_API_URL='https://store.example.test';
  process.env.KV_REST_API_TOKEN='synthetic-token';
  const ev={id:'meeting',summary:'Sales peer group',description:'<p>Agenda: pipeline review</p><a href="https://teams.microsoft.com/l/meetup-join/abc?x=1&amp;y=2">Join Teams</a> <img src=x onerror=alert(1)> javascript:alert(1)',
    location:'Teams',htmlLink:'https://calendar.google.com/calendar/event?eid=review',
    hangoutLink:'https://meet.google.com/abc-defg-hij',
    conferenceData:{entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'},{entryPointType:'phone',uri:'tel:1234'}]},
    start:{dateTime:'2026-10-20T10:00:00-07:00'},end:{dateTime:'2026-10-20T11:00:00-07:00'}};
  const requests=[];
  const fetchImpl=async(url,options={})=>{
    requests.push({url:String(url),method:options.method});
    if(url===process.env.KV_REST_API_URL)return {ok:true,json:async()=>({result:'synthetic-refresh'})};
    if(url==='https://oauth2.googleapis.com/token')return {ok:true,json:async()=>({access_token:'synthetic-access'})};
    if(String(url).includes('/calendarList?'))return {ok:true,json:async()=>({items:[{id:'work',summary:'Work',selected:true}]})};
    return {ok:true,json:async()=>({items:[ev]})};
  };
  const res={statusCode:200,headers:{},setHeader(n,v){this.headers[n]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}};
  try{
    const req={method:'GET',headers:{host:'www.getjames.ai',cookie:auth.SESSION_COOKIE+'='+auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}};
    await createEventsHandler({fetchImpl,now:()=>new Date('2026-10-20T17:00:00Z')})(req,res);
    assert.equal(res.statusCode,200);
    const got=res.body.events[0];
    assert.match(got.description,/Agenda: pipeline review/);
    assert.match(got.description,/Join Teams/);
    assert.doesNotMatch(got.description,/<p>|<a|<img|onerror/);
    assert.ok(got.description.length<=12000);
    assert.deepEqual(got.links.map(x=>x.url),[
      'https://meet.google.com/abc-defg-hij',
      'https://teams.microsoft.com/l/meetup-join/abc?x=1&y=2',
      'https://calendar.google.com/calendar/event?eid=review'
    ]);
    assert.ok(got.links.every(x=>x.url.startsWith('https://')));
    assert.equal(requests.filter(x=>x.url.includes('/events?')).length,1);
    assert.doesNotMatch(JSON.stringify(got),/synthetic-refresh|synthetic-access/);
  }finally{for(const [key,value] of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('Calendar details render agenda and safe meeting link for timed and all-day events',async()=>{
  const date=new Date().toISOString().slice(0,10);
  const detail={id:'meeting',calendarId:'work',calendarName:'Work',title:'Pipeline Review',
    location:'Teams',description:'Agenda: Q4 pipeline\n<img src=x onerror=alert(1)>',
    links:[{label:'Join Teams',url:'https://teams.microsoft.com/l/meetup-join/abc'},
      {label:'Unsafe link',url:'javascript:alert(1)'}],
    start:date+'T08:00:00Z',end:date+'T09:00:00Z',allDay:false};
  const allDay={...detail,id:'all-day',title:'Personal plans',description:'Bring tickets',
    links:[],start:date,end:new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10),allDay:true};
  const server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname.startsWith('/api/')){
      res.setHeader('Content-Type','application/json');
      if(u.pathname==='/api/google/events')return res.end(JSON.stringify({connected:true,complete:true,partial:false,
        fetchedAt:new Date().toISOString(),calendars:[{id:'work',name:'Work'}],
        completedCalendarIds:['work'],events:[detail,allDay]}));
      if(u.pathname==='/api/tasks')return res.end('{"tasks":[]}');
      return res.end('{"connected":false,"messages":[],"unreadCount":0}');
    }
    const filename=path.join(__dirname,'..',u.pathname==='/'?'index.html':u.pathname.slice(1));
    try{res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(filename));}
    catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({timezoneId:'UTC',viewport:{width:900,height:900}});
    await page.route('https://**',route=>route.abort());
    await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>document.querySelector('#calendarSyncStatus').textContent.includes('read successfully'));
    await page.evaluate(()=>document.querySelector('[data-page=appointments]').click());
    await page.locator('#apptList .appointment-day article').first().locator('button').click();
    assert.match(await page.locator('#panelBody').textContent(),/Bring tickets/);
    await page.evaluate(()=>document.querySelector('#close').click());
    const timed=page.locator('#apptList .appointment-day article').filter({hasText:'Pipeline Review'});
    await timed.locator('button').click();
    const body=page.locator('#panelBody');
    assert.match(await body.textContent(),/Agenda: Q4 pipeline/);
    assert.equal(await body.locator('img').count(),0);
    assert.equal(await body.locator('a').count(),1);
    assert.equal(await body.locator('a').first().getAttribute('href'),'https://teams.microsoft.com/l/meetup-join/abc');
    assert.match(await body.locator('a').first().getAttribute('rel'),/noopener noreferrer/);
    assert.equal(await page.evaluate(()=>Boolean(window.calendarInjected)),false);
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
