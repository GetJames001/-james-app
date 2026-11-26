(function(root){
 'use strict';
 const audioSessionOwners=new WeakMap();
 // Optional, document-scoped duplex hint. Never request another microphone or
 // overwrite another feature's later choice when releasing our ownership.
 function acquireDuplexAudioSession(navigator){
  try{
   const audioSession=navigator?.audioSession;if(!audioSession)return ()=>{};
   let owner=audioSessionOwners.get(audioSession);
   if(!owner){const previous=audioSession.type;audioSession.type='play-and-record';owner={previous,count:0};audioSessionOwners.set(audioSession,owner);}
   owner.count++;let released=false;
   return ()=>{if(released)return;released=true;if(--owner.count)return;audioSessionOwners.delete(audioSession);try{if(audioSession.type==='play-and-record')audioSession.type=owner.previous;}catch{}};
  }catch{return ()=>{};}
 }
 function createArcherPlayback({audio,fetcher,scope,isCurrent,onSpeaking,onEnded,onError,urlAPI=root.URL}){
  let epoch=0,controller=null,url=null;
  // Do not interrupt the browser audio session when no Archer media was loaded.
  // Speech onset still invalidates pending fetches and real playback immediately.
  function cancel(){++epoch;controller?.abort();controller=null;audio.onended=audio.onerror=null;if(url){audio.pause();audio.removeAttribute('src');urlAPI.revokeObjectURL(url);url=null;}}
  async function play(text){
   cancel();const turn=epoch;controller=new AbortController();
   const live=()=>turn===epoch&&isCurrent();
   try{
    const response=await fetcher('/api/james/speech',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,text}),signal:controller.signal});
    if(!live())return;
    if(!response.ok){const data=await response.json();throw Error(data.error||'ARCHER_SPEECH_FAILED');}
    const blob=await response.blob();if(!live())return;
    url=urlAPI.createObjectURL(blob);audio.src=url;audio.muted=false;
    // Natural completion must not pause/reset media while capture continues.
    audio.onended=()=>{if(!live())return;++epoch;controller=null;audio.onended=audio.onerror=null;if(url){urlAPI.revokeObjectURL(url);url=null;}onEnded();};
    audio.onerror=()=>{if(!live())return;cancel();onError('ARCHER_PLAYBACK_FAILED');};
    await audio.play();if(live())onSpeaking();
   }catch(error){if(live()){cancel();onError(error.name==='NotAllowedError'?'ARCHER_PLAYBACK_BLOCKED':error.message);}}
  }
  return {play,cancel};
 }
 function createMorningOutfitOffer({storage,now=()=>new Date()}={}){
  const delivered=new Set();
  function candidate(scope,context,briefing){
   try{
    if(typeof scope?.accountId!=='string'||!scope.accountId)return null;
    const current=now(),parts=new Intl.DateTimeFormat('en-US',{timeZone:context?.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(current),part=type=>parts.find(value=>value.type===type)?.value;
    const hour=Number(part('hour'));if(hour<5||hour>=12)return null;
    const calendar=briefing?.calendar?.google,checked=Date.parse(calendar?.fetchedAt),age=current.getTime()-checked;
    if(!calendar?.hasData||calendar.complete!==true||!['fresh','ready'].includes(calendar.state)||!Number.isFinite(age)||age<0||age>900000)return null;
    const day=part('year')+'-'+part('month')+'-'+part('day'),key='james:morning-outfit:v1:'+encodeURIComponent(scope.accountId),ticket={key,day};
    if(delivered.has(key+'|'+day))return null;
    try{if(storage?.getItem(key)===day)return null;}catch{}
    return ticket;
   }catch{return null;}
  }
  function markDelivered(ticket){if(!ticket)return;delivered.add(ticket.key+'|'+ticket.day);try{storage?.setItem(ticket.key,ticket.day);}catch{}}
  return {candidate,markDelivered};
 }
 function sampleInputMetadata(s,stats,at=Date.now()){
  let packets=null,captureSeconds=null,energy=null,level=null,outputs=0,sources=0,packetMetrics=0,captureMetrics=0,energyMetrics=0,levelMetrics=0;
  const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  stats?.forEach(row=>{
   if(row.type==='outbound-rtp'&&(row.kind==='audio'||row.mediaType==='audio')){outputs++;if(numeric(row.packetsSent)){packetMetrics++;packets=(packets??0)+row.packetsSent;}}
   if(row.type==='media-source'&&row.kind==='audio'){sources++;if(numeric(row.totalSamplesDuration)){captureMetrics++;captureSeconds=(captureSeconds??0)+row.totalSamplesDuration;}if(numeric(row.totalAudioEnergy)){energyMetrics++;energy=(energy??0)+row.totalAudioEnergy;}if(numeric(row.audioLevel)&&row.audioLevel<=1){levelMetrics++;level=Math.max(level??0,row.audioLevel);}}
  });
  if(packetMetrics!==outputs)packets=null;if(captureMetrics!==sources)captureSeconds=null;if(energyMetrics!==sources)energy=null;if(levelMetrics!==sources)level=null;
  const previous=s.inputStatsPrevious,elapsed=previous?at-previous.at:null;
  const delta=(value,key,countKey,count)=>previous&&elapsed>0&&previous[countKey]===count&&value!==null&&previous[key]!==null&&value>=previous[key]?Number((value-previous[key]).toFixed(6)):null;
  s.audioPackets=packets;
  s.inputProgress={sampledMsSinceReady:Math.max(0,at-(s.readyAt??at)),intervalMs:elapsed>0?elapsed:null,packetDelta:delta(packets,'packets','outputs',outputs),captureSecondsDelta:delta(captureSeconds,'captureSeconds','sources',sources),audioEnergyDelta:delta(energy,'energy','sources',sources),audioLevel:level===null?null:Number(level.toFixed(4))};
  // Keep one numeric baseline only. No track IDs, device labels, audio or transcript.
  s.inputStatsPrevious={at,packets,captureSeconds,energy,outputs,sources};
  return s.inputProgress;
 }
 function noteInputTranscriptionFailure(s,event){
  if(event?.type!=='conversation.item.input_audio_transcription.failed'||typeof s.inputItemId!=='string'||!s.inputItemId||event.item_id!==s.inputItemId)return false;
  // A separate ASR failure must not cancel the native-audio model's response.
  // Keep fixed codes only; provider messages can contain private input.
  const allowed=['transcription_error','audio_unintelligible','server_error','model_not_found','invalid_api_key','insufficient_quota','rate_limit_exceeded','permission_denied'];
  s.inputTranscription={state:'failed',code:allowed.includes(event.error?.code)?event.error.code:'unclassified'};
  return true;
 }
 function mount({ui,orb,button,settingsButton,setState,createReminder=async()=>({status:"unavailable"}),readReminders=()=>({status:"unavailable"}),findPlaces=async()=>({status:"unavailable"}),prepareAppointment=async()=>({status:"unavailable"}),readAppointmentReview=()=>({status:"none"}),readRecipe=action=>root.jamesRecipes?.read(action)||({status:'unavailable'}),readTrips=async()=>root.jamesTripCalendar?.read()||({status:'unavailable'}),readForecast=async({location,country,date})=>{
   try {const response=await fetcher('/api/travel/forecast?'+new URLSearchParams({location,country,date}),{credentials:'same-origin',cache:'no-store'});return response.ok?await response.json():{status:'unavailable'};}catch{return {status:'unavailable'};}
  },readRoute=()=>({status:"unavailable"}),readWeather=()=>({status:"unavailable"}),readBriefing=()=>({status:"unavailable"}),readCalendar=async()=>({status:"unavailable"}),fetcher=fetch,media=root.navigator.mediaDevices,Peer=root.RTCPeerConnection}){
  const doc=orb.ownerDocument,panel=doc.createElement('aside'),status=doc.createElement('p'),transcript=doc.createElement('p'),mute=doc.createElement('button'),stop=doc.createElement('button'),interrupt=doc.createElement('button');
  const launchTalk=doc.createElement('button'),connectionDetails=doc.createElement('details'),connectionSummary=doc.createElement('summary'),connectionReport=doc.createElement('pre');
  connectionSummary.textContent='Connection details';connectionDetails.append(connectionSummary,connectionReport);connectionDetails.hidden=false;connectionReport.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px';
  launchTalk.type='button';launchTalk.textContent='Start conversation';launchTalk.hidden=true;
  panel.className='james-voice-panel';panel.hidden=true;panel.setAttribute('aria-label','James conversation');
  status.setAttribute('role','status');status.className='james-voice-status';transcript.className='james-voice-transcript';
  mute.type=stop.type=interrupt.type='button';mute.textContent='Mute microphone';stop.textContent='Close voice';interrupt.textContent='Stop reply';
  const voiceLabel=doc.createElement('label'),voice=doc.createElement('select'),samples=doc.createElement('a');voiceLabel.textContent='James’s voice ';voice.setAttribute('aria-label','James voice');for(const name of ['marin','coral','shimmer','sage','alloy','ash','ballad','echo','verse','cedar','archer']){const option=doc.createElement('option');option.value=name;option.textContent=name[0].toUpperCase()+name.slice(1);voice.append(option);}try{if([...voice.options].some(o=>o.value===root.localStorage.getItem('james:voice')))voice.value=root.localStorage.getItem('james:voice');}catch{}voice.onchange=()=>{if(session)close('Voice changed. Tap James to reconnect using '+voice.value+'.');try{root.localStorage.setItem('james:voice',voice.value);}catch{}};const updateVoiceDetails=()=>{if(voice.value==='archer'){samples.href='https://runway-static-assets.s3.amazonaws.com/public-model-resources/pier-pledge/voice/Fahco4VZzobUeiPqni1S/3f286c32d9f2d9837ba031facfbd80ad56ee69d58cfdcf44b4aad94b19395532.mp3';samples.textContent='Listen to Archer';note.textContent='Archer uses ElevenLabs speech with James’s existing conversation. A server connection and usage activation are required.';}else{samples.href='https://www.openai.fm/';samples.textContent='Listen to voice samples';note.textContent='AI-generated voice · OpenAI usage is billed separately from Vercel. Sessions end after five minutes.';}};const changeVoice=voice.onchange;voice.onchange=()=>{changeVoice();updateVoiceDetails();};voiceLabel.append(voice);samples.textContent='Listen to voice samples';samples.href='https://www.openai.fm/';samples.target='_blank';samples.rel='noopener noreferrer';const note=doc.createElement('p');note.className='muted';note.textContent='AI-generated voice · OpenAI usage is billed separately from Vercel. Sessions end after five minutes.';const disclosure=doc.createElement('small');disclosure.textContent='AI-generated voice';panel.append(status);doc.body.append(panel);const settings=doc.createElement('dialog'),settingsTitle=doc.createElement('h2'),settingsClose=doc.createElement('button');settings.setAttribute('aria-label','James voice settings');settings.className='james-voice-settings';settingsTitle.textContent='James voice';settingsClose.type='button';settingsClose.textContent='Close settings';settingsClose.onclick=()=>settings.close();settings.append(settingsTitle,voiceLabel,samples,note,settingsClose);doc.body.append(settings);updateVoiceDetails();if(settingsButton){
   settingsButton.onclick=()=>settings.showModal();
   settings.addEventListener('close',()=>{
    const menu=settingsButton.closest?.('.header-preferences');
    if(menu?.open){menu.open=false;menu.querySelector('summary')?.focus({preventScroll:true});}
   });
  }
  const quietPref='james:voice-input-mode:v1',modeLabel=doc.createElement('label'),mode=doc.createElement('select'),talk=doc.createElement('button');
  modeLabel.textContent='Microphone mode ';mode.setAttribute('aria-label','Microphone mode');
  for(const [value,label] of [['standard','Hands-free'],['quiet','Hold to talk (TV or noise)']]){
   const option=doc.createElement('option');option.value=value;option.textContent=label;mode.append(option);
  }
  try{if(root.localStorage.getItem(quietPref)==='quiet')mode.value='quiet';}catch{}
  mode.onchange=()=>{if(session)close('Microphone mode changed. Tap James to reconnect.');try{root.localStorage.setItem(quietPref,mode.value);}catch{}setOrbAction(session?.phase||'idle');};
  modeLabel.append(mode);settings.append(modeLabel);talk.type='button';talk.hidden=true;mute.hidden=false;talk.textContent='Hold to talk';
  talk.className='james-hold-to-talk';talk.style.touchAction='none';talk.style.userSelect='none';talk.setAttribute('aria-pressed','false');
  panel.append(talk,launchTalk,mute,interrupt,stop,transcript,disclosure,connectionDetails);
  let hold=null;
  function refreshTalk(s){
   const phase=s?.manual?.state();
   if(hold&&hold.session===s&&!['clearing','capturing'].includes(phase))hold=null;
   talk.textContent=(!s?.ready&&s?.inputMode==='quiet')?'Hold to talk · connecting':({clearing:'Getting ready…',capturing:hold?.kind==='activate'?'Tap to send':'Speak now · release to send',committing:'Sending…'})[phase]||'Hold to talk';
   talk.setAttribute('aria-pressed',String(phase==='capturing'));
   talk.setAttribute('aria-disabled',String(!s?.ready||!['idle','capturing'].includes(phase)));
  }
  function beginHold(kind,id){
   const s=session;if(!s?.ready||!s.manual||hold||doc.hidden)return false;
   const ticket={kind,id,session:s};hold=ticket;
   if(!s.manual.press(ticket)){hold=null;return false;}
   refreshTalk(s);return true;
  }
  function finishHold(kind,id,cancel=false){
   if(!hold||hold.kind!==kind||hold.id!==id)return;
   const ticket=hold;hold=null;const s=ticket.session;if(!current(s))return;
   const phase=s.manual.state();
   if(cancel)s.manual.cancel(ticket);else s.manual.release(ticket);
   const next=s.manual.state();
   if(current(s)){refreshTalk(s);if(next==='committing')state('thinking','Sending your turn…');else if(phase==='capturing')state('listening');}
  }
  function cancelHold(){if(hold)finishHold(hold.kind,hold.id,true);}
  talk.addEventListener('pointerdown',e=>{if(e.button!==0||e.isPrimary===false)return;e.preventDefault();if(!beginHold('pointer',e.pointerId))return;
   try{talk.setPointerCapture(e.pointerId);}catch{finishHold('pointer',e.pointerId,true);}
  });
  talk.addEventListener('pointerup',e=>finishHold('pointer',e.pointerId));
  talk.addEventListener('pointercancel',e=>finishHold('pointer',e.pointerId,true));
  talk.addEventListener('lostpointercapture',e=>finishHold('pointer',e.pointerId,true));
  talk.addEventListener('keydown',e=>{
   if(e.key==='Escape'){e.preventDefault();cancelHold();return;}
   if(e.key!==' '&&e.key!=='Enter')return;e.preventDefault();if(!e.repeat)beginHold('key',e.key);
  });
  talk.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();finishHold('key',e.key);}});
  // Assistive technologies can activate a native button without providing a hold event.
  talk.addEventListener('click',e=>{if(e.detail!==0)return;if(hold?.kind==='activate')finishHold('activate',0);else beginHold('activate',0);});
  talk.addEventListener('blur',cancelHold);root.addEventListener('blur',cancelHold);
  function failureMessage(code){
   if(code==='ARCHER_CONNECTION_REQUIRED')return 'Archer is selected, but his ElevenLabs API connection is not configured in James yet. Your existing voices remain available in Settings.';
   if(code==='ARCHER_ACTIVATION_REQUIRED')return 'Archer is connected but not activated. Additional voice usage needs approval before enabling him.';
   if(['VOICE_PROVIDER_QUOTA','insufficient_quota','credit_balance_exhausted','billing_hard_limit_reached','project_spend_limit_exceeded','organization_spend_limit_exceeded','organization_usage_limit_exceeded','usage_limit_exceeded'].includes(code))return 'The existing OpenAI API account has reached its credit or spending limit. Voice needs its billing or limits reviewed; your Vercel plan is separate.';
   if(['VOICE_PROVIDER_RATE_LIMIT','rate_limit_exceeded','slow_down'].includes(code))return 'OpenAI temporarily limited voice requests. Wait a minute before reconnecting; this does not establish that credits are exhausted.';
   if(code==='VOICE_PROVIDER_LIMIT')return 'OpenAI limited this voice connection. The response did not establish whether this is a rate or billing limit.';
   if(code==='VOICE_TURN_TIMEOUT')return 'James did not finish responding. Tap James to reconnect; your conversation is retained.';
   if(code==='VOICE_TOOL_LIMIT')return 'James could not complete that many actions together. Tap James and ask for one part at a time.';
   if(code==='VOICE_TRANSPORT_FAILED')return 'The voice connection stopped sending. Tap James to reconnect.';
   if(code==='VOICE_RESPONSE_FAILED')return 'James could not finish that reply. Tap James to retry.';
   return null;
  }
  let session=null,serial=0,lastDiagnostic=null;
  const welcomeMemory=new Map();
  let offerStorage;try{offerStorage=root.localStorage;}catch{}
  const morningOutfitOffer=createMorningOutfitOffer({storage:offerStorage});
  function claimDailyWelcome(s){
   const accountId=s.scope.accountId,now=new Date(),timezone=ui.context().timezone;
   const format=zone=>new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
   let parts;try{parts=format(timezone||undefined);}catch{parts=format(undefined);}
   const part=type=>parts.find(value=>value.type===type)?.value,day=part('year')+'-'+part('month')+'-'+part('day'),key='james:daily-welcome:v1:'+encodeURIComponent(accountId);
   let seen=welcomeMemory.get(accountId)===day;
   try{seen=seen||root.localStorage.getItem(key)===day;}catch{}
   if(!seen)try{
    const prior=JSON.parse(root.localStorage.getItem('james:daily-welcome:v1')||'null');
    seen=prior?.accountId===accountId&&prior.day===day;
   }catch{}
   welcomeMemory.set(accountId,day);try{root.localStorage.setItem(key,day);}catch{}
   if(seen)return null;
   const hour=Number(part('hour'));
   return {morning:hour>=5&&hour<12};
  }
  function setOrbAction(value){
   const quiet=(session?.inputMode||mode.value)==='quiet';
   const label=session?(quiet?'Show James voice':'Close James voice'):(quiet?'Connect James voice for hold to talk':'Talk to James');
   orb.title=({idle:label,connecting:'Connecting to James',listening:'James is listening',thinking:'James is thinking',speaking:'James is speaking',muted:'James is connected with the microphone off'})[value]||label;
   orb.setAttribute('aria-label',label);
   orb.setAttribute('aria-pressed',String(!!session));
   if(button)button.textContent=session?(quiet?'Show voice':'Close voice'):'Talk to James';
  }
  function state(value,message){
   if(value==='listening'&&session?.stream?.getAudioTracks().every(track=>!track.enabled)){
    value='muted';message=session.inputMode==='quiet'?'Ready. Microphone off until you hold the button.':'Microphone muted';
   }
   setState(value);
   if(session){session.phase=value;connectionReport.textContent=JSON.stringify(diagnostic(session),null,2);}
   if(message)status.textContent=message;
   panel.dataset.voiceState=value;orb.dataset.voiceState=value;
   orb.dataset.microphone=session?.stream?(session.stream.getAudioTracks().some(track=>track.enabled)?'live':'muted'):'off';
   setOrbAction(value);
   root.dispatchEvent?.(new CustomEvent('james:voice-state',{detail:{phase:value,active:!!session,message:message&&message!==defaultCloseMessage?message:''}}));
  }
  const current=s=>session===s&&!s.closed;
  function send(s,event){if(current(s)&&s.channel?.readyState==='open')s.channel.send(JSON.stringify(event));}
  function stopReply(){const s=session;if(!s)return;s.speech?.cancel();s.replyCancelled=true;s.playing=false;s.audio.muted=true;s.coordinator?.interrupt();ui.interruptVoiceReply();state('listening','Listening');}
  const defaultCloseMessage='Voice is off. Tap James to talk again. Your conversation is retained.';
  // Keep only transport metadata after cleanup so a failed device test remains diagnosable.
  // Never retain audio, transcripts, account IDs or device labels here.
  function diagnostic(s){return {build:'voice-check-7',active:!!s,phase:s?.phase||'idle',speechDetected:s?.heardSpeech===true,providerEvents:{...(s?.providerEvents||{})},inputTranscription:s?.inputTranscription||null,audioPackets:s?.audioPackets??null,inputProgress:s?.inputProgress||null,providerVad:s?.providerVad||null,lastResearchDurationMs:s?.lastResearchDurationMs??null,connectionState:s?.pc?.connectionState||null,channelState:s?.channel?.readyState||null,microphone:s?.stream?.getAudioTracks().map(track=>({state:track.readyState||'unknown',enabled:track.enabled,muted:track.muted===true}))||[]};}
  function close(message=defaultCloseMessage){
   const s=session;if(s)lastDiagnostic={...diagnostic(s),active:false,closedAt:new Date().toISOString(),reason:message};session=null;hold=null;talk.hidden=true;mute.hidden=false;refreshTalk(null);++serial;
   if(s){s.closed=true;s.manual?.close();s.speech?.cancel();s.coordinator?.detach();s.controller.abort();clearTimeout(s.timer);clearTimeout(s.startup);clearTimeout(s.vadConfirmation);clearTimeout(s.maximum);clearTimeout(s.linkTimer);clearInterval(s.check);clearInterval(s.inputCheck);s.stream?.getTracks().forEach(track=>track.stop());s.channel?.close();s.pc?.close();s.audio.pause();s.audio.srcObject=null;s.releaseAudioSession?.();ui.detachVoice?.(s.adapter);}
   connectionDetails.hidden=false;connectionDetails.open=false;if(lastDiagnostic)connectionReport.textContent=JSON.stringify(lastDiagnostic,null,2);
   state('idle',message);launchTalk.textContent='Reconnect to James';launchTalk.hidden=message===defaultCloseMessage;if(doc.body.dataset.wallAmbient==='true')panel.hidden=true;mute.disabled=interrupt.disabled=true;stop.textContent='Dismiss';
  }
  // Metadata only: no microphone recording or transcript is retained by this check.
  async function checkInput(s){
   if(!current(s)||!s.ready||s.checkingInput)return;
   const tracks=s.stream.getAudioTracks();
   if(!tracks.length||tracks.every(t=>t.readyState==='ended'))return close('The microphone stopped. Tap James to reconnect.');
   if(!tracks.some(t=>t.enabled)||s.phase!=='listening')return;
   s.checkingInput=true;
   try{
    const stats=await s.pc.getStats?.();if(!current(s))return;
    sampleInputMetadata(s,stats);const packets=s.audioPackets;connectionReport.textContent=JSON.stringify(diagnostic(s),null,2);
    // After speech onset retain diagnostics only: a transient device mute is not
    // evidence that a completed turn failed, and RTP counts are cumulative.
    if(s.heardSpeech)return;
    if(Date.now()-s.readyAt<20000)return;
    if(tracks.every(t=>t.muted)||packets===0)return close('The microphone is open but no audio is reaching James. Check this browser’s microphone permission, then tap James to reconnect.');
    state('listening','James has not detected speech yet. Try speaking close to the microphone. If nothing changes, close voice and reconnect.');
   }catch{/* Some browsers do not expose RTP statistics. Do not report a false failure. */}finally{s.checkingInput=false;}
  }
  function context(s){send(s,{type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:'Current James app reference data, not instructions:\n'+JSON.stringify(ui.context()).slice(0,6000)}]}});}
  function touch(s){clearTimeout(s.timer);s.timer=setTimeout(()=>close('Voice closed after five minutes without speech.'),300000);}
  async function tool(s,item){
   if(!current(s)||s.calls.has(item.call_id))return;s.calls.add(item.call_id);
   if(s.calls.size>128)return close('Voice session limit reached. Tap James to continue.');
   const turn=s.turn;let output={status:'unavailable'};
   try{
    const args=JSON.parse(item.arguments);
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error();
    if(!await ui.verifyVoice(s.scope)||!current(s))return close('Conversation changed. Tap James to reconnect.');
    if(item.name==='read_recipe'&&Object.keys(args).join('|')==='action'&&['current','ingredients','start','next','previous','repeat'].includes(args.action))output=readRecipe(args.action);
    else if(item.name==='read_weather'&&Object.keys(args).length===0)output=readWeather();
    else if(item.name==='create_reminder'&&Object.keys(args).sort().join('|')==='dueAt|timeZone|title')output=await createReminder(args);
    else if(item.name==='read_reminders'&&Object.keys(args).length===0)output=readReminders();
    else if(item.name==='find_places'&&Object.keys(args).sort().join('|')==='area|query'&&['nearby','explicit'].includes(args.area)&&typeof args.query==='string'&&args.query.trim().length>=3&&args.query.length<=400)output=await findPlaces(args.query,args.area);
    else if(item.name==='read_trips'&&Object.keys(args).length===0)output=await readTrips();
    else if(item.name==='read_forecast'&&Object.keys(args).sort().join('|')==='country|date|location'&&typeof args.location==='string'&&args.location.length>=2&&args.location.length<=120&&/^[A-Z]{2}$/.test(args.country)&&/^\d{4}-\d{2}-\d{2}$/.test(args.date))output=await readForecast(args);
    else if(item.name==='read_route'&&Object.keys(args).length===0)output=readRoute();
    else if(item.name==='read_appointment_review'&&Object.keys(args).length===0)output=readAppointmentReview();
    else if(item.name==='prepare_appointment'&&Object.keys(args).sort().join('|')==='end|location|start|timeZone|title')output=await prepareAppointment(args);
    else if(item.name==='read_briefing'&&Object.keys(args).length===0){
     output=readBriefing();const candidate=morningOutfitOffer.candidate(s.scope,ui.context(),output);
     s.pendingMorningOutfit=candidate?{candidate,turn}:null;
     output={...output,wardrobe:{morningOffer:candidate?'available':'not_due',navigation:'wardrobe',closetAccess:'separate_wardrobe_app',outfitPrepared:false}};
    }
    else if(item.name==='read_calendar'&&Object.keys(args).join('|')==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(args.date))output=await readCalendar(args.date);
    else if(item.name==='open_page'&&Object.keys(args).join('|')==='page'&&typeof args.page==='string')output=await ui.navigate(args.page);
    else if(item.name==='ask_james'&&Object.keys(args).join('|')==='question'&&typeof args.question==='string'&&args.question.trim()&&args.question.length<=4000){
     state('thinking','Checking that for you…');const researchStarted=Date.now();const result=await ui.ask({text:args.question,origin:'voice',recordHistory:false});
     s.lastResearchDurationMs=Math.max(0,Date.now()-researchStarted);
     output=result?.restricted?{status:'review_required',message:'The business-scoped result is displayed in James. Review it there; it is not copied into the voice session.'}:result||{status:'failed'};
    }
   }catch{output={status:'failed',message:'That request could not be completed.'};}
   if(!current(s)||turn!==s.turn)return;
   if(s.coordinator.toolOutput({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(output)}})){context(s);s.coordinator.continueResponse();}
  }
  function remember(s){if(current(s)&&s.playbackFinished&&!s.replyCancelled&&s.userText&&s.replyText){const user=s.userText,reply=s.replyText;s.userText='';s.replyText='';void ui.rememberVoice(s.scope,user,reply);}}
  async function event(s,e){
   if(!current(s))return;
   // Only fixed event counters, never provider payloads, audio or transcripts.
   if(['session.created','input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','input_audio_buffer.committed','response.created','response.done','conversation.item.input_audio_transcription.failed','conversation.item.input_audio_transcription.completed','error'].includes(e.type)){s.providerEvents||={};s.providerEvents[e.type]=(s.providerEvents[e.type]||0)+1;connectionReport.textContent=JSON.stringify(diagnostic(s),null,2);}
   if(e.type==='session.created'||e.type==='session.updated'){const vad=e.session?.audio?.input?.turn_detection;s.providerVad=['server_vad','semantic_vad'].includes(vad?.type)?vad.type:vad===null?'disabled':'unknown';connectionReport.textContent=JSON.stringify(diagnostic(s),null,2);}
   if(s.inputMode==='quiet'){
    if(e.type==='session.created'||e.type==='session.updated'){
     const vad=e.session?.audio?.input?.turn_detection;
     const failure='Hold to talk could not confirm a muted start. The microphone is off. Tap James to retry.';
     if(vad!==null){
      if(s.ready){if(vad!==undefined)close(failure);return;}
      if(!s.vadRequested){
       s.vadRequested=true;
       try{send(s,{type:'session.update',session:{type:'realtime',audio:{input:{turn_detection:null}}}});}
       catch{close(failure);return;}
       s.vadConfirmation=setTimeout(()=>{if(current(s)&&!s.ready)close(failure);},8000);
      }else if(e.type==='session.updated'&&vad!==undefined)close(failure);
      return;
     }
     clearTimeout(s.vadConfirmation);
     if(!s.ready&&!s.manual.ready({vadDisabled:true,channelOrdered:s.channel.ordered===true,channelReliable:s.channel.maxRetransmits===null&&s.channel.maxPacketLifeTime===null&&s.channel.readyState==='open'}))return;
    }
    if(['input_audio_buffer.cleared','input_audio_buffer.committed','input_audio_buffer.speech_started','input_audio_buffer.speech_stopped'].includes(e.type)){
     const accepted=s.manual.receive(e);
     if(!current(s))return;
     refreshTalk(s);
     if(e.type!=='input_audio_buffer.committed')return;
     if(!accepted||s.manualCommitted!==e.item_id)return;
     s.manualCommitted=null;
     context(s);state('thinking','James is thinking…');
    }
   }
   if(e.type==='session.created'||(s.inputMode==='quiet'&&e.type==='session.updated')){
    if(s.ready)return;s.ready=true;s.readyAt=Date.now();s.inputCheck=setInterval(()=>void checkInput(s),5000);
    clearTimeout(s.startup);s.maximum=setTimeout(()=>close('Five-minute voice session ended. Tap James to continue.'),300000);
    context(s);for(const item of s.history)send(s,{type:'conversation.item.create',item:{type:'message',role:item.role==='User'?'user':'assistant',content:[{type:item.role==='User'?'input_text':'output_text',text:item.text}]}});
    if(s.inputMode==='quiet')refreshTalk(s);
    state('listening','Listening — speak naturally. You can interrupt James.');
    const initialPrompt=s.initialPrompt;s.initialPrompt=null;
    // An explicit first request also counts as starting the day; reconnect stays quiet.
    const firstConnectionToday=ui.context().page==='briefing'&&(initialPrompt||s.welcomeEligible)&&claimDailyWelcome(s);
    if(initialPrompt)void s.coordinator.submitTyped(initialPrompt);
    else if(firstConnectionToday){
     const invitation=firstConnectionToday.morning
      ? 'Give Michael one brief, natural morning hello. In your own words, ask if he is ready for his Daily Briefing. This is an invitation only: wait for his reply without calling any tools or reading personal information. Only after he clearly says yes to the Daily Briefing may you call read_briefing and summarize the actual information returned, noting unavailable sources. If he declines or changes the subject, follow his lead without reading the briefing.'
      : 'Give Michael one brief, natural hello that fits his local time, then invite him to tell you what he needs. Use your own words. This is an invitation only: do not suggest a feature, offer a briefing, use tools, or read any personal information unless he asks.';
     void s.coordinator.submitTyped(invitation);
    }
   }
   if(e.type==='error')s.failureMessage=failureMessage(e.error?.code)||'Voice session failed. Your conversation is retained; tap James to retry.';
   if(!s.coordinator.receive(e))return;
   if(e.type==='input_audio_buffer.committed'){s.inputItemId=e.item_id;s.inputTranscription={state:'pending'};}
   if(e.type==='input_audio_buffer.speech_started'){
    s.inputItemId=null;s.inputTranscription=null;s.heardSpeech=true;++s.turn;s.speech?.cancel();s.playing=false;s.replyCancelled=true;s.audio.muted=true;s.userText='';s.replyText='';s.playbackFinished=false;ui.interruptVoiceReply();touch(s);state('listening','Listening…');
   }
   if(e.type==='input_audio_buffer.speech_stopped'){context(s);state('thinking','James is thinking…');}
   if(noteInputTranscriptionFailure(s,e)){state(s.phase||'thinking','Input transcript unavailable. James can still process the audio.');return;}
   if(e.type==='conversation.item.input_audio_transcription.completed'&&typeof s.inputItemId==='string'&&e.item_id===s.inputItemId){s.inputTranscription={state:'ready'};s.userText=e.transcript||'';transcript.textContent=s.userText;root.dispatchEvent?.(new CustomEvent('james:voice-transcript',{detail:{question:s.userText,answer:s.replyText}}));touch(s);remember(s);}
   // A tool continuation can reuse an already-playing WebRTC audio buffer.
   // Do not mute it while waiting for another started event that may never fire.
   if(e.type==='response.created'){s.responding=true;s.replyCancelled=false;s.audio.muted=!!s.speech;if(s.speech)s.playbackFinished=false;}
   if(e.type==='output_audio_buffer.started'){if(!s.replyCancelled){s.playing=true;s.audio.muted=false;state('speaking','James is speaking — you can interrupt.');}}
   if(e.type==='response.output_audio_transcript.delta'||(s.speech&&e.type==='response.output_text.delta')){s.replyText+=(e.delta||'');transcript.textContent=s.replyText;root.dispatchEvent?.(new CustomEvent('james:voice-transcript',{detail:{question:s.userText,answer:s.replyText}}));}
   if(e.type==='response.done'){
    s.responding=false;
    if(e.response?.status==='completed'){
     const output=e.response.output||[];
     for(const item of output)if(item.type==='function_call')void tool(s,item);
     if(s.speech&&!output.some(item=>item.type==='function_call')){
      const text=output.filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(part=>part.type==='output_text').map(part=>part.text).join('\n');
      if(text.trim()){s.replyText=text;state('thinking','Preparing Archer’s reply…');void s.speech.play(text);}
     }
    }
   }
   if(e.type==='output_audio_buffer.stopped'){
    s.playing=false;s.playbackFinished=true;
    if(!s.replyCancelled&&s.pendingMorningOutfit?.turn===s.turn&&/\b(outfit|wardrobe|what to wear|get dressed)\b/i.test(s.replyText)){morningOutfitOffer.markDelivered(s.pendingMorningOutfit.candidate);s.pendingMorningOutfit=null;}
    remember(s);
    state('listening','Listening');
   }
   if(e.type==='error'&&!['response_cancel_not_active','input_audio_buffer_commit_empty'].includes(e.error?.code))close('Voice session failed. Your conversation is retained; tap James to retry.');
  }
  async function start(options){
   const prompt=typeof options?.prompt==='string'?options.prompt.slice(0,1000):null;
   if(session){
    if(!prompt){
     if(session.inputMode==='quiet'&&options?.type==='click'){panel.hidden=false;if(session.ready)talk.focus({preventScroll:true});return;}
     close();return;
    }
    if(!session.ready){session.initialPrompt=prompt;return;}
    cancelHold();if(session.manual?.state()==='committing')return;stopReply();void session.coordinator.submitTyped(prompt);return;
   }
   launchTalk.hidden=true;connectionDetails.hidden=false;connectionDetails.open=false;connectionReport.textContent='Waiting for microphone and connection…';panel.hidden=false;mute.disabled=interrupt.disabled=false;mute.textContent='Mute microphone';mute.setAttribute('aria-pressed','false');stop.textContent='Close voice';transcript.textContent='';
   if(!media?.getUserMedia||!Peer){close('Live voice is unavailable in this browser. You can still type to James.');return;}
   const welcomeEligible=!lastDiagnostic||lastDiagnostic.reason===defaultCloseMessage;
   const s={voice:voice.value,inputMode:mode.value==='quiet'?'quiet':'standard',initialPrompt:prompt,welcomeEligible,id:++serial,controller:new AbortController(),audio:doc.createElement('audio'),turn:0,calls:new Set(),closed:false,responding:false,userText:'',replyText:''};session=s;
   s.audio.autoplay=true;s.audio.muted=true;s.audio.setAttribute('playsinline','');
   s.adapter={subscribeTurn:()=>()=>{},end:()=>{if(current(s))close();},interruptReply:()=>{if(current(s))s.coordinator?.interrupt();}};
   if(s.inputMode==='quiet'){talk.hidden=false;mute.hidden=true;refreshTalk(s);}
   state('connecting',s.inputMode==='quiet'?'Connecting to James. Allow microphone access if asked.':'Connecting to James…');
   s.startup=setTimeout(()=>{if(current(s))close('Voice connection timed out. Check microphone permission, then tap James to retry.');},35000);
   try{
    // Microphone access follows an explicit tap or an opted-in local wake phrase.
    if(s.voice==='archer'){const response=await fetcher('/api/james/speech',{credentials:'same-origin',cache:'no-store',signal:s.controller.signal});const config=await response.json();if(!response.ok||!config.ready)throw Error(config.reason==='activation_required'?'ARCHER_ACTIVATION_REQUIRED':'ARCHER_CONNECTION_REQUIRED');}
    if(root.jamesWallDisplay&&!await root.jamesWallDisplay.pauseWake())throw Error("LOCAL_MICROPHONE_BUSY");
    if(!current(s))return;
    s.releaseAudioSession=acquireDuplexAudioSession(root.navigator);
    const stream=await media.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(!current(s)){stream.getTracks().forEach(track=>track.stop());return;}s.stream=stream;
    if(s.inputMode==='quiet'){
     for(const track of stream.getAudioTracks())track.enabled=false;
     state('connecting','Connecting · microphone muted');
    }
    const prepared=await ui.prepareVoice(s.adapter);if(!current(s))return;s.scope=prepared.scope;s.history=prepared.history;
    const {createRealtimeTurnCoordinator}=await import('./realtime-coordinator.mjs');
    if(!current(s))return;
    s.coordinator=await createRealtimeTurnCoordinator({identityOwner:prepared.identityOwner,scope:s.scope,send:event=>{if(s.channel?.readyState!=='open')throw Error('Voice channel unavailable');send(s,event);},onFailure:failure=>{if(current(s))close(failureMessage(failure.code)||'Voice could not complete your request. Tap James to reconnect.');},isActive:()=>current(s),wantsAudio:()=>s.voice!=='archer',endTransport:()=>close(s.failureMessage),navigate:(door,options)=>options.isCurrent()?ui.navigate(door).then(result=>result.status==='ready'):false,newId:()=>root.crypto.randomUUID()});
    if(!current(s)){s.coordinator.detach();return;}
    if(s.inputMode==='quiet'){
     const {createManualTurnGate}=await import('./manual-turn-gate.mjs');if(!current(s))return;
     s.manual=createManualTurnGate({
      setMic(enabled){
       const tracks=s.stream.getAudioTracks();for(const track of tracks)track.enabled=false;
       if(enabled){
        if(!current(s)||doc.hidden||!s.ready||!tracks.some(track=>track.readyState!=='ended'))throw Error('Unavailable microphone');
        stopReply();if(!current(s))throw Error('Unavailable voice');
        s.inputItemId=null;s.inputTranscription=null;s.heardSpeech=true;++s.turn;s.userText='';s.replyText='';s.playbackFinished=false;
        for(const track of tracks)track.enabled=true;
        touch(s);state('listening','Speak now. Release or tap again to send.');
       }else if(current(s)&&s.ready)state('listening');
      },
      send(frame){if(!current(s)||s.channel?.readyState!=='open')return false;send(s,frame);refreshTalk(s);return true;},
      onCommitted(itemId){s.manualCommitted=itemId;},
      onFailure(){if(current(s))close('Hold to talk stopped. The microphone is off. Tap James to reconnect.');}
     });
     if(!current(s))return;
    }
    if(s.voice==='archer')s.speech=createArcherPlayback({audio:s.audio,fetcher,scope:s.scope,isCurrent:()=>current(s)&&!s.replyCancelled,onSpeaking:()=>{s.playing=true;state('speaking','Archer is speaking — you can interrupt.');},onEnded:()=>{s.playing=false;s.playbackFinished=true;if(s.pendingMorningOutfit?.turn===s.turn&&/\b(outfit|wardrobe|what to wear|get dressed)\b/i.test(s.replyText)){morningOutfitOffer.markDelivered(s.pendingMorningOutfit.candidate);s.pendingMorningOutfit=null;}remember(s);state('listening','Listening');},onError:code=>{s.playing=false;state('listening',code==='ARCHER_PLAYBACK_BLOCKED'?'Audio playback was blocked. Close voice and tap James to reconnect.':'Archer could not play that reply. The text is still shown; check the voice connection in Settings.');}});
    s.pc=new Peer();s.pc.ontrack=e=>{if(current(s)&&!s.speech){s.audio.srcObject=e.streams[0];s.audio.play().catch(()=>close('Audio playback was blocked. Tap James to try again.'));}};
    stream.getTracks().forEach(track=>{s.pc.addTrack(track,stream);track.addEventListener?.('ended',()=>{if(current(s))close('The microphone stopped. Tap James to reconnect.');});});
    s.channel=s.pc.createDataChannel('oai-events');s.channel.onmessage=e=>{try{void event(s,JSON.parse(e.data)).catch(()=>{if(current(s))close('Voice received an invalid response. Tap James to retry.');});}catch{if(current(s))close('Voice received an invalid response. Tap James to retry.');}};
    s.channel.onclose=()=>{if(current(s))close('Voice disconnected. Tap James to reconnect.');};
    s.pc.onconnectionstatechange=()=>{
     if(!current(s))return;
     if(['failed','closed'].includes(s.pc.connectionState))return close('Voice disconnected. Tap James to reconnect.');
     if(s.pc.connectionState==='disconnected'){
      if(s.inputMode==='quiet')return close('Hold to talk disconnected. The microphone is off. Tap James to reconnect.');
      if(s.linkTimer)return;
      state('connecting','Voice connection interrupted. Waiting briefly for it to recover…');
      s.linkTimer=setTimeout(()=>{s.linkTimer=null;if(current(s)&&s.pc.connectionState==='disconnected')close('Voice disconnected. Tap James to reconnect.');},8000);
     }else if(s.pc.connectionState==='connected'&&s.linkTimer){
      clearTimeout(s.linkTimer);s.linkTimer=null;
      if(!s.ready){state('connecting','Connecting to James…');return;}
      state(s.playing?'speaking':s.responding?'thinking':'listening',s.playing?'James is speaking — you can interrupt.':s.responding?'James is thinking…':'Listening');
     }
    };
    const offer=await s.pc.createOffer();if(!current(s))return;await s.pc.setLocalDescription(offer);
    const response=await fetcher('/api/james/voice',{method:'POST',credentials:'same-origin',cache:'no-store',signal:s.controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:offer.sdp,scope:s.scope,voice:s.voice,...(s.inputMode==='quiet'?{inputMode:'quiet'}:{})})});
    if(!current(s))return;
    if(!response.ok){const data=await response.json();throw Error(data.error||'VOICE_SESSION_FAILED');}
    const sdp=await response.text();if(!current(s))return;await s.pc.setRemoteDescription({type:'answer',sdp});
    touch(s);s.check=setInterval(async()=>{try{if(!await ui.verifyVoice(s.scope)&&current(s))close('Conversation changed. Tap James to reconnect.');}catch{if(current(s))close('Sign-in could not be verified. Tap James to retry.');}},30000);
   }catch(error){if(!current(s))return;const message=failureMessage(error.message)||(error.name==='NotAllowedError'?'Allow microphone access to talk to James.':error.name==='NotFoundError'?'No microphone is available in this browser. Connect a microphone or test James on your iPad or phone.':error.name==='NotReadableError'?'The microphone could not start. Close other apps using it, then tap James to retry.':error.message==='VOICE_PROVIDER_ACCESS'?'The existing OpenAI project denied voice access. Its API permissions or Realtime model access need review.':error.message==='VOICE_KEY_NOT_CONFIGURED'?'This deployment has no configured OpenAI connection.':error.message==='CONVERSATION_CHANGED'?'The conversation changed. Tap James to reconnect.':error.message==='LOCAL_MICROPHONE_BUSY'?'James could not release the other microphone mode. Tap James to retry.':'James voice could not connect. Your conversation is retained; tap James to retry.');close(message);}
  }
  function showExternalLaunch(){
   if(root.location.hash!=='#talk-to-james'||doc.hidden)return;
   root.history.replaceState(root.history.state,'',root.location.pathname+root.location.search);
   if(session)return;
   root.jamesWallDisplay?.wake();
   panel.hidden=false;launchTalk.hidden=false;mute.disabled=interrupt.disabled=true;stop.textContent='Dismiss';
   launchTalk.textContent='Start conversation';status.textContent='Start conversation to turn on your microphone.';
   launchTalk.focus({preventScroll:true});
  }
  launchTalk.onclick=start;
  root.addEventListener('hashchange',showExternalLaunch);
  doc.addEventListener('visibilitychange',showExternalLaunch);
  orb.onclick=start;if(button)button.onclick=start;
  mute.onclick=()=>{const s=session;if(!s||s.inputMode==='quiet'||!s.stream)return;const muted=s.stream.getAudioTracks().some(t=>t.enabled);s.stream.getAudioTracks().forEach(t=>{t.enabled=!muted;});mute.textContent=muted?'Unmute microphone':'Mute microphone';mute.setAttribute('aria-pressed',String(muted));const phase=s.phase==='muted'?'listening':s.phase||'listening';state(phase,muted?'Microphone muted':phase==='speaking'?'James is speaking — you can interrupt.':phase==='thinking'?'James is thinking…':'Listening');};
  interrupt.onclick=()=>{cancelHold();stopReply();};stop.onclick=()=>{if(session)close();else panel.hidden=true;};
  root.addEventListener('james:page-changed',()=>{if(session)context(session);});
  root.addEventListener('james:typed-turn',e=>{const s=session;if(!s)return;cancelHold();stopReply();send(s,{type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:'Shared-conversation update; context only, do not reply:\n'+JSON.stringify(e.detail).slice(0,6000)}]}});});
  root.addEventListener('james-conversation-ended',()=>close('Conversation ended.'));
  root.addEventListener('pagehide',()=>close());
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden&&session)close('Voice paused while James was in the background. Tap James to reconnect.');});
  state('idle');return {start,close,stopReply,showExternalLaunch,active:()=>!!session,diagnostics:()=>session?diagnostic(session):lastDiagnostic?{...lastDiagnostic,microphone:lastDiagnostic.microphone.map(track=>({...track}))}:diagnostic(null)};
 }
 root.JamesVoiceSession={acquireDuplexAudioSession,noteInputTranscriptionFailure,sampleInputMetadata,mount,createMorningOutfitOffer,createArcherPlayback};
})(typeof window==='undefined'?globalThis:window);

