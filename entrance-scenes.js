/* Public entrance preferences only. No account, session or credential data. */
(function(root){
  'use strict';
  const layouts={
    morning:['left','68%'],noon:['left','72%'],evening:['left','70%'],night:['left','74%'],
    oceanfront:['lower-center','50%'],'strip-terrace':['upper-right','50%'],
    'red-rock-terrace':['lower-right','35%'],'corner-penthouse':['lower-center','58%'],
    'fontainebleau-penthouse':['left','57%'],'moonlit-forest':['lower-left','55%'],
    'winter-lodge':['lower-left','69%'],beach:['lower-right','62%'],
    'red-rock-snow':['lower-right','28%'],'winter-storm-penthouse':['lower-right','51%'],
    'aurora-from-orbit':['upper-right','42%']
  };
  const ids=['waterfront',...Object.keys(layouts).filter(id=>!['morning','noon','evening','night'].includes(id))];
  const read=(store,key)=>{try{return root[store].getItem(key);}catch{return null;}};
  const write=(key,value)=>{try{root.localStorage.setItem(key,value);}catch{}};
  const forHour=hour=>hour<6||hour>=21?'night':hour<11?'morning':hour<17?'noon':'evening';
  function preferences(){
    let saved;try{saved=JSON.parse(read('localStorage','jamesIntroScreen'));}catch{}
    return {mode:['automatic','fixed','rotate'].includes(saved?.mode)?saved.mode:'automatic',
      scene:ids.includes(saved?.scene)?saved.scene:'waterfront',
      favorites:ids.filter(id=>Array.isArray(saved?.favorites)&&saved.favorites.includes(id))};
  }
  function select(prefs,{hour=new Date().getHours(),previous=null,random=Math.random}={}){
    let id=prefs.mode==='fixed'?prefs.scene:'waterfront';
    if(prefs.mode==='rotate'&&prefs.favorites.length){
      const choices=prefs.favorites.length>1?prefs.favorites.filter(name=>name!==previous):prefs.favorites;
      id=choices[Math.min(choices.length-1,Math.floor(random()*choices.length))];
    }
    const name=id==='waterfront'?forHour(hour):id;
    return {id,name,panel:layouts[name][0],crop:layouts[name][1],poster:'/login-poster-'+name+'.jpg'};
  }
  const onLogin=/^\/login(?:\.html)?$/.test(root.location.pathname);
  const seen=read('sessionStorage','jamesIntroDate')===new Date().toDateString();
  const prefs=preferences();
  const last=read('localStorage','jamesLastEntranceScene');
  const current=select(prefs,{previous:last});
  if(onLogin||!seen)write('jamesLastEntranceScene',current.id);
  const html=document.documentElement;
  html.dataset.theme=read('localStorage','jamesTheme')==='light'?'light':'dark';
  html.dataset.scenePanel=current.panel;
  html.style.setProperty('--scene-crop',current.crop+' center');
  html.style.setProperty('--art','url("'+current.poster+'")');
  html.style.setProperty('--welcome-art','url("'+current.poster+'")');
  if(seen&&!onLogin)html.classList.add('james-session-active');
  if(onLogin)root.addEventListener('pageshow',event=>{if(event.persisted)root.location.reload();});
  root.JamesEntrance=Object.freeze({current,preferences,select,forHour});
})(window);
