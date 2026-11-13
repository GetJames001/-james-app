'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{gunzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const fixtures=require('./fixtures/mobile-wake-audio.json');
for(const [name,browserType] of [['Chromium',chromium],...(process.env.JAMES_TEST_MOBILE_WEBKIT==='true'?[['WebKit',webkit]]:[])]){
 test(name+': actual offline mobile model recognises synthetic Hey James and rejects comparison phrases',{timeout:180000},async()=>{
  const root=path.join(__dirname,'..'),files=new Set(['/mobile-wake-recognition.js','/mobile-wake-worklet.js','/wake-listener.js','/assets/wake/v1/vosk-0.0.8.js','/assets/wake/v1/vosk-worker-0.0.8.js','/assets/wake/v1/english-0.15.tar.gz']);
  const loginPolicy=fs.readFileSync(path.join(root,'login.html'),'utf8').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const workerPolicy=require('../vercel.json').routes[0].headers['Content-Security-Policy'];
  const server=http.createServer((req,res)=>{
   if(req.url==='/'){res.setHeader('Content-Security-Policy',loginPolicy);res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><button id="start">Start fixture</button><script src="/mobile-wake-recognition.js"></script><script src="/wake-listener.js"></script>');}
   if(req.url.includes('vosk-worker-'))res.setHeader('Content-Security-Policy',workerPolicy);
   if(!files.has(req.url)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript; charset=utf-8':'application/gzip');fs.createReadStream(path.join(root,req.url)).pipe(res);
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
   browser=await browserType.launch();const page=await browser.newPage();const origin='http://127.0.0.1:'+server.address().port,requests=[];page.on('request',request=>requests.push(request.url()));
   await page.goto(origin);assert.equal(requests.some(url=>url.includes('/assets/wake/')),false);
   await page.addScriptTag({url:origin+'/assets/wake/v1/vosk-0.0.8.js'});
   const samples=fixtures.samples.map(sample=>({...sample,wav:gunzipSync(Buffer.from(sample.gzipWav,'base64')).toString('base64')}));
   const results=await page.evaluate(async samples=>{
    const model=new Vosk.Model(new URL('/assets/wake/v1/english-0.15.tar.gz',location.href).href,-2);
    try{
     await new Promise((resolve,reject)=>{model.on('load',event=>event.result?resolve():reject(Error('model load failed')));model.on('error',()=>reject(Error('model failed')));});
     const output=[];
     for(const sample of samples){
      const wav=Uint8Array.from(atob(sample.wav),char=>char.charCodeAt(0)),view=new DataView(wav.buffer);let offset=12,dataStart=0,dataLength=0,sampleRate=0;
      while(offset+8<=wav.length){const id=String.fromCharCode(...wav.subarray(offset,offset+4)),length=view.getUint32(offset+4,true);if(id==='fmt ')sampleRate=view.getUint32(offset+12,true);if(id==='data'){dataStart=offset+8;dataLength=length;break;}offset+=8+length+(length%2);}
      if(!dataStart||!sampleRate)throw Error('invalid WAV fixture');
      const pcm=new Float32Array(dataLength/2+sampleRate*2);for(let i=0;i<dataLength/2;i++)pcm[i]=view.getInt16(dataStart+i*2,true)/32768;
      const recognizer=new model.KaldiRecognizer(sampleRate,JamesMobileWakeGrammar);recognizer.setWords(true);const texts=[];
      await new Promise((resolve,reject)=>{
       const timeout=setTimeout(()=>reject(Error('recognition timeout')),30000);
       let replies=0;const received=event=>{if(event.result?.text!==undefined)texts.push(event.result);if(++replies===2){clearTimeout(timeout);resolve();}};
       recognizer.on('result',received);recognizer.on('partialresult',received);
       recognizer.on('error',()=>{clearTimeout(timeout);reject(Error('recognizer failed'));});
       // Audio and explicit final retrieval each produce one reply, in worker order.
       recognizer.acceptWaveformFloat(pcm,sampleRate);recognizer.retrieveFinalResult();
      });
      recognizer.remove();output.push({name:sample.name,texts});
     }
     return output;
    }finally{model.worker.terminate();}
   },samples);
   for(const sample of fixtures.samples){const result=results.find(result=>result.name===sample.name);const woke=result.texts.some(value=>value?.text==='hey james'&&value.result?.length===2&&value.result.every(word=>Number.isFinite(word.conf)&&word.conf>=0.8));assert.equal(woke,sample.wake,JSON.stringify(result));}
   assert.equal(requests.some(url=>new URL(url).origin!==origin&&!url.startsWith('data:application/octet-stream;base64,')),false,JSON.stringify(requests.map(url=>url.slice(0,160))));
   // Exercise the actual AudioWorklet + recognizer adapter with synthetic sound,
   // never a physical microphone or paid conversation provider.
   await page.evaluate(wav=>{
    window.finished=false;window.releaseVerified=false;window.wakeCount=0;window.fixtureError=null;
    document.querySelector('#start').onclick=async()=>{
     const audio=new AudioContext();await audio.resume();const bytes=Uint8Array.from(atob(wav),c=>c.charCodeAt(0));const decoded=await audio.decodeAudioData(bytes.buffer);
     const buffer=audio.createBuffer(1,decoded.length+audio.sampleRate*3,audio.sampleRate);buffer.getChannelData(0).set(decoded.getChannelData(0),audio.sampleRate);
     const destination=audio.createMediaStreamDestination();let calls=0;
     Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{calls++;const source=audio.createBufferSource();source.buffer=buffer;source.connect(destination);source.start();return destination.stream;}}});
     const listener=JamesWakeListener.create({Recognition:null,onStatus:state=>{window.fixtureState=state;if(state.phase==='paused'&&!window.wakeCount)window.fixtureError=state.message;},onWake:async()=>{window.wakeCount++;window.releaseVerified=destination.stream.getTracks().every(track=>track.readyState==='ended');await listener.disable();await audio.close();window.finished=true;}});
     window.fixtureListener=listener;await listener.enable();
    };
   },samples.find(sample=>sample.wake).wav);
   await page.locator('#start').click();await page.waitForFunction(()=>window.finished||window.fixtureError,{},{timeout:90000});
   assert.equal(await page.evaluate(()=>window.fixtureError),null);assert.equal(await page.evaluate(()=>window.wakeCount),1);assert.equal(await page.evaluate(()=>window.releaseVerified),true);
   assert.equal(requests.some(url=>new URL(url).origin!==origin&&!url.startsWith('data:application/octet-stream;base64,')),false);
   assert.equal(requests.some(url=>url.includes('/api/')),false);
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 });
}
