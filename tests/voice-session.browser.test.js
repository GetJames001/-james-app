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
   const ui={prepareVoice:async()=>({scope,history:[],identityOwner:owner}),verifyVoice:async()=>true,detachVoice:()=>{},context:()=>({page:window.contextPage||'files',timezone:'America/Los_Angeles'}),navigate:async door=>{window.opened.push(door);return {status:'ready'};},interruptVoiceReply:()=>{},rememberVoice:async(...args)=>window.remembered.push(args)};
   const createElement=document.createElement.bind(document);document.createElement=(tag,...args)=>{const node=createElement(tag,...args);if(tag==='audio')window.voiceAudio=node;return node;};Peer.prototype.getAudioMuted=()=>window.voiceAudio.muted;
   window.prepared=[];window.forecasts=[];window.controller=JamesVoiceSession.mount({ui,readTrips:async()=>({status:'ready',trips:[{title:'Las Vegas to Eugene',start:'2026-11-22',stops:['Reno overnight','Bend for 3 hours']}]}),readForecast:async args=>{window.forecasts.push(args);return {status:'ready',date:args.date,location:args.location,coverage:'daily city forecast'};},readBriefing:()=>({calendar:{google:{hasData:true,state:'fresh',complete:true,fetchedAt:new Date().toISOString()}}}),prepareAppointment:async details=>{window.prepared.push(details);return {status:"review_required"};},orb:document.querySelector('#jamesOrb'),button:document.querySelector('#voice'),settingsButton:document.querySelector('#settings'),readWeather:()=>({status:'ready',daylight:{sunrise:'2026-11-06T06:10',sunset:'2026-11-06T16:40',timezone:'America/Los_Angeles'}}),setState:value=>{window.state=value;const orb=document.querySelector('#jamesOrb');orb.classList.remove('listening','thinking','speaking','connecting','muted');if(value!=='idle')orb.classList.add(value);},Peer,media:{getUserMedia:async()=>stream},fetcher:async()=>({ok:true,text:async()=>'v=0 answer'})});
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
  await page.evaluate(()=>{const request=window.framesSent.filter(e=>e.type==='response.create').at(-1);window.emit({type:'response.created',response:{id:'reply-weather',metadata:request.response.metadata}});window.continuationAudioMuted=window.peer.getAudioMuted();window.emit({type:'response.done',response:{id:'reply-weather',status:'completed',output:[{type:'function_call',call_id:'weather-1',name:'read_weather',arguments:'{}'}]}});});
  assert.equal(await page.evaluate(()=>window.continuationAudioMuted),false,'tool continuation keeps existing audio audible without another output_audio_buffer.started');
  await page.waitForFunction(()=>window.framesSent.some(e=>e.item?.call_id==='weather-1'));assert.equal(await page.evaluate(()=>JSON.parse(window.framesSent.find(e=>e.item?.call_id==='weather-1').item.output).daylight.sunset),'2026-11-06T16:40');
  await page.waitForFunction(()=>window.framesSent.filter(e=>e.type==='response.create').length===3);
  await page.evaluate(()=>{const request=window.framesSent.filter(e=>e.type==='response.create').at(-1);window.emit({type:'response.created',response:{id:'reply-draft',metadata:request.response.metadata}});window.emit({type:'response.done',response:{id:'reply-draft',status:'completed',output:[{type:'function_call',call_id:'draft-1',name:'prepare_appointment',arguments:JSON.stringify({title:'Fixture',location:'Confirmed address',start:'2026-12-01T18:00:00-08:00',end:'2026-12-01T19:00:00-08:00',timeZone:'America/Los_Angeles'})}]}});});
  await page.waitForFunction(()=>window.framesSent.some(e=>e.item?.call_id==='draft-1'));assert.equal(await page.evaluate(()=>window.prepared.length),1);assert.equal(await page.evaluate(()=>JSON.parse(window.framesSent.find(e=>e.item?.call_id==='draft-1').item.output).status),'review_required');
  await page.waitForFunction(()=>window.framesSent.filter(e=>e.type==='response.create').length===4);
  for(const [name,args,id] of [['read_trips',{},'saved-trip-read'],['read_forecast',{location:'Bend, Oregon',country:'US',date:'2026-11-23'},'trip-forecast'],['read_forecast',{location:'Bend, Oregon',country:'US',date:'2026-11-23',extra:true},'bad-forecast']]){
   const before=await page.evaluate(()=>window.framesSent.filter(e=>e.type==='response.create').length);
   await page.evaluate(({name,args,id})=>{const request=window.framesSent.filter(e=>e.type==='response.create').at(-1);window.emit({type:'response.created',response:{id,metadata:request.response.metadata}});window.emit({type:'response.done',response:{id,status:'completed',output:[{type:'function_call',call_id:id,name,arguments:JSON.stringify(args)}]}});},{name,args,id});
   await page.waitForFunction(id=>window.framesSent.some(e=>e.item?.call_id===id),id);
   await page.waitForFunction(before=>window.framesSent.filter(e=>e.type==='response.create').length>before,before);
  }
  assert.equal(await page.evaluate(()=>JSON.parse(window.framesSent.find(e=>e.item?.call_id==='saved-trip-read').item.output).trips[0].title),'Las Vegas to Eugene');
  assert.deepEqual(await page.evaluate(()=>window.forecasts),[{location:'Bend, Oregon',country:'US',date:'2026-11-23'}]);
  assert.equal(await page.evaluate(()=>JSON.parse(window.framesSent.find(e=>e.item?.call_id==='bad-forecast').item.output).status),'unavailable');
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
  await page.clock.setFixedTime(new Date('2026-11-12T16:00:00Z'));
  await page.evaluate(()=>{window.contextPage='files';localStorage.removeItem('james:morning-outfit:v1:account-fixture');});
  async function morningRead(label){
   const before=await page.evaluate(()=>window.framesSent.filter(e=>e.type==='response.create').length);
   await page.evaluate(label=>{window.emit({type:'input_audio_buffer.speech_started'});window.emit({type:'input_audio_buffer.speech_stopped'});window.emit({type:'input_audio_buffer.committed',item_id:label});},label);
   await page.waitForFunction(before=>window.framesSent.filter(e=>e.type==='response.create').length>before,before);
   await page.evaluate(label=>{const request=window.framesSent.filter(e=>e.type==='response.create').at(-1);window.emit({type:'response.created',response:{id:label+'-read',metadata:request.response.metadata}});window.emit({type:'response.done',response:{id:label+'-read',status:'completed',output:[{type:'function_call',call_id:label,name:'read_briefing',arguments:'{}'}]}});},label);
   await page.waitForFunction(label=>window.framesSent.some(e=>e.item?.call_id===label),label);
   await page.waitForFunction(before=>window.framesSent.filter(e=>e.type==='response.create').length>before+1,before);
   return page.evaluate(label=>JSON.parse(window.framesSent.find(e=>e.item?.call_id===label).item.output),label);
  }
  await page.locator('#voice').click();await page.waitForFunction(()=>window.peers===6);await page.evaluate(()=>window.emit({type:'session.created'}));
  assert.equal((await morningRead('morning-one')).wardrobe.morningOffer,'available');
  assert.equal(await page.evaluate(()=>localStorage.getItem('james:morning-outfit:v1:account-fixture')),null,'tool read alone is not delivery');
  await page.evaluate(()=>{const request=window.framesSent.filter(e=>e.type==='response.create').at(-1);window.emit({type:'response.created',response:{id:'morning-offer',metadata:request.response.metadata}});window.emit({type:'output_audio_buffer.started',response_id:'morning-offer'});window.emit({type:'response.output_audio_transcript.delta',response_id:'morning-offer',delta:'Would you like help choosing an outfit for today?'});window.emit({type:'response.done',response:{id:'morning-offer',status:'completed',output:[]}});window.emit({type:'output_audio_buffer.stopped',response_id:'morning-offer'});});
  await page.waitForFunction(()=>localStorage.getItem('james:morning-outfit:v1:account-fixture')==='2026-11-12');
  await page.evaluate(()=>window.controller.close());await page.locator('#voice').click();await page.waitForFunction(()=>window.peers===7);await page.evaluate(()=>window.emit({type:'session.created'}));
  assert.equal((await morningRead('morning-two')).wardrobe.morningOffer,'not_due','same-morning reconnect does not repeat the offer');
  await page.evaluate(()=>{const request=window.framesSent.filter(e=>e.type==='response.create').at(-1);window.emit({type:'response.created',response:{id:'wardrobe-navigation',metadata:request.response.metadata}});window.emit({type:'response.done',response:{id:'wardrobe-navigation',status:'completed',output:[{type:'function_call',call_id:'wardrobe-open',name:'open_page',arguments:'{"page":"wardrobe"}'}]}});});
  await page.waitForFunction(()=>window.opened.includes('wardrobe'));assert.equal(await page.evaluate(()=>window.controller.active()),true);await page.evaluate(()=>window.controller.close());
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


test('Archer uses text tool continuation and speaks final reply once; setup failure starts no microphone',async()=>{
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');
  if(req.url==='/')return res.end('<button id="orb">James</button><button id="settings">Settings</button><script src="/voice-session.js"></script>');
  if(!/^\/(voice-session\.js|realtime-coordinator\.mjs|conversation-bridge\.mjs|turn-timing\.mjs)$/.test(req.url)){res.statusCode=404;return res.end();}
  res.end(fs.readFileSync(path.join(__dirname,'..',req.url.slice(1))));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{
   const scope={accountId:'account-fixture',conversationId:'conversation-fixture',generation:1};window.sent=[];window.spoken=[];window.micStarts=0;window.archerReady=false;window.opened=[];
   const createElement=document.createElement.bind(document);document.createElement=(tag,...args)=>tag==='audio'?{muted:true,setAttribute(){},removeAttribute(){},pause(){},async play(){window.playedAudio=this;}}:createElement(tag,...args);
   class Peer{createDataChannel(){return window.channel={readyState:'open',send:data=>window.sent.push(JSON.parse(data)),close(){}};}addTrack(){}async createOffer(){return {sdp:'v=0 fixture'};}async setLocalDescription(){}async setRemoteDescription(){}close(){}}
   const track={enabled:true,stop(){}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
   const ui={prepareVoice:async()=>({scope,history:[],identityOwner:{current:()=>scope,snapshotIdentity:async()=>scope}}),verifyVoice:async()=>true,detachVoice(){},context:()=>({page:'recipes'}),navigate:async page=>{window.opened.push(page);return {status:'ready'};},interruptVoiceReply(){},rememberVoice:async()=>{}};
   window.controller=JamesVoiceSession.mount({ui,orb:document.querySelector('#orb'),settingsButton:document.querySelector('#settings'),setState:state=>window.state=state,Peer,media:{getUserMedia:async()=>{window.micStarts++;return stream;}},fetcher:async(url,options)=>{
    if(url==='/api/james/speech'){if(options.method!=='POST')return {ok:true,json:async()=>({ready:window.archerReady,reason:'connection_required'})};window.spoken.push(JSON.parse(options.body).text);return {ok:true,blob:async()=>new Blob(['fixture'],{type:'audio/mpeg'})};}
    window.negotiatedVoice=JSON.parse(options.body).voice;return {ok:true,text:async()=>'v=0 answer'};
   }});
   window.emit=event=>window.channel.onmessage({data:JSON.stringify(event)});
  });
  await page.locator('#settings').click();await page.getByLabel('James voice',{exact:true}).selectOption('archer');await page.getByRole('button',{name:'Close settings'}).click();
  await page.locator('#orb').click();await page.waitForFunction(()=>window.state==='idle');assert.equal(await page.evaluate(()=>window.micStarts),0);assert.match(await page.locator('.james-voice-panel').textContent(),/not configured/);
  await page.evaluate(()=>window.archerReady=true);await page.locator('#orb').click();await page.waitForFunction(()=>!!window.channel);await page.evaluate(()=>{window.emit({type:'session.created'});window.emit({type:'input_audio_buffer.speech_started'});window.emit({type:'input_audio_buffer.speech_stopped'});window.emit({type:'input_audio_buffer.committed',item_id:'archer-one'});});
  await page.waitForFunction(()=>window.sent.some(e=>e.type==='response.create'));
  await page.evaluate(()=>{const req=window.sent.find(e=>e.type==='response.create');window.textOnly=req.response.output_modalities;window.emit({type:'response.created',response:{id:'open-recipe',metadata:req.response.metadata}});window.emit({type:'response.done',response:{id:'open-recipe',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Sure.'}]},{type:'function_call',call_id:'open-one',name:'open_page',arguments:'{"page":"recipes"}'}]}});});
  await page.waitForFunction(()=>window.sent.filter(e=>e.type==='response.create').length===2);assert.deepEqual(await page.evaluate(()=>window.textOnly),['text']);assert.deepEqual(await page.evaluate(()=>window.opened),['recipes']);assert.equal(await page.evaluate(()=>window.spoken.length),0);
  await page.evaluate(()=>{const req=window.sent.filter(e=>e.type==='response.create').at(-1);window.emit({type:'response.created',response:{id:'recipe-ready',metadata:req.response.metadata}});window.emit({type:'response.output_text.delta',response_id:'recipe-ready',delta:'Recipes is open. Choose a recipe and I’ll guide you.'});window.emit({type:'response.done',response:{id:'recipe-ready',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Recipes is open. Choose a recipe and I’ll guide you.'}]}]}});});
  await page.waitForFunction(()=>window.state==='speaking');assert.deepEqual(await page.evaluate(()=>window.spoken),['Recipes is open. Choose a recipe and I’ll guide you.']);assert.equal(await page.evaluate(()=>window.negotiatedVoice),'archer');
  await page.evaluate(()=>window.playedAudio.onended());assert.equal(await page.evaluate(()=>window.state),'listening');await page.evaluate(()=>window.controller.close());
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});


test('voice surfaces missing input, transcription and provider failures instead of silent listening',async()=>{
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');
  if(req.url==='/')return res.end('<button id="orb">James</button><script src="/voice-session.js"></script>');
  if(!/^\/(voice-session\.js|realtime-coordinator\.mjs|conversation-bridge\.mjs|turn-timing\.mjs)$/.test(req.url)){res.statusCode=404;return res.end();}
  res.end(fs.readFileSync(path.join(__dirname,'..',req.url.slice(1))));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{
   const scope={accountId:'fixture',conversationId:'fixture-conversation',generation:1};window.sent=[];window.packets=0;window.stops=0;
   class Peer{createDataChannel(){return window.channel={readyState:'open',send:data=>window.sent.push(JSON.parse(data)),close(){}};}addTrack(){}async createOffer(){return {sdp:'v=0 fixture'};}async setLocalDescription(){}async setRemoteDescription(){}async getStats(){return new Map([['audio',{type:'outbound-rtp',kind:'audio',packetsSent:window.packets}]]);}close(){}}
   const track={enabled:true,readyState:'live',stop(){window.stops++;}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
   const ui={prepareVoice:async()=>({scope,history:[],identityOwner:{current:()=>scope,snapshotIdentity:async()=>scope}}),verifyVoice:async()=>true,detachVoice(){},context:()=>({page:'travel'}),navigate:async()=>({status:'ready'}),interruptVoiceReply(){},rememberVoice:async()=>{}};
   window.controller=JamesVoiceSession.mount({ui,orb:document.querySelector('#orb'),setState:s=>window.state=s,Peer,media:{getUserMedia:async()=>stream},fetcher:async()=>({ok:true,text:async()=>'v=0 answer'})});
   window.emit=e=>window.channel.onmessage({data:JSON.stringify(e)});
  });
  async function start(){await page.evaluate(()=>{window.channel=null;window.sent=[];});await page.locator('#orb').click();await page.waitForFunction(()=>!!window.channel);await page.evaluate(()=>window.emit({type:'session.created'}));}
  await start();await page.clock.runFor(21000);await page.waitForFunction(()=>!window.controller.active());assert.match(await page.locator('.james-voice-panel').textContent(),/no audio is reaching James/);assert.equal(await page.evaluate(()=>window.stops),1);
  const failed=await page.evaluate(()=>window.controller.diagnostics());assert.equal(failed.active,false);assert.equal(failed.audioPackets,0);assert.match(failed.reason,/no audio is reaching James/);assert.deepEqual(failed.microphone,[{state:'live',enabled:true,muted:false}]);assert.equal(Object.hasOwn(failed,'transcript'),false);
  assert.equal(await page.getByRole('button',{name:'Reconnect to James'}).isVisible(),true);await page.getByText('Connection details · Voice check 2',{exact:true}).isVisible();assert.match(await page.locator('.james-voice-panel pre').textContent(),/no audio is reaching James/);assert.equal(await page.locator('.james-voice-panel details').evaluate(el=>el.open),true);
  await page.evaluate(()=>{window.packets=100;window.channel=null;});await page.getByRole('button',{name:'Reconnect to James'}).click();await page.waitForFunction(()=>!!window.channel);await page.evaluate(()=>window.emit({type:'session.created'}));assert.equal(await page.evaluate(()=>window.controller.active()),true);assert.equal(await page.getByRole('button',{name:'Reconnect to James'}).isVisible(),false);await page.evaluate(()=>window.controller.close());
  await page.evaluate(()=>window.packets=100);await start();await page.clock.runFor(21000);assert.equal(await page.evaluate(()=>window.controller.active()),true);assert.match(await page.locator('.james-voice-panel').textContent(),/has not detected speech/);
  await page.evaluate(()=>{window.emit({type:'input_audio_buffer.speech_started'});window.emit({type:'input_audio_buffer.speech_stopped'});window.emit({type:'input_audio_buffer.committed',item_id:'audio-1'});});
  await page.waitForFunction(()=>window.sent.some(e=>e.type==='response.create'));
  await page.evaluate(()=>window.emit({type:'error',error:{event_id:window.sent.find(e=>e.type==='response.create').event_id,code:'insufficient_quota'}}));
  assert.equal(await page.evaluate(()=>window.controller.active()),false);assert.match(await page.locator('.james-voice-panel').textContent(),/credit or spending limit/);
  await start();await page.evaluate(()=>{window.emit({type:'input_audio_buffer.committed',item_id:'audio-2'});window.emit({type:'conversation.item.input_audio_transcription.failed',item_id:'stale',error:{}});});assert.equal(await page.evaluate(()=>window.controller.active()),true);
  await page.evaluate(()=>window.emit({type:'conversation.item.input_audio_transcription.failed',item_id:'audio-2',error:{}}));assert.equal(await page.evaluate(()=>window.controller.active()),false);assert.match(await page.locator('.james-voice-panel').textContent(),/could not transcribe/);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
