'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('welcome.js','utf8');
function fixture({off=false,reduced=false,reject=false}={}){
 const timers=[],videos=[],events={};
 const make=()=>({inert:false,classList:{add(){},remove(){}},setAttribute(){},addEventListener(){}});
 const intro=make(),app=make();intro.prepend=v=>videos.push(v);
 const document={documentElement:{dataset:{}},querySelector:()=>null,getElementById:id=>({intro,app})[id],createElement(){const v=make();v.events={};v.addEventListener=(k,f)=>v.events[k]=f;v.pause=()=>v.paused=true;v.load=()=>{};v.removeAttribute=()=>{};v.remove=()=>v.removed=true;v.play=()=>reject?Promise.reject(Error('autoplay')):Promise.resolve();return v;}};
 const window={localStorage:{getItem:k=>off&&k==='jamesAnimation'?'off':null},sessionStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:reduced}),setTimeout:(f,ms)=>(timers.push({f,ms}),timers.length),clearTimeout(){},addEventListener:(k,f)=>events[k]=f};
 vm.runInNewContext(source,{window,document,Date});return {api:window.JamesWelcome,timers,videos,events,intro,app};
}
test('local scene periods distinguish morning, noon, evening and night',()=>{const f=fixture();for(const[h,n]of [[0,'night'],[5,'night'],[6,'morning'],[10,'morning'],[11,'noon'],[16,'noon'],[17,'evening'],[20,'evening'],[21,'night']])assert.equal(f.api.sceneForHour(h),n);});
test('muted inline scene never delays entry and remains until dissolve ends',async()=>{const f=fixture();f.api.start();const v=f.videos[0];assert.equal(v.muted,true);assert.equal(v.playsInline,true);assert.equal(f.timers[0].ms,5000);f.timers[0].f();assert.equal(f.app.inert,false);assert.equal(v.removed,undefined);assert.equal(v.paused,true);f.timers.find(t=>t.ms===700).f();assert.equal(v.removed,true);});
test('autoplay rejection and decode errors leave original still and entry deadline',async()=>{const f=fixture({reject:true});f.api.start();await Promise.resolve();await Promise.resolve();assert.equal(f.videos[0].removed,true);f.timers[0].f();assert.equal(f.app.inert,false);const g=fixture();g.api.start();g.videos[0].events.error();assert.equal(g.videos[0].removed,true);g.timers[0].f();assert.equal(g.app.inert,false);});
test('animation off and reduced motion request no video; pagehide releases media',()=>{for(const options of [{off:true},{reduced:true}]){const f=fixture(options);f.api.start();assert.equal(f.videos.length,0);}const f=fixture();f.api.start();f.events.pagehide();assert.equal(f.videos[0].removed,true);assert.equal(f.app.inert,false);});

const auth=require('../lib/auth.js'),gateway=require('../api/gateway.js');
process.env.JAMES_AUTH_EMAIL='scene-fixture@example.test';process.env.JAMES_SESSION_SECRET='scene-fixture-secret-over-thirty-two-characters';
function req(name,method='GET',range,authorized=true){return {method,headers:{host:'www.getjames.ai',...(range?{range}:{}),...(authorized?{cookie:auth.SESSION_COOKIE+'='+auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}:{})},query:{path:'assets/scenes/'+name+'.mp4'}};}
function res(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;},end(){return this;}};}
test('all four actual media files are protected and served byte-exactly',async()=>{for(const n of ['morning','noon','evening','night']){const denied=res();await gateway(req(n,'GET','bytes=0-1',false),denied);assert.equal(denied.statusCode,401);assert.equal(denied.headers['Content-Range'],undefined);const r=res();await gateway(req(n),r);assert.equal(r.statusCode,200);assert.equal(r.headers['Content-Type'],'video/mp4');assert.deepEqual(r.body,fs.readFileSync('assets/scenes/'+n+'.mp4'));assert.match(r.headers['Cache-Control'],/private/);}});
test('Safari byte probes, suffixes, open ranges and HEAD return correct bounds',async()=>{const b=fs.readFileSync('assets/scenes/noon.mp4');for(const [range,start,end] of [['bytes=0-1',0,1],['bytes=-10',b.length-10,b.length-1],['bytes=10-',10,b.length-1],['bytes=0-999999999',0,b.length-1]]){const r=res();await gateway(req('noon','GET',range),r);assert.equal(r.statusCode,206);assert.deepEqual(r.body,b.subarray(start,end+1));assert.equal(r.headers['Content-Range'],`bytes ${start}-${end}/${b.length}`);}const head=res();await gateway(req('noon','HEAD','bytes=0-1'),head);assert.equal(head.statusCode,206);assert.equal(head.body,undefined);assert.equal(head.headers['Content-Length'],2);});
test('invalid/multipart/outside ranges and unknown scene names fail closed',async()=>{for(const range of ['bytes=2-1','bytes=999999999-','bytes=-0','bytes=0-1,3-4','bytes=-','bytes=x-y']){const r=res();await gateway(req('noon','GET',range),r);assert.equal(r.statusCode,416,range);}const r=res();await gateway(req('other'),r);assert.equal(r.statusCode,404);});
test('all newly selectable entrances have matching Preview and sign-in media',async()=>{
  const clips=['strip-terrace','red-rock-terrace','corner-penthouse','fontainebleau-penthouse','moonlit-forest','winter-lodge','beach','red-rock-snow','winter-storm-penthouse','aurora-from-orbit'];
  for(const name of clips){
    const request=req(name,'GET','bytes=0-15',false);
    request.query.path='login-scene-'+name+'.mp4';
    const login=res();
    await gateway(request,login);
    assert.equal(login.statusCode,206,name);
    assert.equal(login.headers['Content-Type'],'video/mp4');
    assert.deepEqual(login.body,fs.readFileSync('assets/scenes/'+name+'.mp4').subarray(0,16));
    const preview=res();
    await gateway(req(name,'GET','bytes=0-15'),preview);
    assert.equal(preview.statusCode,206,name);
    assert.deepEqual(preview.body,login.body);
  }
  const denied=res();
  await gateway(req('strip-terrace','GET','bytes=0-15',false),denied);
  assert.equal(denied.statusCode,401);
});
