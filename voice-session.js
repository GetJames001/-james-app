(function(root){
 'use strict';
 function mount({ui,orb,button,setState,readBriefing=()=>({status:"unavailable"}),readCalendar=async()=>({status:"unavailable"}),fetcher=fetch,media=root.navigator.mediaDevices,Peer=root.RTCPeerConnection}){
  const doc=orb.ownerDocument,panel=doc.createElement('aside'),status=doc.createElement('p'),transcript=doc.createElement('p'),mute=doc.createElement('button'),stop=doc.createElement('button'),interrupt=doc.createElement('button');
  panel.className='james-voice-panel';panel.hidden=true;panel.setAttribute('aria-label','James conversation');
  status.setAttribute('role','status');transcript.className='james-voice-transcript';
  mute.type=stop.type=interrupt.type='button';mute.textContent='Mute microphone';stop.textContent='Close voice';interrupt.textContent='Stop reply';
  const voiceLabel=doc.createElement('label'),voice=doc.createElement('select'),samples=doc.createElement('a');voiceLabel.textContent='James’s voice ';voice.setAttribute('aria-label','James voice');for(const name of ['marin','coral','shimmer','sage','alloy','ash','ballad','echo','verse','cedar']){const option=doc.createElement('option');option.value=name;option.textContent=name[0].toUpperCase()+name.slice(1);voice.append(option);}try{if([...voice.options].some(o=>o.value===root.localStorage.getItem('james:voice')))voice.value=root.localStorage.getItem('james:voice');}catch{}voice.onchange=()=>{if(session)close('Voice changed. Tap James to reconnect using '+voice.value+'.');try{root.localStorage.setItem('james:voice',voice.value);}catch{}};voiceLabel.append(voice);samples.textContent='Listen to voice samples';samples.href='https://www.openai.fm/';samples.target='_blank';samples.rel='noopener noreferrer';const note=doc.createElement('p');note.className='muted';note.textContent='AI-generated voice · OpenAI API usage applies separately from Vercel. Voice sessions stop after five minutes.';panel.append(status,transcript,note,voiceLabel,samples,mute,interrupt,stop);doc.body.append(panel);
  let session=null,serial=0;
  function state(value,message){if(value==='listening'&&session?.stream?.getAudioTracks().every(track=>!track.enabled)){value='muted';message='Microphone muted';}setState(value);if(message)status.textContent=message;orb.dataset.voiceState=value;orb.setAttribute('aria-pressed',String(!!session));orb.setAttribute('aria-label',session?'Close James voice':'Talk to James');if(button)button.textContent=session?'Close voice':'Talk to James';}
  const current=s=>session===s&&!s.closed;
  function send(s,event){if(current(s)&&s.channel?.readyState==='open')s.channel.send(JSON.stringify(event));}
  function stopReply(){const s=session;if(!s)return;s.replyCancelled=true;s.audio.muted=true;s.coordinator?.interrupt();ui.interruptVoiceReply();state('listening','Listening');}
  function close(message='Voice closed. Your conversation is retained.'){
   const s=session;session=null;++serial;
   if(s){s.closed=true;s.coordinator?.detach();s.controller.abort();clearTimeout(s.timer);clearTimeout(s.startup);clearTimeout(s.maximum);clearInterval(s.check);s.stream?.getTracks().forEach(track=>track.stop());s.channel?.close();s.pc?.close();s.audio.pause();s.audio.srcObject=null;ui.detachVoice?.(s.adapter);}
   state('idle',message);mute.disabled=interrupt.disabled=true;stop.textContent='Dismiss';
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
    if(item.name==='read_briefing'&&Object.keys(args).length===0)output=readBriefing();
    else if(item.name==='read_calendar'&&Object.keys(args).join('|')==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(args.date))output=await readCalendar(args.date);
    else if(item.name==='open_page'&&Object.keys(args).join('|')==='page'&&typeof args.page==='string')output=await ui.navigate(args.page);
    else if(item.name==='ask_james'&&Object.keys(args).join('|')==='question'&&typeof args.question==='string'&&args.question.trim()&&args.question.length<=4000){
     state('thinking','James is thinking…');const result=await ui.ask({text:args.question,origin:'voice',recordHistory:false});
     output=result?.restricted?{status:'review_required',message:'The business-scoped result is displayed in James. Review it there; it is not copied into the voice session.'}:result||{status:'failed'};
    }
   }catch{output={status:'failed',message:'That request could not be completed.'};}
   if(!current(s)||turn!==s.turn)return;
   if(s.coordinator.toolOutput({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(output)}})){context(s);s.coordinator.continueResponse();}
  }
  function remember(s){if(current(s)&&s.playbackFinished&&!s.replyCancelled&&s.userText&&s.replyText){const user=s.userText,reply=s.replyText;s.userText='';s.replyText='';void ui.rememberVoice(s.scope,user,reply);}}
  async function event(s,e){
   if(!current(s))return;
   if(e.type==='session.created'){
    if(s.ready)return;s.ready=true;
    clearTimeout(s.startup);s.maximum=setTimeout(()=>close('Five-minute voice session ended. Tap James to continue.'),300000);
    context(s);for(const item of s.history)send(s,{type:'conversation.item.create',item:{type:'message',role:item.role==='User'?'user':'assistant',content:[{type:item.role==='User'?'input_text':'output_text',text:item.text}]}});
    state('listening','Listening — speak naturally. You can interrupt James.');
    if(ui.context().page==='briefing'&&!s.history.length)void s.coordinator.submitTyped('Begin the Daily Briefing. Use read_briefing to ground the greeting and short review in available data, then ask the departure point if travel matters.');
   }
   if(!s.coordinator.receive(e))return;
   if(e.type==='input_audio_buffer.committed')s.inputItemId=e.item_id;
   if(e.type==='input_audio_buffer.speech_started'){
    ++s.turn;s.replyCancelled=true;s.audio.muted=true;s.userText='';s.replyText='';s.playbackFinished=false;ui.interruptVoiceReply();touch(s);state('listening','Listening…');
   }
   if(e.type==='input_audio_buffer.speech_stopped'){context(s);state('thinking','James is thinking…');}
   if(e.type==='conversation.item.input_audio_transcription.completed'&&e.item_id===s.inputItemId){s.userText=e.transcript||'';transcript.textContent=s.userText;touch(s);remember(s);}
   if(e.type==='response.created'){s.responding=true;s.replyCancelled=false;s.audio.muted=true;}
   if(e.type==='output_audio_buffer.started'){if(!s.replyCancelled){s.audio.muted=false;state('speaking','James is speaking — you can interrupt.');}}
   if(e.type==='response.output_audio_transcript.delta'){s.replyText+=(e.delta||'');transcript.textContent=s.replyText;}
   if(e.type==='response.done'){
    s.responding=false;
    if(e.response?.status==='completed')for(const item of e.response.output||[])if(item.type==='function_call')void tool(s,item);
   }
   if(e.type==='output_audio_buffer.stopped'){
    s.playbackFinished=true;remember(s);
    state('listening','Listening');
   }
   if(e.type==='error'&&!['response_cancel_not_active','input_audio_buffer_commit_empty'].includes(e.error?.code))close('Voice session failed. Your conversation is retained; tap James to retry.');
  }
  async function start(){
   if(session){close();return;}
   panel.hidden=false;mute.disabled=interrupt.disabled=false;mute.textContent='Mute microphone';mute.setAttribute('aria-pressed','false');stop.textContent='Close voice';transcript.textContent='';
   if(!media?.getUserMedia||!Peer){state('idle','Live voice is unavailable in this browser. You can still type to James.');return;}
   const s={id:++serial,controller:new AbortController(),audio:doc.createElement('audio'),turn:0,calls:new Set(),closed:false,responding:false,userText:'',replyText:''};session=s;
   s.audio.autoplay=true;s.audio.muted=true;s.audio.setAttribute('playsinline','');
   s.adapter={subscribeTurn:()=>()=>{},end:()=>{if(current(s))close();},interruptReply:()=>{if(current(s))s.coordinator?.interrupt();}};
   state('connecting','Connecting to James…');
   try{
    // Microphone access starts only inside this user-triggered action.
    const stream=await media.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(!current(s)){stream.getTracks().forEach(track=>track.stop());return;}s.stream=stream;
    const prepared=await ui.prepareVoice(s.adapter);if(!current(s))return;s.scope=prepared.scope;s.history=prepared.history;
    s.startup=setTimeout(()=>{if(current(s))close('Voice connection timed out. Tap James to retry.');},35000);
    const {createRealtimeTurnCoordinator}=await import('./realtime-coordinator.mjs');
    if(!current(s))return;
    s.coordinator=await createRealtimeTurnCoordinator({identityOwner:prepared.identityOwner,scope:s.scope,send:event=>send(s,event),isActive:()=>current(s),endTransport:()=>close(),navigate:(door,options)=>options.isCurrent()?ui.navigate(door).then(result=>result.status==='ready'):false,newId:()=>root.crypto.randomUUID()});
    if(!current(s)){s.coordinator.detach();return;}
    s.pc=new Peer();s.pc.ontrack=e=>{if(current(s)){s.audio.srcObject=e.streams[0];s.audio.play().catch(()=>close('Audio playback was blocked. Tap James to try again.'));}};
    stream.getTracks().forEach(track=>s.pc.addTrack(track,stream));
    s.channel=s.pc.createDataChannel('oai-events');s.channel.onmessage=e=>{try{void event(s,JSON.parse(e.data));}catch{close('Voice received an invalid response. Tap James to retry.');}};
    s.channel.onclose=()=>{if(current(s))close('Voice disconnected. Tap James to reconnect.');};
    s.pc.onconnectionstatechange=()=>{if(current(s)&&['failed','closed','disconnected'].includes(s.pc.connectionState))close('Voice disconnected. Tap James to reconnect.');};
    const offer=await s.pc.createOffer();if(!current(s))return;await s.pc.setLocalDescription(offer);
    const response=await fetcher('/api/james/voice',{method:'POST',credentials:'same-origin',cache:'no-store',signal:s.controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:offer.sdp,scope:s.scope,voice:voice.value})});
    if(!current(s))return;
    if(!response.ok){const data=await response.json();throw Error(data.error||'VOICE_SESSION_FAILED');}
    const sdp=await response.text();if(!current(s))return;await s.pc.setRemoteDescription({type:'answer',sdp});
    touch(s);s.check=setInterval(async()=>{try{if(!await ui.verifyVoice(s.scope)&&current(s))close('Conversation changed. Tap James to reconnect.');}catch{if(current(s))close('Sign-in could not be verified. Tap James to retry.');}},30000);
   }catch(error){if(!current(s))return;const message=error.name==='NotAllowedError'?'Allow microphone access to talk to James.':error.message==='VOICE_PROVIDER_ACCESS'?'The existing OpenAI project denied voice access. Its API permissions or Realtime model access need review.':error.message==='VOICE_PROVIDER_LIMIT'?'The existing OpenAI project reached a usage or rate limit.':error.message==='VOICE_KEY_NOT_CONFIGURED'?'This deployment has no configured OpenAI connection.':error.message==='CONVERSATION_CHANGED'?'The conversation changed. Tap James to reconnect.':'James voice could not connect. Your conversation is retained; tap James to retry.';close(message);}
  }
  orb.onclick=start;if(button)button.onclick=start;
  mute.onclick=()=>{const s=session;if(!s)return;const muted=s.stream.getAudioTracks().some(t=>t.enabled);s.stream.getAudioTracks().forEach(t=>{t.enabled=!muted;});mute.textContent=muted?'Unmute microphone':'Mute microphone';mute.setAttribute('aria-pressed',String(muted));status.textContent=muted?'Microphone muted':'Listening';};
  interrupt.onclick=stopReply;stop.onclick=()=>{if(session)close();else panel.hidden=true;};
  root.addEventListener('james:page-changed',()=>{if(session)context(session);});
  root.addEventListener('james:typed-turn',e=>{const s=session;if(!s)return;stopReply();send(s,{type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:'Shared-conversation update; context only, do not reply:\n'+JSON.stringify(e.detail).slice(0,6000)}]}});});
  root.addEventListener('james-conversation-ended',()=>close('Conversation ended.'));
  root.addEventListener('pagehide',()=>close());
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden&&session)close('Voice paused while James was in the background. Tap James to reconnect.');});
  state('idle');return {start,close,stopReply,active:()=>!!session};
 }
 root.JamesVoiceSession={mount};
})(typeof window==='undefined'?globalThis:window);
