(function(root){
 'use strict';
 function create({Recognition=root.SpeechRecognition||root.webkitSpeechRecognition,MobileRecognition=root.JamesMobileWakeRecognition,permissions=root.navigator?.permissions,document=root.document,onStatus=()=>{},onWake=async()=>{},allowed=()=>true}={}){
  let SelectedRecognition=Recognition,engine=null,wanted=false,ticket=0,restart=null,restarts=[],phase='off',stopping=Promise.resolve(true);
  const status=(value,message)=>{phase=value;onStatus({phase:value,message});};
  async function check(){let native='unsupported';try{if(Recognition&&typeof Recognition.available==='function'&&'processLocally' in new Recognition())native=await Recognition.available({langs:['en-US'],processLocally:true});}catch{}SelectedRecognition=Recognition;if(!['available','downloadable','downloading'].includes(native)&&MobileRecognition){try{if(await MobileRecognition.available()==='available'){SelectedRecognition=MobileRecognition;return 'available';}}catch{}}return native;}
  async function stop(){ticket++;clearTimeout(restart);restart=null;const current=engine;engine=null;if(!current)return await stopping;stopping=new Promise(resolve=>{let ended=false;const done=value=>{if(ended)return;ended=true;clearTimeout(timeout);resolve(value);};const timeout=setTimeout(()=>done(false),1500);current.addEventListener('end',()=>done(true),{once:true});try{current.abort();}catch{done(false);}});return await stopping;}
  async function pause(){const released=await stop();status(wanted?'paused':'off',wanted?'Wake microphone paused.':'Wake microphone off.');return released;}
  async function disable(){wanted=false;await pause();}
  async function listen(interactive=false){
   if(!wanted||document.hidden||!allowed()||engine)return false;const generation=++ticket;const released=await stopping;if(generation!==ticket)return false;if(!released){status('paused','Microphone release could not be verified. Tap to wake.');return false;}
   if(!interactive){try{const permission=await permissions?.query({name:'microphone'});if(permission?.state!=='granted'){wanted=false;status('permission_required','Tap Enable Hey James to allow the microphone.');return false;}}catch{wanted=false;status('permission_required','Tap Enable Hey James to allow the microphone.');return false;}}
   status('checking','Checking local wake-word support…');const available=await check();
   if(generation!==ticket||!wanted||document.hidden||!allowed())return false;
   if(available!=='available'){status(available==='downloadable'||available==='downloading'?'download_required':'unsupported',available==='downloadable'||available==='downloading'?'A local speech pack is needed. Download it in Voice or Display settings.':'Local Hey James is unavailable in this browser. Tap to wake still works.');return false;}
   const current=new SelectedRecognition();current.lang='en-US';current.continuous=true;current.interimResults=false;current.processLocally=true;
   if(current.processLocally!==true){status('unsupported','Local wake-word processing could not be verified. Tap to wake.');return false;}
   engine=current;
   current.onstatus=message=>{if(engine===current)status('loading',message);};
   current.onstart=()=>{if(engine===current)status('listening','Listening locally for “Hey James”.');};
   current.onresult=async event=>{
    if(engine!==current||document.hidden||!allowed())return;
    for(let i=event.resultIndex||0;i<event.results.length;i++){const result=event.results[i];if(!result.isFinal)continue;const text=String(result[0]?.transcript||'').toLowerCase().replace(/[^a-z\s]/g,' ').replace(/\s+/g,' ');if(!/(^|\s)hey james(?:\s|$)/.test(text))continue;
     status('waking','Heard Hey James. Releasing the local microphone…');const stopped=stop(),generation=ticket;const released=await stopped;if(generation!==ticket||!wanted||document.hidden||!allowed())return;
     if(!released){status('paused','Microphone handoff could not be confirmed. Tap James to talk.');return;}
     try{await onWake();}catch{status('paused','James could not connect. Tap James to talk.');}return;
    }
   };
   current.onerror=event=>{if(engine!==current)return;if(event.error==='no-speech')return;wanted=false;void stop();status('paused',event.error==='not-allowed'||event.error==='service-not-allowed'?'Microphone permission was denied. Tap to wake or enable permission in browser settings.':'Local wake-word listening stopped. Tap Enable Hey James to retry.');};
   current.onend=()=>{if(engine!==current)return;engine=null;if(!wanted||document.hidden||!allowed())return;const now=Date.now();restarts=restarts.filter(at=>now-at<60000);if(restarts.length>=3){status('paused','Wake-word listening paused after repeated stops. Tap Enable Hey James to retry.');return;}restarts.push(now);restart=setTimeout(()=>void listen(),1000);};
   try{current.start();return true;}catch{engine=null;status('paused','Wake microphone could not start. Tap Enable Hey James to retry.');return false;}
  }
  async function enable(){wanted=true;restarts=[];return listen(true);}
  async function install(){if(!Recognition||typeof Recognition.install!=='function')return false;status('downloading','Downloading the browser’s local speech pack…');try{const result=await Recognition.install({langs:['en-US'],processLocally:true});status(result?'off':'unsupported',result?'Local speech pack ready. Tap Enable Hey James.':'Local speech pack installation failed. Tap to wake still works.');return result;}catch{status('unsupported','Local speech pack could not be installed. Tap to wake still works.');return false;}}
  return {enable,disable,pause,resume:()=>listen(),check,install,restore:()=>{wanted=true;return listen();},snapshot:()=>({phase,wanted,localOnly:true})};
 }
 root.JamesWakeListener={create};
 if(typeof module!=='undefined')module.exports={create};
})(typeof window==='undefined'?globalThis:window);
