'use strict';
// Real browser + recovered coordinator, synthetic media/provider only.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('voice stays across page changes, rejects stale playback events, and closes microphone on End',async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<button id="orb">James</button><button id="voice">Talk</button><script src="/voice-session.js"></script>');}
  if(!/^\/(?:voice-session\.js|realtime-coordinator\.mjs|conversation-bridge\.mjs|turn-timing\.mjs)$/.test(req.url)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(__dirname,'..',req.url.slice(1))));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{
   const scope={accountId:'account-fixture',conversationId:'conversation-fixture',generation:1};window.framesSent=[];window.remembered=[];window.peers=0;window.trackStops=0;window.state='idle';window.opened=[];
   const owner={current:()=>scope,snapshotIdentity:async()=>scope};
   class Peer{constructor(){window.peers++;}createDataChannel(){const channel={readyState:'open',send:data=>window.framesSent.push(JSON.parse(data)),close:()=>{}};window.channel=channel;return channel;}addTrack(){}async createOffer(){return {type:'offer',sdp:'v=0 synthetic'};}async setLocalDescription(){}async setRemoteDescription(){}close(){}}
   const track={enabled:true,stop:()=>window.trackStops++},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
   const ui={prepareVoice:async()=>({scope,history:[],identityOwner:owner}),verifyVoice:async()=>true,detachVoice:()=>{},context:()=>({page:'files'}),navigate:async door=>{window.opened.push(door);return {status:'ready'};},interruptVoiceReply:()=>{},rememberVoice:async(...args)=>window.remembered.push(args)};
   window.controller=JamesVoiceSession.mount({ui,orb:document.querySelector('#orb'),button:document.querySelector('#voice'),setState:value=>window.state=value,Peer,media:{getUserMedia:async()=>stream},fetcher:async()=>({ok:true,text:async()=>'v=0 answer'})});
   window.emit=event=>window.channel.onmessage({data:JSON.stringify(event)});
  });
  await page.locator('#orb').click();await page.waitForFunction(()=>!!window.channel);await page.evaluate(()=>window.emit({type:'session.created'}));
  assert.equal(await page.evaluate(()=>window.state),'listening');
  await page.evaluate(()=>{window.dispatchEvent(new Event('james:page-changed'));window.emit({type:'input_audio_buffer.speech_started'});window.emit({type:'input_audio_buffer.speech_stopped'});window.emit({type:'input_audio_buffer.committed',item_id:'audio-1'});});
  await page.waitForFunction(()=>window.framesSent.some(e=>e.type==='response.create'));
  await page.evaluate(()=>{const request=window.framesSent.find(e=>e.type==='response.create');window.emit({type:'response.created',response:{id:'reply-1',metadata:request.response.metadata}});window.emit({type:'output_audio_buffer.started',response_id:'reply-1'});});
  assert.equal(await page.evaluate(()=>window.state),'speaking');
  await page.evaluate(()=>window.emit({type:'response.created',response:{id:'old-reply',metadata:{james_turn_id:'stale',james_request_id:'stale'}}}));
  assert.equal(await page.evaluate(()=>window.state),'speaking');
  await page.evaluate(()=>{window.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'audio-1',transcript:'Open Calendar'});window.emit({type:'response.done',response:{id:'reply-1',status:'completed',output:[{type:'function_call',call_id:'call-1',name:'open_page',arguments:'{"page":"calendar"}'}]}});});
  await page.waitForFunction(()=>window.opened.includes('calendar'));assert.equal(await page.evaluate(()=>window.peers),1);assert.equal(await page.evaluate(()=>window.trackStops),0);
  await page.evaluate(()=>window.dispatchEvent(new Event('james-conversation-ended')));assert.equal(await page.evaluate(()=>window.controller.active()),false);assert.equal(await page.evaluate(()=>window.trackStops),1);
  await page.evaluate(()=>window.emit({type:'output_audio_buffer.started',response_id:'reply-1'}));assert.equal(await page.evaluate(()=>window.state),'idle');
  await page.locator('#orb').click();await page.waitForFunction(()=>window.peers===2);
  await page.evaluate(()=>window.emit({type:'error',error:{code:'insufficient_quota'}}));
  assert.equal(await page.evaluate(()=>window.controller.active()),false);
  assert.match(await page.locator('.james-voice-panel').textContent(),/credit or spending limit/);
  for(const [name,expected] of [['NotFoundError','No microphone is available'],['NotReadableError','The microphone could not start'],['NotAllowedError','Allow microphone access']]){
   await page.evaluate(name=>{const orb=document.createElement('button');orb.id='failure-orb';document.body.append(orb);window.failure=JamesVoiceSession.mount({ui:{},orb,setState:()=>{},Peer:class{},media:{getUserMedia:async()=>{throw new DOMException('Synthetic',name);}}});},name);
   await page.locator('#failure-orb').click();
   await page.waitForFunction(()=>document.querySelectorAll('.james-voice-panel')[document.querySelectorAll('.james-voice-panel').length-1].textContent.includes('microphone'));
   assert.match(await page.locator('.james-voice-panel').last().textContent(),new RegExp(expected));
   assert.equal(await page.evaluate(()=>window.failure.active()),false);
   await page.evaluate(()=>document.querySelector('#failure-orb').remove());
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
