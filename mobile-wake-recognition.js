(function(root){
 'use strict';
 const MODEL='/assets/wake/v1/english-0.15.tar.gz',RUNTIME='/assets/wake/v1/vosk-0.0.8.js';
 // Include unknown speech and close alternatives, rather than forcing every sound
 // into the wake phrase. Acoustic reliability still needs physical-device review.
 const GRAMMAR=JSON.stringify(['hey james','hey jane','hey jamie','hey games','james','hey siri','hey google','[unk]']);
 let scriptPromise;
 function loadRuntime(){
  if(root.Vosk)return Promise.resolve(root.Vosk);
  if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{
   const script=root.document.createElement('script');script.src=RUNTIME;script.async=true;
   const timeout=setTimeout(()=>{script.remove();reject(Error('RUNTIME_TIMEOUT'));},30000);
   script.onload=()=>{clearTimeout(timeout);root.Vosk?resolve(root.Vosk):reject(Error('RUNTIME_UNAVAILABLE'));};
   script.onerror=()=>{clearTimeout(timeout);script.remove();reject(Error('RUNTIME_UNAVAILABLE'));};root.document.head.append(script);
  }).catch(error=>{scriptPromise=null;throw error;});
  return scriptPromise;
 }
 class Recognition extends EventTarget{
  static async available(){return root.isSecureContext&&root.WebAssembly&&root.Worker&&root.AudioWorkletNode&&(root.AudioContext||root.webkitAudioContext)&&root.navigator?.mediaDevices?.getUserMedia?'available':'unsupported';}
  constructor(){super();this.processLocally=true;this.cancelled=false;this.ended=false;this.inflight=0;this.queue=[];}
  start(){if(this.started)throw Error('Already started');if(this.processLocally!==true)throw Error('Local processing required');this.started=true;void this.run();}
  async run(){
   try{
    // Resume while this call is close to the explicit user gesture, before model loading.
    this.context=new (root.AudioContext||root.webkitAudioContext)();
    await new Promise((resolve,reject)=>{
     this.rejectResume=reject;this.resumeTimer=setTimeout(()=>reject(Error('AUDIO_SUSPENDED')),10000);
     this.context.resume().then(resolve,reject);
    });clearTimeout(this.resumeTimer);this.rejectResume=null;if(this.cancelled)return;
    if(this.context.state!=='running')throw Error('AUDIO_SUSPENDED');
    this.onstatus?.('Loading the on-device wake model… First use downloads about 45 MB.');
    const Vosk=await loadRuntime();if(this.cancelled)return;
    this.model=new Vosk.Model(new URL(MODEL,root.location.href).href,-2);
    await new Promise((resolve,reject)=>{
     this.rejectLoad=reject;this.loadTimer=setTimeout(()=>reject(Error('MODEL_TIMEOUT')),90000);
     this.model.on('load',event=>event.result?resolve():reject(Error('MODEL_UNAVAILABLE')));
     this.model.on('error',()=>reject(Error('MODEL_UNAVAILABLE')));
    });clearTimeout(this.loadTimer);this.rejectLoad=null;if(this.cancelled)return;
    await this.context.audioWorklet.addModule('/mobile-wake-worklet.js');if(this.cancelled)return;
    this.recognizer=new this.model.KaldiRecognizer(this.context.sampleRate,GRAMMAR);
    this.recognizer.setWords(true);
    this.recognizer.on('error',()=>{if(!this.cancelled)this.fail('audio-capture');});
    this.recognizer.on('partialresult',()=>this.received());
    this.recognizer.on('result',event=>{
     this.received();
     if(this.cancelled||root.document.hidden)return;
     const result=event.result;
     if(result?.text!=='hey james'||!Array.isArray(result.result)||result.result.length!==2||result.result.some(word=>!Number.isFinite(word.conf)||word.conf<0.8))return;
     // No arbitrary transcript leaves this adapter, is logged, or is persisted.
     this.onresult?.({resultIndex:0,results:[Object.assign([{transcript:'hey james'}],{isFinal:true})]});
    });
    this.model.on('error',()=>{if(!this.cancelled)this.fail('audio-capture');});
    // Creating the recognizer is asynchronous inside Vosk's worker. Wait for a
    // real decode acknowledgement before opening the microphone, so startup
    // cannot consume/drop the beginning of the first spoken wake phrase.
    await new Promise((resolve,reject)=>{
     this.resolveReady=resolve;this.rejectReady=reject;this.readyTimer=setTimeout(()=>reject(Error('DECODER_NOT_READY')),10000);
     this.recognizer.acceptWaveformFloat(new Float32Array(4096),this.context.sampleRate);
    });clearTimeout(this.readyTimer);this.rejectReady=null;if(this.cancelled)return;
    this.pendingMic=root.navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
    this.stream=await this.pendingMic;if(this.cancelled){this.stream.getTracks().forEach(track=>track.stop());return;}
    if(root.document.hidden){this.abort();return;}
    this.node=new root.AudioWorkletNode(this.context,'james-local-wake',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
    this.node.port.onmessage=event=>{
     if(this.cancelled||root.document.hidden)return;
     // A brief scheduling delay must not silently remove words. Retain at most
     // half a second locally; sustained overload pauses explicitly instead.
     if(this.queue.length>=Math.ceil(this.context.sampleRate/8192)){this.fail('audio-capture');return;}
     this.queue.push(event.data);this.drain();
    };
    this.node.onprocessorerror=()=>this.fail('audio-capture');
    this.source=this.context.createMediaStreamSource(this.stream);this.source.connect(this.node);this.node.connect(this.context.destination);
    for(const track of this.stream.getTracks())track.onended=()=>{if(!this.cancelled)this.fail('audio-capture');};
    this.context.onstatechange=()=>{if(!this.cancelled&&this.context.state!=='running')this.fail('audio-capture');};
    this.onstart?.();
   }catch(error){if(!this.cancelled)this.fail(error?.name==='NotAllowedError'?'not-allowed':'audio-capture');}
   finally{clearTimeout(this.resumeTimer);clearTimeout(this.loadTimer);clearTimeout(this.readyTimer);}
  }
  received(){
   if(this.cancelled)return;
   if(this.resolveReady){const ready=this.resolveReady;this.resolveReady=null;ready();return;}
   this.inflight=Math.max(0,this.inflight-1);clearTimeout(this.decodeTimer);
   if(this.inflight)this.decodeTimer=setTimeout(()=>this.fail('audio-capture'),3000);
   this.drain();
  }
  drain(){
   while(!this.cancelled&&this.inflight<2&&this.queue.length){
    const chunk=this.queue.shift();if(!this.inflight)this.decodeTimer=setTimeout(()=>this.fail('audio-capture'),3000);this.inflight++;
    try{this.recognizer.acceptWaveformFloat(chunk,this.context.sampleRate);}catch{this.fail('audio-capture');}
   }
  }
  fail(error){this.onerror?.({error});this.abort();}
  abort(){
   if(this.cancelled)return;this.cancelled=true;this.queue.length=0;
   for(const timer of [this.resumeTimer,this.loadTimer,this.readyTimer,this.decodeTimer])clearTimeout(timer);
   this.rejectResume?.(Error('CANCELLED'));this.rejectLoad?.(Error('CANCELLED'));this.rejectReady?.(Error('CANCELLED'));this.resolveReady=null;
   this.node?.port.close();this.node?.disconnect();this.source?.disconnect();
   this.stream?.getTracks().forEach(track=>track.stop());
   // Vosk 0.0.8 terminate() posts a message; terminate the pinned worker directly
   // as well so delayed model loads/decodes cannot survive off or microphone handoff.
   this.model?.worker.terminate();
   const pending=this.pendingMic?this.pendingMic.then(stream=>stream.getTracks().forEach(track=>track.stop()),()=>{}):Promise.resolve();
   const closing=this.context?.close()||Promise.resolve();
   Promise.all([pending,closing]).then(()=>{
    if(this.ended)return;this.ended=true;this.dispatchEvent(new Event('end'));this.onend?.();
   }).catch(()=>{}); // No end acknowledgement means the caller must refuse handoff.
  }
 }
 root.JamesMobileWakeRecognition=Recognition;
 root.JamesMobileWakeGrammar=GRAMMAR;
})(typeof window==='undefined'?globalThis:window);
