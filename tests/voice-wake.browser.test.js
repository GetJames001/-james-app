'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('regular James shares one local wake listener with voice, honours opt-in and releases each microphone',async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<link rel="stylesheet" href="/styles.css"><main id="app"><button id="orb">James</button><button id="talk">Talk</button><button id="voiceSettings">Voice settings</button></main><script src="/wake-listener.js"></script><script src="/wall-display.js"></script><script src="/voice-session.js"></script>');}
  const file=path.join(__dirname,'..',req.url.split('?')[0]);try{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:700}});await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{
   window.starts=0;window.voiceStarts=0;window.providerCalls=0;window.trackStops=0;window.localActive=false;
   class Recognition extends EventTarget{static async available(){return window.unsupported?'unavailable':'available';}constructor(){super();this.processLocally=false;}start(){if(window.localActive)throw Error('Two wake listeners');if(window.jamesVoice?.active())throw Error('Voice owns microphone');window.localActive=true;window.recognition=this;window.starts++;this.onstart?.();}abort(){window.localActive=false;queueMicrotask(()=>this.dispatchEvent(new Event('end')));}}
   window.SpeechRecognition=Recognition;Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})},configurable:true});
   const scope={accountId:'fixture',conversationId:'fixture-conversation',generation:1},owner={current:()=>scope,snapshotIdentity:async()=>scope};
   class Peer{createDataChannel(){return {readyState:'open',send(){},close(){}};}addTrack(){}async createOffer(){return {type:'offer',sdp:'v=0 synthetic'};}async setLocalDescription(){}async setRemoteDescription(){}close(){}}
   localStorage.setItem('james:voice','marin');
   window.jamesVoice=JamesVoiceSession.mount({orb:document.querySelector('#orb'),button:document.querySelector('#talk'),settingsButton:document.querySelector('#voiceSettings'),setState(){},Peer,media:{getUserMedia:async()=>{if(window.localActive)throw Error('Local microphone still held');window.voiceStarts++;const track={enabled:true,stop:()=>window.trackStops++};return {getTracks:()=>[track],getAudioTracks:()=>[track]};}},fetcher:async()=>{window.providerCalls++;return {ok:true,text:async()=>'v=0 answer'};},ui:{prepareVoice:async()=>({scope,history:[],identityOwner:owner}),verifyVoice:async()=>true,detachVoice(){},context:()=>({page:'files'}),interruptVoiceReply(){}}});
   window.jamesWallDisplay=JamesWallDisplay.mount({app:document.querySelector('#app'),fetcher:async()=>({ok:true}),wakeLock:{}});
   window.say=text=>window.recognition.onresult({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]});
  });
  assert.equal(await page.evaluate(()=>window.starts+window.voiceStarts+window.providerCalls),0);
  const settings=page.getByRole('dialog',{name:'James voice settings'});
  await page.locator('#voiceSettings').click();assert.equal(await settings.getByLabel('James voice',{exact:true}).inputValue(),'marin');
  await settings.getByRole('button',{name:'Choose Cedar'}).click();assert.equal(await page.evaluate(()=>localStorage.getItem('james:voice')),'cedar');
  assert.equal(await settings.evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),true);
  await settings.getByRole('button',{name:'Enable Hey James',exact:true}).click();await page.waitForFunction(()=>window.jamesWallDisplay.snapshot().wake.phase==='listening');
  assert.equal(await page.locator('#talk').textContent(),'Hey James · listening');assert.equal(await page.evaluate(()=>window.recognition.processLocally),true);
  await page.evaluate(()=>window.say('James is helpful'));assert.equal(await page.evaluate(()=>window.voiceStarts),0);
  await page.evaluate(()=>window.say('Hey, James'));await page.waitForFunction(()=>window.providerCalls===1);
  assert.equal(await page.evaluate(()=>window.voiceStarts),1);assert.equal(await page.evaluate(()=>window.localActive),false);assert.equal(await page.evaluate(()=>window.jamesWallDisplay.snapshot().mode),'regular');
  await page.getByRole('button',{name:'Close voice',exact:true}).last().click();await page.waitForFunction(()=>window.localActive);assert.equal(await page.evaluate(()=>window.trackStops),1);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>!window.localActive);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>window.localActive);
  await page.locator('#voiceSettings').click();await page.waitForFunction(()=>!window.localActive);await settings.getByRole('button',{name:'Turn wake listening off'}).click();await settings.getByRole('button',{name:'Close settings',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.jamesWallDisplay.snapshot().wake.wanted),false);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('james:wall-display:v1')).regularWake),false);
  await page.evaluate(()=>{window.unsupported=true;});await page.locator('#voiceSettings').click();await settings.getByRole('button',{name:'Enable Hey James',exact:true}).click();await settings.getByText('Local Hey James is unavailable in this browser. Tap to wake still works.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.localActive),false);assert.equal(await page.evaluate(()=>window.providerCalls),1);
  await settings.getByRole('button',{name:'Close settings',exact:true}).click();await page.evaluate(()=>{window.unsupported=false;});await page.locator('#voiceSettings').click();await settings.getByRole('button',{name:'Enable Hey James',exact:true}).click();await page.waitForFunction(()=>window.localActive);
  await page.evaluate(()=>window.dispatchEvent(new Event('james-conversation-ended')));await page.waitForFunction(()=>!window.localActive);assert.equal(await page.evaluate(()=>window.jamesWallDisplay.snapshot().wake.wanted),false);
  assert.equal(await page.evaluate(()=>window.providerCalls),1);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
