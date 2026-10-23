'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createHeadStore}=require('../lib/conversation/head-store.cjs'),{createHandler}=require('../lib/routes/conversation.js');
async function fixture(options={}){
 const identity=await import('../conversation-identity.mjs'),bridge=await import('../conversation-bridge.mjs');
 class Element{constructor(){this.value='';this.textContent='';this.children=[];}append(...elements){this.children.push(...elements)}after(element){this.afterElement=element}setAttribute(){}}
 const doc={createElement:()=>new Element()},input=new Element(),answer=new Element(),askButton=new Element();input.ownerDocument=doc;askButton.parentNode=new Element();
 const data=new Map();let serial=0,stops=0;const pending=[];
 const store=createHeadStore({read:async key=>data.get(key)??null,compareAndSwap:async(key,old,next)=>{if((data.get(key)??null)!==old)return false;data.set(key,next);return true},newId:()=>`conversation-${++serial}`});
 const handler=createHandler({store,authorize:()=>true,identity:()=> 'fictional-owner'});
 const fetcher=async(url,options)=>{
  if(url!=='/api/james/conversation')return new Promise(resolve=>pending.push({options,resolve:value=>resolve({ok:true,json:async()=>({ok:true,answer:value})})}));
  const res={code:200,setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  await handler({method:options.method,headers:{'content-type':'application/json'},body:options.body},res);
  return {ok:res.code>=200&&res.code<300,status:res.code,json:async()=>res.body};
 };
 require('../conversation-ui.js');const root=globalThis;
 const ui=root.JamesConversationUI.mount({input,answer,askButton,fetcher,loadRuntime:async()=>[identity,bridge],stopInput:()=>stops++,...options});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 return {input,answer,ui,pending,flush,fetcher,status:askButton.parentNode.afterElement,stops:()=>stops,store};
}
test('visible typed binding suppresses interrupted answer and retains a changed draft',async()=>{
 const f=await fixture();f.input.value='First';const a=f.ui.ask();await f.flush();assert.equal(f.pending.length,1);
 f.input.value='Correction';const b=f.ui.ask();await f.flush();assert.equal(f.pending.length,2);
 f.input.value='Unsent draft';f.pending[1].resolve('Correct answer');await b;f.pending[0].resolve('Old answer');await a;
 assert.equal(f.answer.textContent,'Correct answer');assert.equal(f.input.value,'Unsent draft');
});
test('End clears history, stops input and prevents delayed reply presentation',async()=>{
 const f=await fixture();f.input.value='Pending';const task=f.ui.ask();await f.flush();await f.ui.end();f.pending[0].resolve('Late answer');await task;
 assert.equal(f.answer.textContent,'');assert.equal(f.status.textContent,'Conversation ended');assert.equal(f.stops(),1);
 f.input.value='New';const next=f.ui.ask();await f.flush();assert.equal(JSON.parse(f.pending[1].options.body).question.includes('Pending'),false);f.pending[1].resolve('New answer');await next;assert.equal(f.answer.textContent,'New answer');
});
test('navigation retains pending typed response and failed request retains draft',async()=>{
 const f=await fixture();f.input.value='Continue';const task=f.ui.ask();await f.flush();assert.equal((await f.ui.navigate('briefing')).status,'ready');f.pending[0].resolve('Still here');await task;assert.equal(f.answer.textContent,'Still here');
 f.input.value='Draft';const failed=f.ui.ask();await f.flush();f.pending[1].resolve('');await failed;assert.equal(f.input.value,'Draft');assert.match(f.status.textContent,/draft is still here/);
});
test('revocation prevents an old answer returning to the screen',async()=>{const f=await fixture();f.input.value='Private';const task=f.ui.ask();await f.flush();f.ui.revoke();f.pending[0].resolve('Private reply');await task;assert.equal(f.answer.textContent,'');assert.equal(f.status.textContent,'Sign in to continue');});
test('stalled reply exits thinking without clearing the draft or accepting a late answer',async()=>{const f=await fixture({requestTimeoutMs:10});f.input.value='Retain this';const task=f.ui.ask();await task;assert.equal(f.input.value,'Retain this');assert.match(f.status.textContent,/could not complete/);f.pending[0].resolve('Too late');await f.flush();assert.equal(f.answer.textContent,'');});
test('browser runtime bundle preserves the recovered modules exactly',()=>{const source=['conversation-identity.mjs','conversation-bridge.mjs'].map(p=>fs.readFileSync(require.resolve('../'+p),'utf8').replace(/export function /g,'function ')).join('\n');const expected="(function(root){\n'use strict';\n"+source+"\nroot.JamesConversationRuntime={createConversationIdentityOwner,createConversationBridge};\n})(typeof window==='undefined'?globalThis:window);\n";assert.equal(fs.readFileSync(require.resolve('../conversation-runtime.js'),'utf8'),expected);require('../conversation-runtime.js');assert.equal(typeof globalThis.JamesConversationRuntime.createConversationBridge,'function');});

test('End before runtime initialization does not claim verified server closure',async()=>{
 const f=await fixture();await f.ui.end();assert.equal(f.status.textContent,'No conversation has started on this screen.');
});
test('lost start response is recovered and server End is confirmed before success',async()=>{
 let f,lose=true;
 f=await fixture({fetcher:async(url,options)=>{const response=await f.fetcher(url,options);if(lose&&JSON.parse(options.body||'{}').action==='ensure'){lose=false;throw Error('Lost response');}return response;}});
 f.input.value='Keep my draft';await f.ui.ask();assert.match(f.status.textContent,/could not complete/);
 await f.ui.end();assert.equal(f.status.textContent,'Conversation ended');
 const head=await f.fetcher('/api/james/conversation',{method:'GET'});assert.equal((await head.json()).status,'ended');
 assert.equal(f.input.value,'Keep my draft');
});
test('unconfirmed End cannot report success or allow a fresh request',async()=>{
 let f,failEnd=false;
 f=await fixture({fetcher:async(url,options)=>{if(failEnd&&JSON.parse(options.body||'{}').action==='end')throw Error('Offline');return f.fetcher(url,options);}});
 f.input.value='First';const task=f.ui.ask();await f.flush();failEnd=true;await f.ui.end();
 assert.match(f.status.textContent,/End is not confirmed/);f.pending[0].resolve('Late');await task;
 f.input.value='Second';await f.ui.ask();assert.equal(f.pending.length,1);assert.match(f.status.textContent,/End is not confirmed/);
 failEnd=false;await f.ui.end();assert.equal(f.status.textContent,'Conversation ended');
});
test('classic browser runtime completes a typed turn through the default loader',async()=>{
 require('../conversation-runtime.js');const f=await fixture({loadRuntime:undefined});
 f.input.value='Bundle check';const task=f.ui.ask();await f.flush();assert.equal(f.pending.length,1);f.pending[0].resolve('Ready');await task;
 assert.equal(f.answer.textContent,'Ready');await f.ui.end();assert.equal(f.status.textContent,'Conversation ended');
});
test('sign-out during End cannot be overwritten by late closure confirmation',async()=>{
 let f,release;
 f=await fixture({fetcher:async(url,options)=>{if(JSON.parse(options.body||'{}').action==='end')await new Promise(resolve=>{release=resolve});return f.fetcher(url,options);}});
 f.input.value='Pending';const task=f.ui.ask();await f.flush();const ending=f.ui.end();await f.flush();f.ui.revoke();release();await ending;
 assert.equal(f.status.textContent,'Sign in to continue');f.pending[0].resolve('Late');await task;assert.equal(f.answer.textContent,'');
});
test('reply deadline aborts the transport while preserving the draft',async()=>{
 const f=await fixture({requestTimeoutMs:10});f.input.value='Transport check';await f.ui.ask();
 assert.equal(f.pending[0].options.signal.aborted,true);assert.equal(f.input.value,'Transport check');assert.match(f.status.textContent,/could not complete/);
});
