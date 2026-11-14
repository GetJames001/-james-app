(function(root){
 'use strict';
 function mount({button,status,geolocation=root.navigator?.geolocation,permissions=root.navigator?.permissions,storage,document=root.document,now=Date.now,onPoint=()=>{},onWeatherPoint=()=>{},onClear=()=>{},onState=()=>{}}={}){
  if(storage===undefined)try{storage=root.localStorage}catch{}
  const key='james:live-location:v1';let enabled=false,watch=null,point=null,generation=0,state='off',permission=null;
  try{enabled=storage?.getItem(key)==='enabled';}catch{}
  // Weather is regional. Nearby searches and driving keep the existing 1 km limit.
  function freshWeatherPoint(){
   if(!point||now()-point.observedAt<0||now()-point.observedAt>300000)return null;
   return {...point};
  }
  function fresh(){return point?.accuracy<=1000?freshWeatherPoint():null;}
  function snapshot(){return {enabled,status:!enabled?'off':document.hidden?'paused':fresh()?'ready':state,observedAt:fresh()?.observedAt||null,purpose:'nearby_search_and_routing',homeAddressKnown:false};}
  function render(){
   const needsPermission=enabled&&['permission_required','denied','unavailable','inaccurate'].includes(state)&&!fresh();
   if(button){
    button.textContent=!enabled?'Use my location':state==='denied'?'Check location access':needsPermission?'Enable location':state==='locating'?'Cancel location request':'Live location on';
    button.setAttribute('aria-pressed',String(enabled&&!needsPermission));
    button.title=state==='denied'?'Check again after allowing location for this site.':'Use your location for weather, nearby searches and routes while James is open.';
   }
   if(status)status.textContent=!enabled||fresh()?'':document.hidden?'Location paused.':state==='denied'?'Location access is blocked. Turn on device location and allow Location for this site in your browser, then check again.':state==='permission_required'?'Location permission needed.':state==='approximate'?'Approximate location for weather.':state==='inaccurate'?'Location too broad or out of date. Try again.':state==='unavailable'?'No location received. Check device location and try again.':'Locating…';
   onState(snapshot());
  }
  function stop(){generation++;if(watch!==null)geolocation?.clearWatch(watch);watch=null;point=null;onClear();render();}
  async function start(interactive=false){
   if(!enabled||document.hidden||watch!==null)return;
   if(!geolocation){state='unavailable';render();return;}
   const opening=generation;let permissionPrompt=false;
   // A saved James opt-in may resume the browser request. "prompt" is not denial:
   // watchPosition still enforces the browser's own permission/consent decision.
   if(!interactive){try{permission=await permissions?.query({name:'geolocation'});if(permission?.state==='denied'){state='denied';render();return;}permissionPrompt=permission?.state==='prompt';}catch{/* A remembered opt-in can resume on browsers without Permissions API support. */}}
   if(!enabled||document.hidden||watch!==null||opening!==generation)return;
   const ticket=++generation;state=permissionPrompt?'permission_required':'locating';render();
   let triedFallback=false;
   const active=()=>ticket===generation&&enabled&&!document.hidden;
   function tryRegionalLocation(){
    if(triedFallback||!geolocation.getCurrentPosition||freshWeatherPoint())return;
    triedFallback=true;
    geolocation.getCurrentPosition(position=>{
     if(!freshWeatherPoint())receive(position);
    },error=>{if(error.code===1)failed(error);},{enableHighAccuracy:false,maximumAge:30000,timeout:10000});
   }
   function receive(position){
    if(!active())return;
    const {coords:c,timestamp:at}=position,age=now()-at;
    if(!Number.isFinite(c.latitude)||Math.abs(c.latitude)>90||
       !Number.isFinite(c.longitude)||Math.abs(c.longitude)>180||
       !Number.isFinite(c.accuracy)||c.accuracy<0||c.accuracy>25000||
       !Number.isFinite(at)||age<0||age>300000){
     if(!freshWeatherPoint()){
      point=null;state='inaccurate';onClear();render();tryRegionalLocation();
     }
     return;
    }
    point={kind:'device',latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,observedAt:at};
    state=c.accuracy<=1000?'ready':'approximate';
    if(state==='ready')onPoint({...point});else onClear();
    onWeatherPoint({...point});
    render();
   }
   function failed(error){
    if(!active())return;
    if(error.code===1){
     generation++;point=null;state='denied';onClear();render();return;
    }
    if(!freshWeatherPoint()){
     point=null;state='unavailable';onClear();render();
    }
    // Some devices time out on GPS indoors. Keep the watch for a better fix.
    tryRegionalLocation();
   }
   watch=geolocation.watchPosition(receive,failed,{enableHighAccuracy:true,maximumAge:30000,timeout:15000});
  }
  async function toggle(){
   const retry=enabled&&['permission_required','denied','unavailable','inaccurate'].includes(state);
   if(enabled&&!retry){enabled=false;try{storage?.removeItem(key)}catch{}stop();}
   else{
    if(enabled&&state==='denied'){
     const beforeCheck=generation;
     let currentPermission;
     try{currentPermission=await permissions?.query({name:'geolocation'});}catch{/* Retry the browser request when permission status is unavailable. */}
     if(beforeCheck!==generation||!enabled||document.hidden||currentPermission?.state==='denied')return;
    }
    // An errored watch still has an ID. Release it before retrying from the button.
    if(retry&&watch!==null)stop();
    enabled=true;try{storage?.setItem(key,'enabled')}catch{}await start(true);
   }
   render();
  }
  if(button)button.onclick=toggle;
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else void start();});
  root.addEventListener('pagehide',stop);root.addEventListener('pageshow',()=>void start());
  render();void start();return {point:fresh,weatherPoint:freshWeatherPoint,snapshot,stop,toggle};
 }
 root.JamesLocation={mount};
 if(typeof module!=='undefined')module.exports={mount};
})(typeof window==='undefined'?globalThis:window);
