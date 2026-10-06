const assert = require('node:assert/strict');
const test = require('node:test');
const auth = require('../lib/auth.js');
const { createEventsHandler, LIMITS } = require('../lib/google/events.js');
process.env.JAMES_AUTH_EMAIL = 'calendar-test@example.test';
process.env.JAMES_SESSION_SECRET = 'synthetic-calendar-secret-at-least-thirty-two-bytes';
process.env.KV_REST_API_URL = 'https://calendar-store.example.test';
process.env.KV_REST_API_TOKEN = 'synthetic-store-token';
const NOW = '2026-10-06T15:00:00.000Z';
function request(method = 'GET', headers = {}) {
  return { method, headers: { host: 'www.getjames.ai', cookie: `${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`, ...headers } };
}
function response() {
  return { statusCode: 200, headers: {}, body: null, setHeader(name,value) { this.headers[name]=value; }, status(value) { this.statusCode=value; return this; }, json(value) { this.body=value; return this; }, end() { return this; } };
}
function json(data, ok = true) { return { ok, json: async () => data }; }
function calendar(id = 'personal', overrides = {}) { return { id, summary: id, selected: true, timeZone: 'America/Los_Angeles', ...overrides }; }
function event(id = 'event1', overrides = {}) { return { id, summary: 'Synthetic appointment', start: { dateTime: '2026-10-06T10:00:00-07:00', timeZone: 'America/Los_Angeles' }, end: { dateTime: '2026-10-06T11:00:00-07:00', timeZone: 'America/Los_Angeles' }, ...overrides }; }
function provider({ lists = [{ items: [calendar()] }], events = () => json({ items: [event()], timeZone: 'America/Los_Angeles' }), token = json({ access_token: 'synthetic-access-token' }), redis = json({ result: 'synthetic-refresh-token' }) } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url === process.env.KV_REST_API_URL) return redis;
    if (url === 'https://oauth2.googleapis.com/token') return token;
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/calendarList')) {
      const index = parsed.searchParams.has('pageToken') ? Number(parsed.searchParams.get('pageToken')) : 0;
      const data = lists[index];
      if (data instanceof Error) throw data;
      return json(data);
    }
    return events(parsed, options);
  };
  return { calls, handler: createEventsHandler({ fetchImpl, now: () => new Date(NOW) }) };
}
async function invoke(handler, req = request()) { const res=response(); await handler(req,res); return res; }

test('calendar reads authenticate and reject methods before any provider call', async () => {
  const store = provider();
  assert.equal((await invoke(store.handler,request('GET',{cookie:''}))).statusCode,401);
  assert.equal((await invoke(store.handler,request('GET',{host:'hostile.example.test'}))).statusCode,403);
  for (const method of ['POST','PUT','DELETE','HEAD','OPTIONS']) {
    const res=await invoke(store.handler,request(method)); assert.equal(res.statusCode,405); assert.equal(res.headers.Allow,'GET');
  }
  assert.equal(store.calls.length,0);
});

test('calendar list and event pages are combined, filtered, deduplicated and timezone-preserving', async () => {
  const store = provider({
    lists: [{ items:[calendar(),calendar('holiday',{summary:'Holidays'}),calendar('hidden',{selected:false})], nextPageToken:'1' }, { items:[calendar('work'),calendar()] }],
    events: (url) => {
      const id=decodeURIComponent(url.pathname.split('/')[4]);
      if(id==='work') return json({ items:[], timeZone:'America/New_York' });
      if(url.searchParams.has('pageToken')) return json({ items:[event('second',{ start:{date:'2026-10-06'}, end:{date:'2026-10-09'} }),event()], timeZone:'America/Los_Angeles' });
      return json({ items:[event()], nextPageToken:'event-page2', timeZone:'America/Los_Angeles' });
    }
  });
  const res=await invoke(store.handler);
  assert.equal(res.statusCode,200); assert.equal(res.body.complete,true); assert.equal(res.body.partial,false);
  assert.equal(res.body.fetchedAt,NOW); assert.equal(res.body.calendarCount,2); assert.equal(res.body.count,2);
  assert.deepEqual(res.body.completedCalendarIds,['personal','work']);
  assert.deepEqual(res.body.failedCalendars,[]);
  assert.equal(res.body.events.find(e=>e.id==='event1').startTimeZone,'America/Los_Angeles');
  assert.equal(res.body.events.find(e=>e.id==='second').allDay,true);
  assert.equal(res.body.events.find(e=>e.id==='second').end,'2026-10-09');
  assert.equal(res.body.events.find(e=>e.id==='second').calendarTimeZone,'America/Los_Angeles');
  assert.match(res.headers['Cache-Control'],/private.*no-store/);
  const eventCalls=store.calls.filter(c=>c.url.includes('/events?'));
  assert.equal(eventCalls.length,3);
  for(const call of eventCalls) {
    const query=new URL(call.url).searchParams;
    assert.equal(query.get('timeMin'),'2026-10-05T15:00:00.000Z');
    assert.equal(query.get('singleEvents'),'true');
    assert.equal(call.options.method,undefined,'provider calls are read-only GET');
  }
});

test('later event-page failure discards incomplete source while successful empty source is completed', async () => {
  const store=provider({ lists:[{items:[calendar(),calendar('work')]}], events: url=> {
    if(url.pathname.includes('/work/')) return json({items:[]});
    if(url.searchParams.has('pageToken')) return json({error:{message:'provider-secret'}},false);
    return json({items:[event()],nextPageToken:'next'});
  }});
  const res=await invoke(store.handler);
  assert.equal(res.statusCode,200); assert.equal(res.body.partial,true); assert.equal(res.body.complete,false);
  assert.deepEqual(res.body.events,[]); assert.deepEqual(res.body.completedCalendarIds,['work']);
  assert.deepEqual(res.body.failedCalendars,[{id:'personal',name:'personal',error:'READ_UNAVAILABLE'}]);
  assert.doesNotMatch(JSON.stringify(res.body),/provider-secret|synthetic-access-token|synthetic-refresh-token/);
});

test('calendar-list failure after first page explicitly reports incomplete coverage', async () => {
  const store=provider({lists:[{items:[calendar()],nextPageToken:'1'},new Error('provider secret')]});
  const res=await invoke(store.handler);
  assert.equal(res.statusCode,200); assert.equal(res.body.partial,true); assert.equal(res.body.limited,true);
  assert.ok(res.body.limitations.includes('CALENDAR_LIST_INCOMPLETE'));
  assert.deepEqual(res.body.completedCalendarIds,['personal']);
});

test('per-calendar event bound never represents truncated events as complete', async () => {
  const store=provider({events:()=>json({items:Array.from({length:LIMITS.eventsPerCalendar+1},(_,i)=>event(`event${i}`))})});
  const res=await invoke(store.handler);
  assert.equal(res.body.partial,true); assert.equal(res.body.limited,true);
  assert.deepEqual(res.body.completedCalendarIds,[]); assert.deepEqual(res.body.events,[]);
  assert.equal(res.body.failedCalendars.length,1);
});

test('repeated pagination token terminates and discards incomplete calendar results', async () => {
  const store=provider({events:()=>json({items:[event()],nextPageToken:'same'})});
  const res=await invoke(store.handler);
  assert.equal(store.calls.filter(c=>c.url.includes('/events?')).length,2);
  assert.equal(res.body.partial,true); assert.deepEqual(res.body.completedCalendarIds,[]); assert.deepEqual(res.body.events,[]);
});

test('list, per-source pages and overall events have bounded, disclosed coverage', async () => {
  const listCap=provider({lists:Array.from({length:LIMITS.calendarPages},(_,i)=>({items:[calendar(`source${i}`)],nextPageToken:String(i+1)}))});
  let res=await invoke(listCap.handler); assert.equal(res.body.partial,true); assert.ok(res.body.limitations.includes('CALENDAR_PAGE_LIMIT'));
  const calendarCap=provider({lists:[{items:Array.from({length:LIMITS.calendars+1},(_,i)=>calendar(`source${i}`))}],events:()=>json({items:[]})});
  res=await invoke(calendarCap.handler); assert.equal(res.body.calendarCount,LIMITS.calendars); assert.ok(res.body.limitations.includes('CALENDAR_LIMIT'));
  const eventCap=provider({lists:[{items:Array.from({length:11},(_,i)=>calendar(`source${i}`))}],events:()=>json({items:Array.from({length:500},(_,i)=>event(`event${i}`))})});
  res=await invoke(eventCap.handler); assert.equal(res.body.count,5000); assert.equal(res.body.completedCalendarIds.length,10); assert.equal(res.body.failedCalendars.length,1); assert.ok(res.body.limitations.includes('EVENT_LIMIT'));
  const pageCap=provider({events:url=>json({items:[],nextPageToken:String(Number(url.searchParams.get('pageToken')||0)+1)})});
  res=await invoke(pageCap.handler); assert.equal(pageCap.calls.filter(c=>c.url.includes('/events?')).length,LIMITS.eventPages); assert.equal(res.body.partial,true); assert.deepEqual(res.body.completedCalendarIds,[]);
});

test('disconnected and unavailable stores/token/list fail generically without provider diagnostic logging', async () => {
  const originalError=console.error;
  const logs=[]; console.error=(...args)=>logs.push(args);
  try {
    const disconnected=await invoke(provider({redis:json({result:null})}).handler);
    assert.equal(disconnected.statusCode,401);
    for(const config of [
      {redis:json({error:'provider secret'},false)},
      {token:json({error_description:'provider secret'},false)},
      {lists:[undefined]}
    ]) {
      const res=await invoke(provider(config).handler);
      assert.equal(res.statusCode,503); assert.doesNotMatch(JSON.stringify(res.body),/provider secret/);
    }
    assert.deepEqual(logs,[]);
  } finally { console.error=originalError; }
});

test('provider empty responses without items are valid, while malformed collections disclose failure', async () => {
  let res=await invoke(provider({lists:[{}]}).handler);
  assert.equal(res.body.complete,true); assert.deepEqual(res.body.events,[]); assert.deepEqual(res.body.calendars,[]);
  res=await invoke(provider({events:()=>json({timeZone:'America/Los_Angeles'})}).handler);
  assert.equal(res.body.complete,true); assert.deepEqual(res.body.completedCalendarIds,['personal']);
  res=await invoke(provider({events:()=>json({items:'not-an-array'})}).handler);
  assert.equal(res.body.partial,true); assert.deepEqual(res.body.completedCalendarIds,[]);
  res=await invoke(provider({events:()=>json({items:[{id:'cancelled',status:'cancelled'}]})}).handler);
  assert.equal(res.body.complete,true); assert.deepEqual(res.body.events,[]);
});
test('malformed provider dates fail the whole source without claiming successful empty coverage',async()=>{
  const store=provider({events:()=>json({items:[event('bad',{start:{dateTime:'2026-02-30T10:00:00Z'}})]})});
  const res=await invoke(store.handler);assert.equal(res.statusCode,200);assert.equal(res.body.complete,false);assert.deepEqual(res.body.completedCalendarIds,[]);assert.deepEqual(res.body.events,[]);assert.equal(res.body.failedCalendars.length,1);
});
test('provider timeout is bounded and returns generic failure without token or provider diagnostics',async()=>{
  let signal;
  const handler=createEventsHandler({fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});},requestTimeoutMs:5,totalTimeoutMs:10});
  const res=await invoke(handler);assert.equal(signal.aborted,true);assert.equal(res.statusCode,503);assert.deepEqual(res.body,{error:'Could not load Google Calendar events.'});
});
