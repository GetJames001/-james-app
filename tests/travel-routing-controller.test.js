'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const block=source.slice(source.indexOf('// Departure locations stay in memory;'),source.indexOf("\n document.addEventListener('DOMContentLoaded',()=>{const menu"));
function setup({location}={}){
 let now=Date.now(),key='appointment-a',hidden=false,calls=0;
 const timers=new Map(),nodes=new Map(),listeners={},pending=[];let timerId=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',disabled:false});return nodes.get(id);};
 const context={console,AbortController,Date:{now:()=>now,parse:Date.parse},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),nextDriveOrigin:null,nextDriveResult:null,nextDriveGeneration:0,nextDriveController:null,refreshNextDriveIfNeeded:()=>{},nextDriveKey:()=>key,nextAppointment:()=>({5:{start:new Date(now+3600000).toISOString(),location:'456 Example Avenue'}}),updateHero(){},$:selector=>node(selector),navigator:{},window:{addEventListener:(name,fn)=>listeners[name]=fn},document:{get hidden(){return hidden;},addEventListener:(name,fn)=>listeners[name]=fn},fetch:async()=>{calls++;return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
 context.window.jamesLocation=location;
 vm.runInNewContext(block,context);listeners.DOMContentLoaded();
 return {context,node,pending,listeners,timers,get calls(){return calls;},key:value=>key=value,advance:ms=>now+=ms,hide:()=>hidden=true,fire(ms){const entry=[...timers].find(([,t])=>t.ms===ms);assert.ok(entry,'expected timer '+ms);timers.delete(entry[0]);entry[1].fn();},resolve(index=0){pending[index].resolve({ok:true,json:async()=>({status:'ready',driveSeconds:1200,trafficDelaySeconds:300,expiresAt:new Date(now+300000).toISOString(),estimatedLeaveBy:new Date(now+1800000).toISOString()})});}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('automatic startup uses an already available shared live fix without a second location tap',async()=>{
 const point={kind:'device',observedAt:Date.now()};
 const h=setup({location:{point:()=>point,snapshot:()=>({enabled:true,status:'ready'})}});
 assert.equal(h.context.nextDriveOrigin,point);h.fire(1000);assert.equal(h.calls,1);
 h.resolve();await settle();assert.equal(h.context.nextDriveResult.driveSeconds,1200);
});
test('blocked automatic routes explain location permission, missing destinations and stale calendars without requests',()=>{
 let state={enabled:true,status:'locating'};
 const h=setup({location:{point:()=>null,snapshot:()=>state}}),c=h.context;
 assert.match(h.node('#routeStatus').textContent,/Waiting for your current location/);
 for(const [status,expected] of [['permission_required',/Allow location/],['denied',/blocked/],['inaccurate',/more precise/],['unavailable',/unavailable/]]){
  state={enabled:true,status};c.refreshNextDriveIfNeeded();assert.match(h.node('#routeStatus').textContent,expected);
 }
 state={enabled:false,status:'off'};c.refreshNextDriveIfNeeded();assert.match(h.node('#routeStatus').textContent,/enable automatic/);
 c.nextAppointment=()=>({5:{start:new Date(c.Date.now()+3600000).toISOString(),location:''}});c.refreshNextDriveIfNeeded();assert.match(h.node('#routeStatus').textContent,/destination address/);
 h.key(null);c.refreshNextDriveIfNeeded();assert.match(h.node('#routeStatus').textContent,/Calendar result/);
 assert.equal(h.calls,0);assert.equal(h.timers.size,0);
});
test('fresh live origin automatically estimates once; failures back off and hidden/stale points do not request',async()=>{
 const h=setup(),c=h.context;
 c.nextDriveOrigin={kind:'device',observedAt:c.Date.now()};c.refreshNextDriveIfNeeded();c.refreshNextDriveIfNeeded();assert.equal(h.timers.size,1);h.fire(1000);assert.equal(h.calls,1);
 h.pending[0].reject(Error('provider failed'));await settle();assert.match(h.node('#routeStatus').textContent,/Route unavailable/);c.refreshNextDriveIfNeeded();assert.equal(h.timers.size,0);
 h.advance(60000);c.refreshNextDriveIfNeeded();assert.equal(h.timers.size,1);h.hide();h.fire(1000);assert.equal(h.calls,1);
 const stale=setup();stale.context.nextDriveOrigin={kind:'device',observedAt:stale.context.Date.now()-300001};stale.context.refreshNextDriveIfNeeded();assert.equal(stale.timers.size,0);
});
test('completed route is reused until expiry and changed appointment discards an old response',async()=>{
 const h=setup(),c=h.context;c.nextDriveOrigin={kind:'address',address:'123 Example Street',confirmed:true};c.refreshNextDriveIfNeeded();h.fire(1000);h.resolve();await settle();assert.equal(c.nextDriveResult.driveSeconds,1200);c.refreshNextDriveIfNeeded();assert.equal(h.timers.size,0);
 h.advance(300001);c.refreshNextDriveIfNeeded();h.fire(1000);h.key('appointment-b');h.resolve(1);await settle();assert.equal(c.nextDriveResult,null);assert.equal(h.node('#routeEstimate').disabled,false);
});
test('an old request cannot enable the refresh button while a newer request is pending',async()=>{
 const h=setup(),c=h.context;c.nextDriveOrigin={kind:'address',address:'123 Example Street',confirmed:true};
 const first=h.node('#routeEstimate').onclick();const second=h.node('#routeEstimate').onclick();assert.equal(h.calls,2);h.resolve(0);await first;assert.equal(h.node('#routeEstimate').disabled,true);h.resolve(1);await second;assert.equal(h.node('#routeEstimate').disabled,false);
});
test('bounded route timeout reports the failure and page exit removes pending automatic work',async()=>{
 const h=setup(),c=h.context;c.nextDriveOrigin={kind:'address',address:'123 Example Street',confirmed:true};const request=h.node('#routeEstimate').onclick();h.fire(15000);assert.equal(c.nextDriveController.signal.aborted,true);h.pending[0].reject(Object.assign(Error(),{name:'AbortError'}));await request;assert.match(h.node('#routeStatus').textContent,/timed out/);
 h.advance(60000);c.refreshNextDriveIfNeeded();h.listeners.pagehide();assert.equal(h.timers.size,0);assert.equal(c.nextDriveOrigin,null);
});


test('a newer location fix replaces an aborted startup estimate promptly without unbounded retrying',async()=>{
 const h=setup(),c=h.context;c.nextDriveOrigin={kind:'device',observedAt:c.Date.now()};
 c.refreshNextDriveIfNeeded();h.fire(1000);assert.equal(h.calls,1);
 for(let index=0;index<3;index++){
  c.nextDriveGeneration++;c.nextDriveController.abort();c.nextDriveOrigin={kind:'device',observedAt:c.Date.now()};
  h.pending[index].reject(Object.assign(Error('new location fix'),{name:'AbortError'}));await settle();
  if(index<2){assert.ok([...h.timers.values()].some(t=>t.ms===1000),'replacement does not wait a minute');h.fire(1000);}
 }
 assert.equal(h.calls,3);assert.equal(h.timers.size,0,'location jitter is limited to three automatic starts per minute');
 h.advance(60000);c.nextDriveOrigin={kind:'device',observedAt:c.Date.now()};c.refreshNextDriveIfNeeded();h.fire(1000);h.resolve(3);await settle();assert.equal(c.nextDriveResult.driveSeconds,1200);
});
