'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','welcome.js'),'utf8');
function runAt(hour,minute, opts={}) {
  const videos=[], timers=[], events={};
  const element=()=>({classList:{add(){},remove(){}},setAttribute(){},addEventListener(){},removeAttribute(){},pause(){},load(){},remove(){}});
  const intro=element(),app=element();intro.prepend=v=>videos.push(v);
  const document={documentElement:{dataset:{}},querySelector:()=>null,getElementById:id=>({intro,app})[id],createElement:()=>Object.assign(element(),{play(){return Promise.resolve();}})};
  const window={localStorage:{getItem:k=>k==='jamesAnimation'&&opts.off?'off':null,setItem(){}},sessionStorage:{getItem:k=>k==='jamesIntroDate'&&opts.seen?'today':null,setItem(){}},matchMedia:()=>({matches:!!opts.reduced}),setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},clearTimeout(){},addEventListener:(k,fn)=>events[k]=fn};
  const FakeDate=class extends Date {constructor(...args){super(...(args.length?args:[2026,9,31,hour,minute]));}toDateString(){return 'today';}};
  vm.runInNewContext(source,{window,document,Date:FakeDate});window.JamesWelcome.start();return {src:videos[0]?.src||null, videos,timers,window};
}
for(const [hour,minute,name] of [[5,59,'night'],[6,0,'morning'],[10,59,'morning'],[11,0,'noon'],[16,59,'noon'],[17,0,'evening'],[20,59,'evening'],[21,0,'night']])test('fresh entrance '+hour+':'+String(minute).padStart(2,'0')+' selects '+name,()=>{assert.equal(runAt(hour,minute).src,'assets/scenes/'+name+'.mp4');});
test('reduced-motion uses still image and no video',()=>assert.equal(runAt(17,0,{reduced:true}).videos.length,0));
test('explicit animation-off uses still image and no video',()=>assert.equal(runAt(17,0,{off:true}).videos.length,0));
test('repeat same-day visit does not launch another video',()=>assert.equal(runAt(21,0,{seen:true}).videos.length,0));
