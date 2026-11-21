'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 class Element{constructor(tag){this.tag=tag;this.children=[];this.hidden=false;this.textContent='';this.classList={add(){}};}append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}setAttribute(){} }
 const events={},timers=new Map();let id=0;
 const doc={hidden:false,createElement:tag=>new Element(tag),addEventListener:(name,fn)=>events[name]=fn,removeEventListener:name=>delete events[name]};
 const root=new Element('section');root.ownerDocument=doc;
 const text=node=>[node.textContent,...node.children.map(text)].join(' '),all=node=>[node,...node.children.flatMap(all)];
 return {root,doc,events,timers,text:()=>text(root),all:()=>all(root),setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:id=>timers.delete(id)};
}
const task=(status='running')=>({objective:'Fictional afternoon preparation',status,result:null});
test('compact status distinguishes prepared, blocked, queued, empty and unavailable; refresh failure retains visibly stale status',async()=>{
 const {mountTaskStatus}=await import('../workbench/task-status.mjs'),f=fixture();let payload={revision:1,tasks:[task(),task('blocked'),{...task('completed'),result:{outcome:'prepared',artifact:{title:'Fictional agenda',items:[{time:'09:00',title:'Planning call'}]}}}]},fail=false;
 const view=mountTaskStatus(f.root,{...f,document:f.doc,request:async(url,options)=>{assert.equal(url,'/api/james/task-execution');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');if(fail)throw Error('private provider message');return Response.json(payload);}});
 await flush();assert.equal(f.root.hidden,false);assert.match(f.text(),/Working/);assert.match(f.text(),/Waiting for information/);assert.match(f.text(),/Ready/);assert.match(f.text(),/09:00 · Planning call/);assert.doesNotMatch(f.text(),/artifactKey|planDigest|outcome/);
 fail=true;await view.refresh();assert.match(f.text(),/Showing the last checked status/);assert.match(f.text(),/Planning call/);assert.doesNotMatch(f.text(),/private provider/);
 fail=false;payload={revision:0,tasks:[]};await view.refresh();assert.match(f.text(),/Showing the last checked status/,'older responses cannot erase newer work');
 payload={revision:2,tasks:[task('queued')]};await view.refresh();assert.match(f.text(),/Queued/);assert.doesNotMatch(f.text(),/Working|Ready/);
 payload={revision:3,tasks:[]};await view.refresh();assert.equal(f.root.hidden,true);view.dispose();assert.equal(f.timers.size,0);
});
test('late responses after refresh, visibility loss and disposal cannot restore private task presentation',async()=>{
 const {mountTaskStatus}=await import('../workbench/task-status.mjs'),f=fixture(),pending=[];
 const view=mountTaskStatus(f.root,{...f,document:f.doc,request:(_url,options)=>new Promise(resolve=>pending.push({resolve,signal:options.signal}))});
 const second=view.refresh();assert.equal(pending[0].signal.aborted,true);pending[1].resolve(Response.json({revision:2,tasks:[{...task(),objective:'Current task'}]}));await second;
 pending[0].resolve(Response.json({revision:1,tasks:[{...task(),objective:'Obsolete task'}]}));await flush();assert.match(f.text(),/Current task/);assert.doesNotMatch(f.text(),/Obsolete/);
 f.doc.hidden=true;f.events.visibilitychange();assert.equal(f.root.hidden,true);assert.equal(f.timers.size,0);
 f.doc.hidden=false;f.events.visibilitychange();assert.equal(pending.length,3);view.dispose();pending[2].resolve(Response.json({revision:3,tasks:[task()]}));await flush();assert.equal(f.root.hidden,true);assert.equal(f.root.children.length,0);assert.equal(f.timers.size,0);assert.equal(f.events.visibilitychange,undefined);
});
test('disabled API adds no empty panel or polling, and lost authentication clears previous results',async()=>{
 const {mountTaskStatus}=await import('../workbench/task-status.mjs'),f=fixture();let calls=0;
 const off=mountTaskStatus(f.root,{...f,document:f.doc,request:async()=>{calls++;return new Response('{}',{status:404});}});await flush();assert.equal(f.root.hidden,true);assert.equal(f.timers.size,0);await off.refresh();assert.equal(calls,1);off.dispose();
 let status=200;const view=mountTaskStatus(f.root,{...f,document:f.doc,request:async()=>status===200?Response.json({revision:1,tasks:[task()]}):new Response('{}',{status})});await flush();assert.match(f.text(),/Fictional afternoon/);
 status=401;await view.refresh();assert.match(f.text(),/Sign in again/);assert.doesNotMatch(f.text(),/Fictional afternoon/);view.dispose();
});
test('untrusted task text stays text and a bounded strip expands without a new screen',async()=>{
 const {mountTaskStatus}=await import('../workbench/task-status.mjs'),f=fixture(),tasks=Array.from({length:5},(_,i)=>({...task(),objective:i===0?'<img src=x onerror=alert(1)>':'Task '+i}));
 const view=mountTaskStatus(f.root,{...f,document:f.doc,request:async()=>Response.json({revision:1,tasks})});await flush();assert.equal(f.all().filter(el=>el.tag==='img').length,0);assert.match(f.text(),/<img src=x/);assert.doesNotMatch(f.text(),/Task 4/);
 f.all().find(el=>el.tag==='button'&&el.textContent==='Show all (5)').onclick();assert.match(f.text(),/Task 4/);view.dispose();
});
