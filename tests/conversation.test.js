'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createHeadStore}=require('../lib/conversation/head-store.cjs'),{createHandler}=require('../lib/routes/conversation.js');
async function fixture(){
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
 const ui=root.JamesConversationUI.mount({input,answer,askButton,fetcher,loadRuntime:async()=>[identity,bridge],stopInput:()=>stops++});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 return {input,answer,ui,pending,flush,status:askButton.parentNode.afterElement,stops:()=>stops,store};
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
