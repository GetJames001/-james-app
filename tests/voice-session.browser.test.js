'use strict';
// Real browser + recovered coordinator, synthetic media/provider only.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('voice stays across page changes, rejects stale playback events, and closes microphone on End',async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<link rel="stylesheet" href="/styles.css"><button id="jamesOrb" class="orb mini persistent-orb">James</button><button id="voice">Talk</button><button id="settings">Voice settings</button><script src="/voice-session.js"></script>');}
  if(req.url!=='/assets/orb/james-concierge.svg'&&!/^\/(?:styles\.css|voice-session\.js|realtime-coordinator\.mjs|conversation-bridge\.mjs|turn-timing\.mjs)$/.test(req.url)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':req.url.endsWith('.svg')?'image/svg+xml':'text/javascript');res.end(fs.readFileSync(path.join(__dirname,'..',req.url.slice(1))));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{
   const scope={accountId:'account-fixture',conversationId:'conversation-fixture',generation:1};window.framesSent=[];window.remembered=[];window.peers=0;window.trackStops=0;window.state='idle';window.opened=[];
   const owner={current:()=>scope,snapshotIdentity:async()=>scope};
   class Peer{constructor(){window.peers++;window.peer=this;}createDataChannel(){const channel={readyState:'open',send:data=>window.framesSent.push(JSON.parse(data)),close:()=>{}};window.channel=channel;return channel;}addTrack(){}async createOffer(){return {type:'offer',sdp:'v=0 synthetic'};}async setLocalDescription(){}async setRemoteDescription(){}close(){}}
   const track={enabled:true,stop:()=>window.trackStops++},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
   const ui={prepareVoice:async()=>({scope,history:[],identityOwner:owner}),verifyVoice:async()=>true,detachVoice:()=>{},context:()=>({page:window.contextPage||'files'}),navigate:async door=>{window.opened.push(door);return {status:'ready'};},interruptVoiceReply:()=>{},rememberVoice:async(...args)=>window.remembered.push(args)};
   window.controller=JamesVoiceSession.mount({ui,orb:document.querySelector('#jamesOrb'),button:document.querySelector('#voice'),settingsButton:document.querySelector('#settings'),readWeather:()=>({status:'ready',daylight:{sunrise:'2026-11-06T06:10',sunset:'2026-11-06T16:40',timezone:'America/Los_Angeles'}}),setState:value=>{window.state=value;const orb=document.querySelector('#jamesOrb');orb.classList.remove('listening','thinking','speaking','connecting','muted');if(value!=='idle')orb.classList.add(value);},Peer,media:{getUserMedia:async()=>stream},fetcher:async()=>({ok:true,text:async()=>'v=0 answer'})});
   window.emit=event=>window.channel.onmessage({data:JSON.stringify(event)});
  });
  assert.equal(await page.locator('.james-voice-panel select').count(),0);await page.locator('#settings').click();assert.equal(await page.getByRole('dialog',{name:'James voice settings'}).isVisible(),true);assert.equal(await page.getByLabel('James voice',{exact:true}).inputValue(),'marin');await page.getByRole('button',{name:'Close settings'}).click();
  await page.locator('#voice').click();await page.waitForFunction(()=>!!window.channel);await page.evaluate(()=>window.emit({type:'session.created'}));
  assert.equal(await page.evaluate(()=>window.state),'listening');
  assert.match(await page.locator('#jamesOrb').evaluate(el=>getComputedStyle(el).filter),/drop-shadow/);
  await page.getByRole('button',{name:'Mute microphone',exact:true}).click();assert.equal(await page.evaluate(()=>window.state),'muted');assert.equal(await page.locator('#jamesOrb').getAttribute('data-microphone'),'muted');
  await page.getByRole('button',{name:'Unmute microphone',exact:true}).click();assert.equal(await page.evaluate(()=>window.state),'listening');
  await page.evaluate(()=>{window.dispatchEvent(new Event('james:page-changed'));window.emit({type:'input_audio_buffer.speech_started'});window.emit({type:'input_audio_buffer.speech_stopped'});window.emit({type:'input_audio_buffer.committed',item_id:'audio-1'});});
  await page.waitForFunction(()=>window.framesSent.some(e=>e.type==='response.create'));
  await page.evaluate(()=>{const request=window.framesSent.find(e=>e.type==='response.create');window.emit({type:'response.created',response:{id:'reply-1',metadata:request.response.metadata}});window.emit({type:'output_audio_buffer.started',response_id:'reply-1'});});
  assert.equal(await page.evaluate(()=>window.state),'speaking');
  assert.equal(await page.locator('#jamesOrb').evaluate(el=>getComputedStyle(el).animationName),'jamesConciergeSpeaking');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#jamesOrb').evaluate(el=>getComputedStyle(el).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{window.peer.connectionState='disconnected';window.peer.onconnectionstatechange();});assert.equal(await page.evaluate(()=>window.controller.active()),true);assert.equal(await page.evaluate(()=>window.state),'connecting');
  await page.clock.fastForward(7000);assert.equal(await page.evaluate(()=>window.controller.active()),true);
  await page.evaluate(()=>{window.peer.connectionState='connected';window.peer.onconnectionstatechange();});assert.equal(await page.evaluate(()=>window.state),'speaking');assert.equal(await page.evaluate(()=>window.peers),1);assert.equal(await page.evaluate(()=>window.trackStops),0);
  await page.evaluate(()=>window.emit({type:'response.created',response:{id:'old-reply',metadata:{james_turn_id:'stale',james_request_id:'stale'}}}));
  assert.equal(await page.evaluate(()=>window.state),'speaking');
  await page.evaluate(()=>{window.emit({type:'conversation.item.input_audio_transcription.completed',item_id:'audio-1',transcript:'Open Calendar'});window.emit({type:'response.done',response:{id:'reply-1',status:'completed',output:[{type:'function_call',call_id:'call-1',name:'open_page',arguments:'{"page":"calendar"}'}]}});});
  await page.waitForFunction(()=>window.opened.includes('calendar'));assert.equal(await page.evaluate(()=>window.peers),1);assert.equal(await page.evaluate(()=>window.trackStops),0);
  await page.waitForFunction(()=>window.framesSent.filter(e=>e.type==='response.create').length===2);
  await page.evaluate(()=>{const request=window.framesSent.filter(e=>e.type==='response.create').at(-1);window.emit({type:'response.created',response:{id:'reply-weather',metadata:request.response.metadata}});window.emit({type:'response.done',response:{id:'reply-weather',status:'completed',output:[{type:'function_call',call_id:'weather-1',name:'read_weather',arguments:'{}'}]}});});
  await page.waitForFunction(()=>window.framesSent.some(e=>e.item?.call_id==='weather-1'));assert.equal(await page.evaluate(()=>JSON.parse(window.framesSent.find(e=>e.item?.call_id==='weather-1').item.output).daylight.sunset),'2026-11-06T16:40');
  await page.evaluate(()=>window.dispatchEvent(new Event('james-conversation-ended')));assert.equal(await page.evaluate(()=>window.controller.active()),false);assert.equal(await page.evaluate(()=>window.trackStops),1);
  await page.evaluate(()=>window.emit({type:'output_audio_buffer.started',response_id:'reply-1'}));assert.equal(await page.evaluate(()=>window.state),'idle');
  await page.locator('#voice').click();await page.waitForFunction(()=>window.peers===2);
  await page.evaluate(()=>{window.peer.connectionState='disconnected';window.peer.onconnectionstatechange();});await page.clock.fastForward(8000);assert.equal(await page.evaluate(()=>window.controller.active()),false);assert.equal(await page.evaluate(()=>window.trackStops),2);
  await page.locator('#voice').click();await page.waitForFunction(()=>window.peers===3);
  await page.evaluate(()=>window.emit({type:'error',error:{code:'insufficient_quota'}}));
  assert.equal(await page.evaluate(()=>window.controller.active()),false);
  assert.match(await page.locator('.james-voice-panel').textContent(),/credit or spending limit/);
  await page.evaluate(()=>{window.controller.close();window.contextPage='briefing';localStorage.removeItem('james:daily-welcome:v1');});
  await page.locator('#voice').click();await page.waitForFunction(()=>window.peers===4);await page.evaluate(()=>window.emit({type:'session.created'}));
  await page.waitForFunction(()=>window.framesSent.some(e=>e.item?.content?.[0]?.text?.includes('This is an invitation only')));
  assert.equal(await page.evaluate(()=>window.framesSent.filter(e=>e.item?.content?.[0]?.text?.includes('This is an invitation only')).length),1);
  await page.evaluate(()=>window.controller.close());await page.locator('#voice').click();await page.waitForFunction(()=>window.peers===5);await page.evaluate(()=>window.emit({type:'session.created'}));
  assert.equal(await page.evaluate(()=>window.framesSent.filter(e=>e.item?.content?.[0]?.text?.includes('This is an invitation only')).length),1,'same-day reconnect stays quiet');await page.evaluate(()=>window.controller.close());
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
