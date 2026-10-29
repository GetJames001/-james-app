const test=require('node:test');
const assert=require('node:assert/strict');
const sync=require('../calendar-sync.js');
process.env.TZ='America/Los_Angeles';
function event(id,start,end,extra={}){return {id,start,end,title:id,allDay:false,calendarId:'work',...extra};}
test('day projection includes overnight/multiday timed events and exclusive-end all-day spans',()=>{
  const result=sync.eventsForDay([
    event('overnight','2026-10-05T23:00:00-07:00','2026-10-06T08:30:00-07:00'),
    event('multi','2026-10-06T18:00:00-07:00','2026-10-07T10:00:00-07:00'),
    event('all','2026-10-05','2026-10-07',{allDay:true}),
    event('ended','2026-10-04','2026-10-06',{allDay:true}),
    event('midnight-end','2026-10-05T22:00:00-07:00','2026-10-06T00:00:00-07:00'),
    event('future','2026-10-07T09:00:00-07:00','2026-10-07T10:00:00-07:00')
  ],new Date('2026-10-06T12:00:00-07:00'));
  assert.equal(result.date,'2026-10-06');assert.deepEqual(result.timed.map(row=>row.slice(0,2)),[['00:00','08:30'],['18:00','24:00']]);
  assert.deepEqual(result.allDay.map(e=>e.id),['all']);assert.equal(result.timed[0][5].id,'overnight');
});
test('day projection respects actual offsets, DST duration and rejects malformed timestamps/dates',()=>{
  const result=sync.eventsForDay([
    event('fallback','2026-11-01T01:45:00-07:00','2026-11-01T01:15:00-08:00'),
    event('offset','2026-11-02T01:00:00Z','2026-11-02T02:00:00Z'),
    event('no-offset','2026-11-01T11:00:00','2026-11-01T12:00:00'),
    event('malformed','2026-02-30T10:00:00Z','2026-02-30T11:00:00Z'),
    event('bad-all-day','2026-02-30','2026-03-02',{allDay:true})
  ],new Date('2026-11-01T12:00:00-08:00'));
  assert.deepEqual(result.timed.map(row=>row[5].id),['fallback','offset']);assert.equal(result.invalidCount,3);
});
test('partial merge preserves failed/omitted source events, replaces successful empty sources and deduplicates',()=>{
  const old=[event('a','2026-10-06T10:00:00Z','2026-10-06T11:00:00Z'),event('b','2026-10-06T10:00:00Z','2026-10-06T11:00:00Z',{calendarId:'personal'}),event('c','2026-10-06T10:00:00Z','2026-10-06T11:00:00Z',{calendarId:'omitted'})];
  const result=sync.mergePartial(old,{complete:false,completedCalendarIds:['personal'],events:[{...old[0],title:'new'}]});
  assert.deepEqual(result.map(e=>e.id),['a','c']);assert.equal(result[0].title,'new');assert.equal(old[0].title,'a');
  assert.deepEqual(sync.mergePartial(old,{complete:true,events:[]}),[]);
});
function harness(){
  let time=10000,visible=true,open=true,interval=null,starts=0,stops=0;
  const requests=[],successes=[],errors=[];
  const target=()=>{const handlers=new Map();return {addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),dispatch:name=>handlers.get(name)?.()};};
  const documentTarget=target(),windowTarget=target();
  const controller=sync.createCalendarRefreshController({fetchEvents:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),onSuccess:data=>successes.push(data),onError:error=>errors.push(error),isVisible:()=>visible,isCalendarOpen:()=>open,documentTarget,windowTarget,now:()=>time,setIntervalFn:fn=>{interval=fn;starts++;return starts;},clearIntervalFn:()=>{interval=null;stops++;}});
  return {controller,requests,successes,errors,documentTarget,windowTarget,time:value=>time=value,visible:value=>visible=value,open:value=>open=value,tick:()=>interval?.(),starts:()=>starts,stops:()=>stops};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('controller deduplicates initial/manual requests, minimum interval, entry and foreground refresh',async()=>{
  const h=harness();h.controller.start();h.controller.refresh('manual');assert.equal(h.requests.length,1);
  h.requests[0].resolve({events:['first']});await flush();h.time(14999);await h.controller.refresh('manual');assert.equal(h.requests.length,1);
  h.time(15001);h.controller.pageChanged();assert.equal(h.requests.length,2);h.requests[1].resolve({events:['second']});await flush();
  h.time(21000);h.documentTarget.dispatch('visibilitychange');h.windowTarget.dispatch('pageshow');assert.equal(h.requests.length,3);
  h.requests[2].reject(new Error('transient'));await flush();assert.equal(h.successes.length,2);assert.equal(h.errors.length,1);
});
test('controller polls only visible calendar pages, stops and invalidates a prior lifecycle on restart',async()=>{
  const h=harness();h.controller.start();assert.equal(h.controller.isPolling(),true);
  h.visible(false);h.documentTarget.dispatch('visibilitychange');assert.equal(h.controller.isPolling(),false);
  h.visible(true);h.open(false);h.controller.pageChanged();assert.equal(h.controller.isPolling(),false);
  h.open(true);h.controller.pageChanged();assert.equal(h.controller.isPolling(),true);
  h.controller.stop();h.controller.start();assert.equal(h.requests.length,2);
  h.requests[0].resolve({events:['obsolete']});h.requests[1].resolve({events:['current']});await flush();
  assert.deepEqual(h.successes,[{events:['current']}]);h.controller.stop();assert.equal(h.controller.isPolling(),false);
});
test('bounded read aborts a hung transport and controller releases its in-flight request for retry',async()=>{
  let expire,signal,time=10000,calls=0;
  const controller=sync.createCalendarRefreshController({fetchEvents:()=>{calls++;return sync.readCalendar(async(_url,options)=>{signal=options.signal;return new Promise(()=>{});},{setTimeoutFn:fn=>{expire=fn;return 1;},clearTimeoutFn:()=>{}});},documentTarget:{addEventListener(){},removeEventListener(){}},windowTarget:{addEventListener(){},removeEventListener(){}},onSuccess:()=>{},onError:()=>{},isVisible:()=>true,isCalendarOpen:()=>true,now:()=>time,setIntervalFn:()=>1,clearIntervalFn:()=>{}});
  controller.start();expire();await flush();assert.equal(signal.aborted,true);
  time=16000;controller.refresh('manual');assert.equal(calls,2);expire();await flush();controller.stop();
});
