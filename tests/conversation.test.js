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
test('stale Workbench End cannot stop or close a replacement conversation',async()=>{
 const f=await fixture();f.input.value='First conversation';const first=f.ui.ask();await f.flush();f.pending[0].resolve('First ready');await first;
 const old=await f.ui.snapshotIdentity();await f.ui.end();
 f.input.value='Replacement conversation';const next=f.ui.ask();await f.flush();f.pending[1].resolve('Replacement ready');await next;
 const current=await f.ui.snapshotIdentity();assert.notDeepEqual(current,old);
 const stops=f.stops(),status=f.status.textContent;
 assert.equal((await f.ui.end(old)).status,'superseded');assert.equal(f.stops(),stops);assert.equal(f.status.textContent,status);assert.equal(f.answer.textContent,'Replacement ready');
 const head=await f.fetcher('/api/james/conversation',{method:'GET'});const saved=await head.json();assert.equal(saved.status,'ready');assert.equal(saved.conversationId,current.conversationId);
});
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
test('provider model rejection preserves identity for a real server End',async()=>{
 let f;f=await fixture({fetcher:async(url,options)=>url==='/api/fast'?{ok:false,status:502,json:async()=>({ok:false,error:'FAST_MODEL_UNAVAILABLE'})}:f.fetcher(url,options)});
 f.input.value='Retain request';await f.ui.ask();assert.match(f.status.textContent,/configured model is unavailable/);assert.equal(f.input.value,'Retain request');
 await f.ui.end();assert.equal(f.status.textContent,'Conversation ended');const head=await f.fetcher('/api/james/conversation',{method:'GET'});assert.equal((await head.json()).status,'ended');
});
test('actual James session rejection stops thinking and requests sign-in',async()=>{
 let f;f=await fixture({fetcher:async(url,options)=>url==='/api/fast'?{ok:false,status:401,json:async()=>({ok:false,error:'UNAUTHORIZED'})}:f.fetcher(url,options)});
 f.input.value='Retain request';await f.ui.ask();assert.equal(f.status.textContent,'Sign in to continue');assert.equal(f.input.value,'Retain request');assert.equal(f.answer.textContent,'');
});

test('provider failure can retry the retained draft successfully without leaking failed context',async()=>{
 let f,fail=true;
 f=await fixture({fetcher:async(url,options)=>{
  if(url==='/api/fast'&&fail)return {ok:false,status:502,json:async()=>({ok:false,error:'FAST_MODEL_UNAVAILABLE'})};
  return f.fetcher(url,options);
 }});
 f.input.value='Retry this synthetic request';await f.ui.ask();
 assert.equal(f.input.value,'Retry this synthetic request');assert.match(f.status.textContent,/unavailable/);
 fail=false;const retry=f.ui.ask();await f.flush();assert.equal(f.pending.length,1);
 f.pending[0].resolve('Recovered');await retry;
 assert.equal(f.answer.textContent,'Recovered');assert.equal(f.input.value,'');
 await f.ui.end();assert.equal((await(await f.fetcher('/api/james/conversation',{method:'GET'})).json()).status,'ended');
});
test('separate UI sessions do not present a revoked session delayed answer',async()=>{
 const first=await fixture(),second=await fixture();
 first.input.value='First session synthetic request';const old=first.ui.ask();await first.flush();first.ui.revoke();
 second.input.value='Second session synthetic request';const current=second.ui.ask();await second.flush();
 second.pending[0].resolve('Second session answer');await current;
 first.pending[0].resolve('First session delayed answer');await old;
 assert.equal(first.answer.textContent,'');assert.equal(first.status.textContent,'Sign in to continue');
 assert.equal(second.answer.textContent,'Second session answer');assert.equal(second.input.value,'');
 assert.equal(first.input.value,'First session synthetic request');
});

test('Workbench can read ended identity without reopening conversation or clearing End',async()=>{
 const f=await fixture();f.input.value='Create fixture conversation';const ask=f.ui.ask();await f.flush();f.pending[0].resolve('Fixture ready');await ask;await f.ui.end();
 const before=await(await f.fetcher('/api/james/conversation',{method:'GET'})).json();assert.equal(before.status,'ended');
 const scope=await f.ui.snapshotWorkspaceIdentity();assert.equal(scope.conversationId,before.conversationId);assert.equal(scope.generation,before.generation);
 assert.equal((await(await f.fetcher('/api/james/conversation',{method:'GET'})).json()).status,'ended');assert.equal(f.status.textContent,'Conversation ended');
});

test('Workbench uses existing James conversation and keeps unsent Briefing text',async()=>{
 const f=await fixture();f.input.value='Unsent Briefing draft';
 const project={title:'QA Project',objective:'Compare two layouts',versions:[],decisions:[],constraints:[]};
 const first=f.ui.askWorkbench('Suggest a next step',project);await f.flush();assert.equal(f.pending.length,1);assert.match(JSON.parse(f.pending[0].options.body).question,/QA Project/);
 f.pending[0].resolve('Review the layout');assert.deepEqual(await first,{status:'completed',answer:'Review the layout'});assert.equal(f.input.value,'Unsent Briefing draft');
 const scope=await f.ui.snapshotIdentity();f.input.value='Continue';const second=f.ui.ask();await f.flush();assert.deepEqual(await f.ui.snapshotIdentity(),scope);assert.match(JSON.parse(f.pending[1].options.body).question,/Review the layout/);f.pending[1].resolve('Continuing');await second;
});
test('cancelled Workbench reply cannot appear late or end the conversation',async()=>{
 const f=await fixture();const task=f.ui.askWorkbench('Keep this request',{title:'QA',versions:[]});await f.flush();const scope=await f.ui.snapshotIdentity();f.ui.cancelReply();f.pending[0].resolve('Late project answer');assert.equal(await task,undefined);assert.equal(f.answer.textContent,'');assert.deepEqual(await f.ui.snapshotIdentity(),scope);assert.match(f.status.textContent,/cancelled/);
});
test('failed Workbench reply returns a failure without clearing Briefing draft',async()=>{
 const f=await fixture();f.input.value='Unsent';const task=f.ui.askWorkbench('Help',{title:'QA',versions:[]});await f.flush();f.pending[0].resolve('');const result=await task;assert.equal(result.status,'failed');assert.equal(f.input.value,'Unsent');
});

test('repeated Workbench context stays within provider input limit and hands off scope before reply',async()=>{
 const f=await fixture();let started=0;
 const project={title:'QA',objective:'x'.repeat(1000),nextAction:'y'.repeat(500),versions:[{id:'v',content:'z'.repeat(2500)}],selectedArtifactVersionId:'v'};
 for(let i=0;i<3;i++){const task=f.ui.askWorkbench('Help '+i+' '+ 'q'.repeat(2500),project,()=>started++);await f.flush();assert.equal(started,i+1);const q=JSON.parse(f.pending[i].options.body).question;assert.ok(q.length<=12000);f.pending[i].resolve('Answer '+i);assert.equal((await task).status,'completed');}
});
