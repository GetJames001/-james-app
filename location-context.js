(function(root){
 'use strict';
 function mount({button,status,geolocation=root.navigator?.geolocation,permissions=root.navigator?.permissions,storage,document=root.document,now=Date.now,onPoint=()=>{},onClear=()=>{}}={}){
  if(storage===undefined)try{storage=root.localStorage}catch{}
  const key='james:live-location:v1';let enabled=false,watch=null,point=null,generation=0,state='off',permission=null;
  try{enabled=storage?.getItem(key)==='enabled';}catch{}
  function fresh(){return point&&now()-point.observedAt>=0&&now()-point.observedAt<=300000&&point.accuracy<=1000?{...point}:null;}
  function snapshot(){return {enabled,status:!enabled?'off':document.hidden?'paused':fresh()?'ready':state,observedAt:fresh()?.observedAt||null,purpose:'nearby_search_and_routing',homeAddressKnown:false};}
  function render(){if(button){button.textContent=enabled?'Stop live location':'Live location';button.setAttribute('aria-pressed',String(enabled));}if(status)status.textContent=!enabled?'Live location supports nearby searches and routing while James is open.':document.hidden?'Location paused.':fresh()?'Location ready.':state==='denied'?'Location permission is blocked. Allow it in browser settings or name a city.':state==='permission_required'?'Tap to enable live location permission.':'Waiting for a fresh, accurate location…';}
  function stop(){generation++;if(watch!==null)geolocation?.clearWatch(watch);watch=null;point=null;onClear();render();}
  async function start(interactive=false){
   if(!enabled||document.hidden||watch!==null)return;
   if(!geolocation){state='unavailable';render();return;}
   const opening=generation;
   if(!interactive){try{permission=await permissions?.query({name:'geolocation'});if(permission?.state!=='granted'){state='permission_required';render();return;}}catch{state='permission_required';render();return;}}
   if(!enabled||document.hidden||watch!==null||opening!==generation)return;
   const ticket=++generation;state='locating';render();
   watch=geolocation.watchPosition(position=>{if(ticket!==generation||!enabled||document.hidden)return;const c=position.coords,at=position.timestamp;if(!Number.isFinite(c.latitude)||Math.abs(c.latitude)>90||!Number.isFinite(c.longitude)||Math.abs(c.longitude)>180||!Number.isFinite(c.accuracy)||c.accuracy<0||c.accuracy>1000||!Number.isFinite(at)||now()-at<0||now()-at>300000){point=null;state='inaccurate';onClear();render();return;}point={kind:'device',latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,observedAt:at};state='ready';onPoint({...point});render();},error=>{if(ticket!==generation)return;point=null;state=error.code===1?'denied':'unavailable';onClear();render();},{enableHighAccuracy:true,maximumAge:30000,timeout:15000});
  }
  async function toggle(){if(enabled&&state!=='permission_required'){enabled=false;try{storage?.removeItem(key)}catch{}stop();}else{enabled=true;try{storage?.setItem(key,'enabled')}catch{}await start(true);}render();}
  if(button)button.onclick=toggle;
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else void start();});
  root.addEventListener('pagehide',stop);root.addEventListener('pageshow',()=>void start());
  render();void start();return {point:fresh,snapshot,stop,toggle};
 }
 root.JamesLocation={mount};
 if(typeof module!=='undefined')module.exports={mount};
})(typeof window==='undefined'?globalThis:window);
