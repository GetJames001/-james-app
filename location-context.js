(function(root){
 'use strict';
 function mount({button,status,geolocation=root.navigator?.geolocation,permissions=root.navigator?.permissions,storage,document=root.document,now=Date.now,onPoint=()=>{},onClear=()=>{},onState=()=>{}}={}){
  if(storage===undefined)try{storage=root.localStorage}catch{}
  const key='james:live-location:v1';let enabled=false,watch=null,point=null,generation=0,state='off',permission=null;
  try{enabled=storage?.getItem(key)==='enabled';}catch{}
  function fresh(){return point&&now()-point.observedAt>=0&&now()-point.observedAt<=300000&&point.accuracy<=1000?{...point}:null;}
  function snapshot(){return {enabled,status:!enabled?'off':document.hidden?'paused':fresh()?'ready':state,observedAt:fresh()?.observedAt||null,purpose:'nearby_search_and_routing',homeAddressKnown:false};}
  function render(){
   const needsPermission=enabled&&['permission_required','denied','unavailable'].includes(state)&&!fresh();
   if(button){button.textContent=needsPermission?'Enable location':enabled?'Live location on':'Use my location';button.setAttribute('aria-pressed',String(enabled&&!needsPermission));button.title='Use your location for weather, nearby searches and routes while James is open. Tap again to turn it off.';}
   if(status)status.textContent=!enabled||fresh()?'':document.hidden?'Location paused.':state==='denied'?'Allow location in browser settings.':state==='permission_required'?'Location permission needed.':state==='unavailable'?'Location unavailable. Try again.':'Locating…';
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
   watch=geolocation.watchPosition(position=>{if(ticket!==generation||!enabled||document.hidden)return;const c=position.coords,at=position.timestamp;if(!Number.isFinite(c.latitude)||Math.abs(c.latitude)>90||!Number.isFinite(c.longitude)||Math.abs(c.longitude)>180||!Number.isFinite(c.accuracy)||c.accuracy<0||c.accuracy>1000||!Number.isFinite(at)||now()-at<0||now()-at>300000){point=null;state='inaccurate';onClear();render();return;}point={kind:'device',latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,observedAt:at};state='ready';onPoint({...point});render();},error=>{if(ticket!==generation)return;point=null;state=error.code===1?'denied':'unavailable';onClear();render();},{enableHighAccuracy:true,maximumAge:30000,timeout:15000});
  }
  async function toggle(){if(enabled&&!['permission_required','denied','unavailable'].includes(state)){enabled=false;try{storage?.removeItem(key)}catch{}stop();}else{enabled=true;try{storage?.setItem(key,'enabled')}catch{}await start(true);}render();}
  if(button)button.onclick=toggle;
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else void start();});
  root.addEventListener('pagehide',stop);root.addEventListener('pageshow',()=>void start());
  render();void start();return {point:fresh,snapshot,stop,toggle};
 }
 root.JamesLocation={mount};
 if(typeof module!=='undefined')module.exports={mount};
})(typeof window==='undefined'?globalThis:window);
