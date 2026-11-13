'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../wake-listener');
function fixture(available='available'){
 let starts=0,aborts=0,wakes=0,current;const states=[],doc={hidden:false};
 class Recognition extends EventTarget{static async available(options){assert.equal(options.processLocally,true);return available;}static async install(options){assert.equal(options.processLocally,true);return true;}constructor(){super();this.processLocally=false;}start(){starts++;current=this;assert.equal(this.processLocally,true);this.onstart?.();}abort(){aborts++;queueMicrotask(()=>this.dispatchEvent(new Event('end')));}}
 const listener=create({Recognition,document:doc,permissions:{query:async()=>({state:'granted'})},onStatus:s=>states.push(s),onWake:async()=>wakes++});return {listener,doc,states,starts:()=>starts,aborts:()=>aborts,wakes:()=>wakes,emit:text=>current.onresult({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]})};
}
test('no mic before opt-in; only Hey James wakes and abort/end precedes handoff',async()=>{const f=fixture();assert.equal(f.starts(),0);await f.listener.enable();assert.equal(f.starts(),1);await f.emit('James said the weather is clear');assert.equal(f.wakes(),0);await f.emit('Hey, James');assert.equal(f.wakes(),1);assert.equal(f.aborts(),1);assert.equal(f.listener.snapshot().localOnly,true);await f.listener.disable();});
test('unsupported and downloadable browsers never fall back to remote audio',async()=>{for(const state of ['unavailable','downloadable']){const f=fixture(state);await f.listener.enable();assert.equal(f.starts(),0);assert.equal(f.listener.snapshot().phase,state==='downloadable'?'download_required':'unsupported');}const listener=create({Recognition:class{},document:{hidden:false}});await listener.enable();assert.equal(listener.snapshot().phase,'unsupported');});
test('pause releases microphone and hidden documents cannot restart it',async()=>{const f=fixture();await f.listener.enable();f.doc.hidden=true;await f.listener.pause();await f.listener.resume();assert.equal(f.starts(),1);f.doc.hidden=false;await f.listener.resume();assert.equal(f.starts(),2);await f.listener.disable();assert.equal(f.aborts(),2);});
test('permission denial on noninteractive resume never requests microphone',async()=>{let starts=0;class Recognition{static async available(){return 'available';}constructor(){this.processLocally=false;}start(){starts++;}}const listener=create({Recognition,document:{hidden:false},permissions:{query:async()=>({state:'prompt'})}});await listener.restore();assert.equal(starts,0);assert.equal(listener.snapshot().phase,'permission_required');assert.equal(listener.snapshot().wanted,false);await listener.enable();assert.equal(starts,1);});

test('external talk link is consumed once and waits for an explicit microphone action',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const doc=new EventTarget();
 const node=()=>({addEventListener(){},children:[],dataset:{},options:[],append(...children){this.children.push(...children);this.options.push(...children);},setAttribute(){},focus(){this.focused=true;}});
 doc.createElement=node;doc.body=node();doc.hidden=false;
 const root=new EventTarget(),location={hash:'#talk-to-james',pathname:'/',search:'?view=briefing'};
 let micCalls=0,wakes=0;
 Object.assign(root,{location,history:{state:null,replaceState(_state,_title,path){assert.equal(path,'/?view=briefing');location.hash='';}},navigator:{},jamesWallDisplay:{wake(){wakes++;}}});
 vm.runInNewContext(fs.readFileSync(require.resolve('../voice-session'),'utf8'),{window:root,fetch,CustomEvent});
 const orb={...node(),ownerDocument:doc};
 const voice=root.JamesVoiceSession.mount({ui:{},orb,setState(){},media:{getUserMedia(){micCalls++;}}});
 voice.showExternalLaunch();voice.showExternalLaunch();
 const panel=doc.body.children[0],start=panel.children.find(child=>child.textContent==='Start conversation');
 assert.equal(panel.hidden,false);assert.equal(start.hidden,false);assert.equal(start.focused,true);
 assert.equal(wakes,1);assert.equal(micCalls,0);assert.equal(voice.active(),false);
});

test('a cancelled handoff cannot start voice after microphone release arrives late',async()=>{
 let current,wakes=0;
 class Recognition extends EventTarget{static async available(){return 'available';}constructor(){super();this.processLocally=false;}start(){current=this;this.onstart?.();}abort(){}}
 const listener=create({Recognition,document:{hidden:false},onWake:async()=>wakes++});
 await listener.enable();const pending=current.onresult({resultIndex:0,results:[Object.assign([{transcript:'Hey James'}],{isFinal:true})]});
 const cancelled=listener.disable();current.dispatchEvent(new Event('end'));await Promise.all([pending,cancelled]);assert.equal(wakes,0);
});
