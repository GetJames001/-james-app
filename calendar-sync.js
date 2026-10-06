(function exposeCalendarSync(root, factory) {
  const refresh = typeof module === 'object' && module.exports ? require('./mail-refresh.js') : root.PersonalMailRefresh;
  const api = factory(refresh);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JamesCalendarSync = api;
})(typeof window === 'undefined' ? globalThis : window, function buildCalendarSync(refresh) {
  'use strict';
  function localDay(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function validDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date=new Date(value+'T12:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10)===value;
  }
  function validInstant(value) {
    return typeof value==='string' && validDateOnly(value.slice(0,10)) && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  }
  function eventsForDay(sourceEvents, now = new Date()) {
    const date=localDay(now), start=new Date(now.getFullYear(),now.getMonth(),now.getDate()), end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
    const timed=[],allDay=[];let invalidCount=0;
    for(const event of sourceEvents) {
      if(event.allDay) {
        if(!validDateOnly(event.start) || !validDateOnly(event.end) || event.end<=event.start) {invalidCount++;continue;}
        if(event.start<=date && date<event.end) allDay.push(event);
        continue;
      }
      if(!validInstant(event.start) || !validInstant(event.end) || Date.parse(event.end)<=Date.parse(event.start)) {invalidCount++;continue;}
      const eventStart=new Date(event.start),eventEnd=new Date(event.end);
      if(eventStart>=end || eventEnd<=start) continue;
      const clock=value=>`${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`;
      const row=[eventStart<start?'00:00':clock(eventStart),eventEnd>=end?'24:00':clock(eventEnd),String(event.title || 'Untitled event'),String(event.location || event.calendarName || 'Appointment')];
      row[5]=event;
      timed.push(row);
    }
    timed.sort((a,b)=>Date.parse(a[5].start)-Date.parse(b[5].start) || String(a[5].id).localeCompare(String(b[5].id)));
    return {date,timed,allDay,invalidCount};
  }
  function appointmentDays(value, mode='day') {
    if(!validDateOnly(value) || !['day','week'].includes(mode)) throw new Error('Invalid appointment date or view');
    const start=new Date(value+'T12:00:00');
    return Array.from({length:mode==='week'?7:1},(_,index)=>{
      const day=new Date(start.getFullYear(),start.getMonth(),start.getDate()+index,12);
      return {date:localDay(day),day};
    });
  }
  function mergePartial(previous, response) {
    if(response.complete !== false && response.partial !== true) return response.events.slice();
    const completed=new Set(response.completedCalendarIds || []);
    const output=previous.filter(event=>!completed.has(event.calendarId));
    const seen=new Map(output.map((event,index)=>[`${event.calendarId || ''}:${event.id}`,index]));
    for(const event of response.events) {
      const key=`${event.calendarId || ''}:${event.id}`;
      if(seen.has(key)) output[seen.get(key)]=event;
      else {seen.set(key,output.length);output.push(event);}
    }
    return output;
  }
  async function readCalendar(fetchImpl, { timeoutMs=30000, setTimeoutFn=setTimeout, clearTimeoutFn=clearTimeout } = {}) {
    const controller=new AbortController(); let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeoutFn(()=>{controller.abort();reject(new Error('Calendar request timed out'));},timeoutMs);});
    try {
      return await Promise.race([timeout,(async()=>{
        const response=await fetchImpl('/api/google/events',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        const data=await response.json();
        if(!response.ok || !data.connected || !Array.isArray(data.events))throw new Error('Calendar unavailable');
        return data;
      })()]);
    } finally {clearTimeoutFn(timer);}
  }
  function createCalendarRefreshController(options) {
    let controller=null, epoch=0;
    return {
      start(){
        if(controller)return;
        const lifecycle=++epoch;
        controller=refresh.createPersonalMailRefreshController({
          ...options,fetchMail:options.fetchEvents,isMailOpen:options.isCalendarOpen,
          pollIntervalMs:options.pollIntervalMs || 60000,minimumRefreshMs:options.minimumRefreshMs || 5000,
          onSuccess:(data,reason)=>{if(lifecycle===epoch)options.onSuccess(data,reason);},
          onError:(error,reason)=>{if(lifecycle===epoch)options.onError(error,reason);}
        });controller.start();
      },
      stop(){++epoch;if(controller)controller.stop();controller=null;},
      refresh(reason){return controller?controller.refresh(reason):Promise.resolve({skipped:'stopped'});},
      pageChanged(){if(controller)controller.pageChanged();},
      isPolling(){return controller?controller.isPolling():false;}
    };
  }
  return {appointmentDays,eventsForDay,mergePartial,readCalendar,createCalendarRefreshController};
});
