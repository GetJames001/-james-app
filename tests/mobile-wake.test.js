'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {create}=require('../wake-listener');
const source=fs.readFileSync(require.resolve('../mobile-wake-recognition'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<20&&!check();i++)await flush();assert.ok(check(),'fixture reached expected startup state');}
function fixture({deferModel=false,deferMic=false,deferDecoder=false,deferResume=false}={}){
 let models=0,mics=0,ended=0,stops=0,terminations=0,closed=0,model,recognizer,resolveMic;
 const track={stop(){stops++;}},stream={getTracks:()=>[track]},doc={hidden:false};
 class Model{constructor(){models++;model=this;this.events={};this.worker={terminate(){terminations++;}};if(!deferModel)setImmediate(()=>this.events.load?.({result:true}));}on(name,fn){this.events[name]=fn;}get KaldiRecognizer(){return class{constructor(){recognizer=this;this.events={};this.chunks=[];}setWords(){}on(name,fn){this.events[name]=fn;}acceptWaveformFloat(chunk){this.chunks.push(chunk);if(this.chunks.length===1&&!deferDecoder)setImmediate(()=>this.events.partialresult?.({result:{partial:''}}));}};}}
 class Context{constructor(){this.state='running';this.sampleRate=48000;this.audioWorklet={addModule:async()=>{}};}resume(){return deferResume?new Promise(()=>{}):Promise.resolve();}async close(){closed++;this.state='closed';}createMediaStreamSource(){return {connect(){},disconnect(){}};}}
 const root={isSecureContext:true,WebAssembly:{},Worker:class{},AudioWorkletNode:class{constructor(){this.port={close(){}};}connect(){}disconnect(){}},AudioContext:Context,document:doc,location:{href:'https://james.example/'},navigator:{mediaDevices:{getUserMedia(){mics++;return deferMic?new Promise(r=>resolveMic=r):Promise.resolve(stream);}}},Vosk:{Model}};
 vm.runInNewContext(source,{window:root,EventTarget,Event,URL,setTimeout,clearTimeout,Date,Float32Array});
 const engine=new root.JamesMobileWakeRecognition();engine.addEventListener('end',()=>ended++);
 return {engine,doc,root,stream,model:()=>model,recognizer:()=>recognizer,resolveMic:()=>resolveMic(stream),counts:()=>({models,mics,ended,stops,terminations,closed})};
}
test('portable wake is lazy, local, and only emits the exact confident wake phrase',async()=>{
 const f=fixture();assert.equal(f.counts().models+f.counts().mics,0);let wakes=0;f.engine.onresult=()=>wakes++;f.engine.start();await until(()=>Boolean(f.engine.node));
 const emit=result=>f.recognizer().events.result({result});
 emit({text:'hey jane',result:[{conf:1},{conf:1}]});emit({text:'hey james',result:[{conf:0.2},{conf:1}]});assert.equal(wakes,0);
 emit({text:'hey james',result:[{conf:0.99},{conf:0.99}]});assert.equal(wakes,1);
 f.doc.hidden=true;emit({text:'hey james',result:[{conf:1},{conf:1}]});assert.equal(wakes,1);
 f.engine.abort();await flush();assert.equal(f.counts().ended,1);assert.ok(f.counts().stops>=1);assert.equal(f.counts().terminations,1);assert.equal(f.counts().closed,1);
});
test('off during model loading terminates the worker and never opens the microphone',async()=>{
 const f=fixture({deferModel:true});f.engine.start();await flush();f.engine.abort();await flush();f.model().events.load({result:true});await flush();assert.equal(f.counts().mics,0);assert.equal(f.counts().terminations,1);assert.equal(f.counts().ended,1);
});
test('delayed microphone permission cannot outlive off or acknowledge release prematurely',async()=>{
 const f=fixture({deferMic:true});f.engine.start();await until(()=>f.counts().mics===1);assert.equal(f.counts().mics,1);f.engine.abort();await flush();assert.equal(f.counts().ended,0);f.resolveMic();await flush();assert.ok(f.counts().stops>=1);assert.equal(f.counts().ended,1);
});
test('portable fallback uses the same release-before-voice contract',async()=>{
 const f=fixture();let wakes=0;
 const listener=create({Recognition:null,MobileRecognition:f.root.JamesMobileWakeRecognition,document:f.doc,onWake:async()=>{assert.ok(f.counts().stops>=1);assert.equal(f.counts().terminations,1);wakes++;}});
 await listener.enable();await until(()=>f.counts().mics===1);f.recognizer().events.result({result:{text:'hey james',result:[{conf:1},{conf:1}]}});await flush();assert.equal(wakes,1);await listener.disable();
});
test('only six exact licensed static wake assets bypass the app gateway',async()=>{
 const config=require('../vercel.json'),route=config.routes[0],match=new RegExp(route.src),gateway=require('../api/gateway');
 for(const filename of ['vosk-0.0.8.js','vosk-worker-0.0.8.js','english-0.15.tar.gz','manifest.json','NOTICE.txt','LICENSE.txt'])assert.ok(match.test('/assets/wake/v1/'+filename));
 for(const filename of ['../app.js','model-secret.txt','english-0x15.tar.gz','manifest.json/extra','../../api/tasks'])assert.equal(match.test('/assets/wake/v1/'+filename),false);
 for(const path of ['mobile-wake-recognition.js','mobile-wake-worklet.js','api/james/voice','assets/wake/other.json']){const response={setHeader(){},status(n){this.code=n;return this;},json(){return this;},end(){return this;}};await gateway({method:'GET',headers:{host:'www.getjames.ai'},query:{path}},response);assert.equal(response.code,401);}
});

test('decoder readiness precedes microphone capture and cancellation releases pending startup',async()=>{
 const f=fixture({deferDecoder:true});f.engine.start();await flush();await flush();assert.equal(f.counts().mics,0);
 f.engine.abort();await flush();f.recognizer().events.partialresult({result:{partial:''}});await flush();
 assert.equal(f.counts().mics,0);assert.equal(f.counts().ended,1);assert.equal(f.counts().terminations,1);
 const suspended=fixture({deferResume:true});suspended.engine.start();await flush();suspended.engine.abort();await flush();assert.equal(suspended.counts().models,0);assert.equal(suspended.counts().mics,0);assert.equal(suspended.counts().ended,1);
});
test('brief decoder delay preserves audio order and sustained overload stops without silent gaps',async()=>{
 const f=fixture();f.engine.start();await flush();await flush();await flush();
 const feed=value=>f.engine.node.port.onmessage({data:new Float32Array([value])});
 for(let value=1;value<=5;value++)feed(value);
 assert.deepEqual(f.recognizer().chunks.slice(1).map(chunk=>chunk[0]),[1,2]);
 for(let i=0;i<5;i++)f.recognizer().events.partialresult({result:{partial:''}});
 assert.deepEqual(f.recognizer().chunks.slice(1).map(chunk=>chunk[0]),[1,2,3,4,5]);assert.equal(f.engine.queue.length,0);
 let errors=0;f.engine.onerror=()=>errors++;
 for(let value=6;value<=14;value++)feed(value);
 await flush();assert.equal(errors,1);assert.equal(f.counts().ended,1);assert.ok(f.counts().stops>=1);assert.equal(f.engine.queue.length,0);
});
