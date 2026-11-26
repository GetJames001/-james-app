const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const sync=require('../calendar-sync.js');
process.env.TZ='America/Los_Angeles';
const day=new Date('2026-12-05T12:00:00-08:00');
const row=(id,title,calendarId,start,end,extra={})=>({id,title,calendarId,calendarName:calendarId,start:'2026-12-05T'+start+':00-08:00',end:'2026-12-05T'+end+':00-08:00',...extra});
const fixtures=[
  row('work','Project review','Work','10:00','11:00',{description:'Bring the updated agenda.'}),
  row('citrus','Plant care','Personal','10:30','11:00',{description:'Water after checking the soil.',iCalUID:'recurring-citrus'}),
  row('food','Plant care','Personal','11:00','11:30',{description:'Use the separate feeding instructions.',iCalUID:'recurring-food'}),
  row('free','Optional focus','Work','10:20','10:40',{showAs:'free'}),
  row('gone','Cancelled event','Personal','10:15','10:45',{status:'cancelled'}),
  row('all','Day note','Personal','00:00','23:00',{allDay:true,start:'2026-12-05',end:'2026-12-06'})
];
test('separate calendars expose actual overlaps but not adjacent, free, cancelled or all-day entries',()=>{
  const {timed,allDay}=sync.eventsForDay(fixtures,day), index=sync.timedOverlaps(timed);
  assert.equal(allDay.length,1);
  assert.deepEqual([...index].map(([a,bs])=>[a[5].id,bs.map(b=>b[5].id)]).sort(),[['citrus',['work']],['work',['citrus']]]);
  assert.equal(timed.find(r=>r[5].id==='food')[5].description,'Use the separate feeding instructions.');
});
test('same invitation copies are not conflicts, while different recurring occurrences can overlap',()=>{
  const inputs=[row('a','Meeting','Work','10:00','11:00',{iCalUID:'shared'}),row('b','Meeting','Personal','10:00','11:00',{iCalUID:'shared'}),row('c','Meeting','Personal','10:30','11:15',{iCalUID:'shared'})];
  const timed=sync.eventsForDay(inputs,day).timed;
  const index=sync.timedOverlaps(timed);
  assert.ok(!index.get(timed[0]).includes(timed[1]));
  assert.ok(index.get(timed[0]).includes(timed[2]));
});
test('actual Appointments renderer flags one overlap and opens each occurrence with its original details',()=>{
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.textContent='';}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(name,value){this.attrs[name]=value;}
    get childElementCount(){return this.children.length;}
    all(){return [this,...this.children.flatMap(c=>c.all())];}
  }
  const fields=new Map();
  const $=key=>{if(!fields.has(key))fields.set(key,new Element(key));return fields.get(key);};
  const ctx=vm.createContext({$,window:{},calendarSyncState:{hasData:true,state:'fresh',complete:true},liveEvents:fixtures,
    JamesCalendarSync:sync,document:{createElement:tag=>new Element(tag)},panel:()=>$('#panelBody').replaceChildren(),
    pretty:t=>t});
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
  vm.runInContext(slice('function appointmentOverlapText','function openAppointmentDate')+
      slice('function renderAppointmentView','function buildCalendar')+
      "localAppointmentDate=()=> '2026-12-05'; shiftAppointmentDate=(value,amount)=>amount===1?'2026-12-06':'2027-03-03'; renderAppointmentView();",ctx);
  const articles=$('#apptList').all().filter(e=>e.tag==='article');
  const notes=articles.flatMap(a=>a.all().filter(e=>e.className==='appointment-overlap').map(e=>e.textContent));
  assert.deepEqual(notes,['Overlaps with Plant care','Overlaps with Project review']);
  const routines=articles.filter(a=>a.all().some(e=>e.textContent==='Plant care'));
  assert.equal(routines.length,2);
  for(const [i,instructions] of ['Water after checking the soil.','Use the separate feeding instructions.'].entries()){
    routines[i].all().find(e=>e.tag==='button').onclick();
    assert.ok($('#panelBody').all().some(e=>e.textContent===instructions));
  }
});
test('actual Briefing hero flags the same overlap, and clears it on fresh data',()=>{
  const fields=new Map();
  const $=key=>{if(!fields.has(key))fields.set(key,{});return fields.get(key);};
  const events=sync.eventsForDay(fixtures,day).timed;
  const work=events.find(r=>r[5].id==='work'), adjacent=events.find(r=>r[5].id==='food');
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const codes=source.slice(source.indexOf('function updateHero'),source.indexOf('function openCalendarEvent'));
  const ctx=vm.createContext({$,events,JamesCalendarSync:sync,calendarSyncState:{hasData:true},
    nextAppointment:()=>work,isOnlineAppointment:()=>true,nextDriveController:null,pretty:t=>t});
  vm.runInContext(codes+'updateHero()',ctx);
  assert.equal($('#nextAppointmentOverlap').textContent,'Overlaps with Plant care');
  assert.equal($('#nextAppointmentOverlap').hidden,false);
  ctx.nextAppointment=()=>adjacent;
  vm.runInContext('updateHero()',ctx);
  assert.equal($('#nextAppointmentOverlap').textContent,'');
  assert.equal($('#nextAppointmentOverlap').hidden,true);
});
test('Hotmail still feeds one shared calendar state if Google is unavailable, in either response order',async()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
 for(const googleFirst of [true,false]){
   const renders=[],notices=[];
   const event={...fixtures[0],calendarName:'Hotmail'};
   const ctx=vm.createContext({
     $:()=>null,AbortSignal,Date,Error,JamesCalendarSync:sync,
     fetch:async()=>({ok:true,json:async()=>({complete:true,events:[event]})}),
     calendarStatus:message=>notices.push(message),updateHero:()=>{},renderAppointmentView:()=>{},renderQuickCalendar:()=>{},renders
   });
   vm.runInContext("let calendarSyncState={hasData:false,state:'loading',complete:false}; function renderCalendarDay(){renders.push({state:calendarSyncState.state, titles:liveEvents.map(e=>e.title)})}"+
     slice('let liveEvents =','let briefingEvents =')+
     slice('function googleEventsFailed','function loadLiveGoogleEvents'),ctx);
   if(googleFirst) vm.runInContext('googleEventsFailed({})',ctx);
   await vm.runInContext('refreshHotmailCalendar()',ctx);
   if(!googleFirst) vm.runInContext('googleEventsFailed({})',ctx);
   assert.equal(renders.at(-1).state,'partial');
   assert.equal(renders.at(-1).titles.join(','),'Project review');
   assert.match(notices.at(-1),/Showing Hotmail events/);
 }
});
