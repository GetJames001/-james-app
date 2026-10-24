const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function harness(){
 const nodes=new Map(),listeners={},opened=[],scrolls=[];
 const document={body:{},activeElement:null,addEventListener:(key,fn)=>listeners[key]=fn};
 function node(id){if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,disabled:false,isConnected:true,attrs:{},classList:{open:false,add(){this.open=true},remove(){this.open=false},contains(){return this.open}},setAttribute(k,v){this.attrs[k]=v},focus(){document.activeElement=this},click(){if(!this.disabled)this.onclick?.()},querySelectorAll(){return []}});return nodes.get(id);}
 const now=Date.now();const row=['10:00','11:00','Synthetic review','Test room',null,{start:new Date(now+3600000).toISOString(),end:new Date(now+7200000).toISOString()}];
 const ctx=vm.createContext({document,window:{scrollX:0,scrollY:320,scrollTo:v=>scrolls.push(v)},$:s=>node(s),Date,Math,parseInt,events:[row],calendarSyncState:{hasData:true,state:'ready',complete:true},nextAppointment:()=>row,timeToDate:()=>new Date(now+3600000),pretty:v=>v,openCalendarEvent:value=>{opened.push(value);node('#backdrop').classList.add('open')}});
 vm.runInContext(source.slice(source.indexOf('let displayedNextAppointment'),source.indexOf('function openCalendarEvent(row)')),ctx);
 vm.runInContext(source.slice(source.indexOf('function closePanel(){'),source.indexOf('function speak(text)')),ctx);
 vm.runInContext('bindNextAppointmentDetails()',ctx);
 return {ctx,node,row,document,listeners,opened,scrolls,run:code=>vm.runInContext(code,ctx)};
}
test('displayed appointment opens through the native control and card, with focus and scroll restoration',()=>{
 const h=harness();h.run('updateHero()');const button=h.node('#nextAppointmentDetails');
 assert.equal(button.hidden,false);assert.equal(button.disabled,false);assert.equal(button.attrs['aria-label'],'Open details for Synthetic review');
 button.focus();button.click();assert.equal(h.opened[0],h.row);assert.equal(h.document.activeElement,h.node('#close'));
 h.listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(h.node('#backdrop').classList.open,false);assert.equal(h.document.activeElement,button);assert.equal(h.scrolls[0].top,320);
 h.node('#nextAppointmentCard').onclick({target:{closest:()=>null}});assert.equal(h.opened.length,2);
 h.node('#nextAppointmentCard').onclick({target:{closest:()=>button}});assert.equal(h.opened.length,2);
});
test('unavailable or empty calendar hides and disables details rather than opening an obsolete event',()=>{
 const h=harness();h.run('updateHero()');h.ctx.calendarSyncState.hasData=false;h.run('updateHero()');
 assert.equal(h.node('#nextAppointmentDetails').hidden,true);h.run('openNextAppointmentDetails()');assert.equal(h.opened.length,0);
 h.ctx.calendarSyncState.hasData=true;h.ctx.nextAppointment=()=>null;h.run('updateHero()');assert.equal(h.node('#nextAppointmentDetails').disabled,true);h.run('openNextAppointmentDetails()');assert.equal(h.opened.length,0);
});
test('opening uses the displayed event even when the next-event selector changes between timer ticks',()=>{
 const h=harness();h.run('updateHero()');h.ctx.nextAppointment=()=>['12:00','13:00','Different event'];h.node('#nextAppointmentDetails').click();assert.equal(h.opened[0],h.row);
});
test('keyboard focus remains inside appointment details until closed',()=>{
 const h=harness();h.run('updateHero()');h.node('#nextAppointmentDetails').click();let prevented=false;
 h.listeners.keydown({key:'Tab',shiftKey:false,preventDefault(){prevented=true}});assert.equal(prevented,true);assert.equal(h.document.activeElement,h.node('#close'));
});
test('meeting links wrap focus back to Close in document order',()=>{
 const h=harness();const link=h.node('#meetingLink');h.node('#panelBody').querySelectorAll=()=>[link];h.run('updateHero()');h.node('#nextAppointmentDetails').click();
 h.listeners.keydown({key:'Tab',shiftKey:true,preventDefault(){}});assert.equal(h.document.activeElement,link);
 h.listeners.keydown({key:'Tab',shiftKey:false,preventDefault(){}});assert.equal(h.document.activeElement,h.node('#close'));
});
