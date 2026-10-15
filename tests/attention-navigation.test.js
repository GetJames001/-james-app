const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const code=source.slice(source.indexOf('function createAttentionSavedReader('),source.indexOf('function openAttentionSavedView('));
function harness(){
 const requests=[],timers=new Map();let tick=0,clears=0;
 const context={AbortController,attentionReader:null,attentionScreen:{clear(){clears++;}}};vm.createContext(context);vm.runInContext(code,context);
 const reader=context.createAttentionSavedReader({fetchImpl:(url,options)=>new Promise((resolve,reject)=>{requests.push({url,options,resolve,reject});options.signal.addEventListener('abort',()=>reject(Error('aborted')));}),setTimer:f=>{timers.set(++tick,f);return tick;},clearTimer:id=>timers.delete(id)});
 context.attentionReader=reader;return {reader,requests,timers,dispose:()=>context.clearAttentionSavedView(),clears:()=>clears};
}
test('leaving Attention cancels request and clears prior account display',async()=>{
 const x=harness(),p=x.reader.read();x.dispose();await assert.rejects(p,/aborted/);assert.equal(x.requests[0].options.signal.aborted,true);assert.equal(x.clears(),1);assert.equal(x.timers.size,0);
});
test('new refresh cancels older request without clearing the newer request',async()=>{
 const x=harness(),first=x.reader.read();const rejection=assert.rejects(first,/aborted/);const second=x.reader.read();await rejection;
 assert.equal(x.requests[1].options.signal.aborted,false);x.reader.cancel();await assert.rejects(second,/aborted/);assert.equal(x.timers.size,0);
});
test('timeout cancels stalled saved-view request',async()=>{
 const x=harness(),p=x.reader.read();[...x.timers.values()][0]();await assert.rejects(p,/aborted/);assert.equal(x.timers.size,0);
});
test('successful saved-view read clears timeout and uses read-only same-origin request',async()=>{
 const x=harness(),p=x.reader.read(),req=x.requests[0];req.resolve({ok:true,json:async()=>({revision:1})});assert.equal((await p).revision,1);assert.equal(x.timers.size,0);assert.equal(req.url,'/api/attention');assert.equal(req.options.method,'GET');assert.equal(req.options.credentials,'same-origin');
});
test('non-success read fails without parsing body',async()=>{
 const x=harness(),p=x.reader.read();let parsed=false;x.requests[0].resolve({ok:false,json:async()=>{parsed=true;}});await assert.rejects(p,/unavailable/);assert.equal(parsed,false);assert.equal(x.timers.size,0);
});
