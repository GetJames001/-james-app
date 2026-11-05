'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('entrance-scenes.js','utf8');
function fixture(prefs,{hour=9,previous=null,denied=false,random=()=>0}={}){
  const values=new Map([['jamesIntroScreen',JSON.stringify(prefs)],['jamesLastEntranceScene',previous]]),props={},events={};
  const window={location:{pathname:'/login',reload(){}},localStorage:{getItem:k=>{if(denied)throw Error('denied');return values.get(k)||null;},setItem:(k,v)=>values.set(k,v)},sessionStorage:{getItem:()=>null},addEventListener:(k,fn)=>events[k]=fn};
  const document={documentElement:{dataset:{},style:{setProperty:(k,v)=>props[k]=v},classList:{add(){}}}};
  const FakeDate=class extends Date{getHours(){return hour;}};
  vm.runInNewContext(source,{window,document,Date:FakeDate,Math:Object.assign(Object.create(Math),{random})});
  return {api:window.JamesEntrance,values,props,events};
}
test('a fixed favorite has its own poster before the video or login form exists',()=>{
  const f=fixture({mode:'fixed',scene:'aurora-from-orbit'});
  assert.equal(f.api.current.name,'aurora-from-orbit');
  assert.equal(f.props['--art'],'url("/login-poster-aurora-from-orbit.jpg")');
  assert.equal(f.props['--welcome-art'],f.props['--art']);
  assert.equal(fixture({mode:'fixed',scene:'aurora-from-orbit'},{previous:'strip-terrace'}).api.current.name,'aurora-from-orbit');
});
test('Automatic follows local time even when favorites exist; malformed preferences safely fall back',()=>{
  for(const [hour,name]of [[5,'night'],[6,'morning'],[11,'noon'],[17,'evening'],[21,'night']]){
    assert.equal(fixture({mode:'automatic',favorites:['aurora-from-orbit']},{hour}).api.current.name,name);
  }
  assert.equal(fixture({mode:'fixed',scene:'../../private'}).api.current.name,'morning');
  assert.equal(fixture(null,{denied:true}).api.current.name,'morning');
});
test('rotation excludes the last favorite when possible and handles one or no favorites',()=>{
  const prefs={mode:'rotate',favorites:['strip-terrace','moonlit-forest','aurora-from-orbit']};
  const first=fixture(prefs,{previous:'strip-terrace'});
  assert.equal(first.api.current.id,'moonlit-forest');
  const next=fixture(prefs,{previous:first.values.get('jamesLastEntranceScene')});
  assert.notEqual(first.api.current.id,next.api.current.id);
  assert.equal(fixture({mode:'rotate',favorites:['strip-terrace']},{previous:'strip-terrace'}).api.current.id,'strip-terrace');
  assert.equal(fixture({mode:'rotate',favorites:[]}).api.current.id,'waterfront');
});
test('poster routes serve only known scene bytes and reject methods and unknown assets',async()=>{
  const gateway=require('../api/gateway.js');
  function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;},end(){return this;}};}
  for(const name of ['morning','oceanfront','strip-terrace','moonlit-forest','aurora-from-orbit']){
    const out=response();await gateway({method:'GET',headers:{host:'www.getjames.ai'},query:{path:'login-poster-'+name+'.jpg'}},out);
    assert.equal(out.statusCode,200);assert.equal(out.headers['Content-Type'],'image/jpeg');
    assert.deepEqual(out.body,fs.readFileSync('assets/scenes/'+name+'.jpg'));
  }
  const method=response();await gateway({method:'POST',headers:{host:'www.getjames.ai'},query:{path:'login-poster-morning.jpg'}},method);assert.equal(method.statusCode,405);
  const unknown=response();await gateway({method:'GET',headers:{host:'www.getjames.ai'},query:{path:'login-poster-unknown.jpg'}},unknown);assert.notEqual(unknown.statusCode,200);
});
