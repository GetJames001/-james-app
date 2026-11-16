const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function harness({point=null,response={ok:true,json:async()=>({current:{temperature_2m:87.6,weather_code:0}})},saved=null}={}){
 const nodes={'#weatherTemp':{textContent:'—'},'#weatherDetail':{textContent:'—'}},calls=[];let requests=0;
 const context=vm.createContext({console:{error(){}},document:{readyState:'loading',addEventListener(){},querySelector:s=>nodes[s]||null,querySelectorAll:()=>[]},navigator:{geolocation:{getCurrentPosition(){requests++;}}},window:{jamesLocation:{point:()=>point}},localStorage:{getItem:()=>saved&&JSON.stringify(saved)},sessionStorage:{getItem:()=>null},fetch:async url=>{calls.push(url);return typeof response==='function'?response(url):response;}});
 vm.runInContext(source,context);return {nodes,calls,context,requests:()=>requests,setPoint:p=>point=p,load:async()=>{vm.runInContext('loadLiveWeather()',context);await new Promise(r=>setImmediate(r));}};
}
test('weather uses the shared current point without a second geolocation lookup',async()=>{const h=harness({point:{latitude:35.91234,longitude:-115.21234,observedAt:Date.now()}});await h.load();assert.match(h.calls[0],/latitude=35.91/);assert.equal(h.nodes['#weatherTemp'].textContent,'88°');assert.equal(h.nodes['#weatherDetail'].textContent,'Clear');assert.equal(h.requests(),0);});
test('weather follows a changed shared point on the next refresh',async()=>{const h=harness({point:{latitude:36,longitude:-115,observedAt:Date.now()}});await h.load();h.setPoint({latitude:44.05,longitude:-123.09,observedAt:Date.now()});await h.load();assert.match(h.calls[1],/latitude=44.05.*longitude=-123.09/);assert.equal(h.requests(),0);});
test('weather has an honest empty state without a shared point or saved location',async()=>{const h=harness();await h.load();assert.equal(h.calls.length,0);assert.equal(h.nodes['#weatherTemp'].textContent,'—');assert.equal(h.nodes['#weatherDetail'].textContent,'Location needed');});
test('weather reports API failure without changing the location controller',async()=>{const h=harness({point:{latitude:36,longitude:-115,observedAt:Date.now()},response:{ok:false,json:async()=>({})}});await h.load();assert.equal(h.nodes['#weatherDetail'].textContent,'Weather unavailable');assert.equal(h.requests(),0);});
test('cached weather is explicitly last known and never treated as current location',async()=>{const h=harness({saved:{latitude:36,longitude:-115,savedAt:Date.now()-60000}});await h.load();assert.equal(h.nodes['#weatherDetail'].textContent,'Last known location · Clear');assert.equal(vm.runInContext('readJamesWeather().location.status',h.context),'last_known');assert.equal(h.requests(),0);});
test('expired cached coordinates do not trigger weather or permission requests',async()=>{const h=harness({saved:{latitude:36,longitude:-115,savedAt:Date.now()-8*86400000}});await h.load();assert.equal(h.calls.length,0);assert.equal(h.requests(),0);});
test('late weather from a previous location cannot overwrite the newer location',async()=>{let release;const h=harness({point:{latitude:36,longitude:-115,observedAt:Date.now()},response:async url=>{if(url.includes('latitude=36'))await new Promise(r=>release=r);return {ok:true,json:async()=>({current:{temperature_2m:url.includes('latitude=36')?90:50,weather_code:0}})};}});await h.load();h.setPoint({latitude:44,longitude:-123,observedAt:Date.now()});await h.load();release();await new Promise(r=>setImmediate(r));assert.equal(h.nodes['#weatherTemp'].textContent,'50°');});

test('repeated weather refreshes share a pending request for the same rounded area',async()=>{
 let complete;
 const h=harness({point:{latitude:36,longitude:-115,observedAt:Date.now()},response:()=>new Promise(resolve=>complete=resolve)});
 await h.load();await h.load();
 assert.equal(h.calls.length,1);
 complete({ok:true,json:async()=>({current:{temperature_2m:80,weather_code:0}})});
 await h.load();assert.equal(h.calls.length,1);assert.equal(h.nodes['#weatherTemp'].textContent,'80°');
});

test('every supported report has bundled animated and reduced-motion artwork',()=>{
 const h=harness();
 for(const day of [0,1]){
  for(const code of [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]){
   const [,icon]=vm.runInContext('weatherAppearance('+code+','+day+')',h.context);
   for(const mode of ['svg','svg-static']){
    const file=fs.readFileSync(path.join(__dirname,'../assets/meteocons',mode,icon+'.svg'),'utf8');
    assert.match(file,/<svg/);
    assert.equal(/<animate(?:Transform)?\b/.test(file),mode==='svg',mode+' '+icon);
   }
  }
 }
 assert.equal(vm.runInContext('weatherAppearance(0,0)[1]',h.context),'clear-night');
 assert.equal(vm.runInContext('weatherAppearance(61,1)[1]',h.context),'rain');
 assert.equal(vm.runInContext('weatherAppearance(999,1)[1]',h.context),'');
});
test('local report selects the icon and clearing location hides it',async()=>{
 const h=harness({point:{latitude:36.17,longitude:-115.14}}),img={},source={};
 const picture={querySelector:s=>s==='source'?source:img};h.nodes['#weatherGraphic']=picture;
 await h.load();assert.equal(img.src,'/assets/meteocons/svg/clear-day.svg');
 assert.equal(source.srcset,'/assets/meteocons/svg-static/clear-day.svg');
 assert.equal(picture.hidden,false);
 h.setPoint(null);await h.load();assert.equal(picture.hidden,true);
});
