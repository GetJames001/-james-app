/* Minimal welcome transition. No network, speech, microphone, or route writes. */
(function (root) {
  'use strict';
  let timer = null;
  let finished = false;
  let started = false;
  let scene = null;
  const sceneForHour = hour => hour < 6 || hour >= 21 ? 'night' : hour < 11 ? 'morning' : hour < 17 ? 'noon' : 'evening';
  function stopScene(){if(scene){const video=scene;scene=null;video.pause();video.removeAttribute('src');video.load();video.remove();}document.getElementById('intro')?.classList.remove('scene-awaiting');}
  function playScene(){
    const existing=document.getElementById('loginScene');
    if(read('localStorage','jamesAnimation')==='off'||!document.createElement){scene=existing;return;}
    const intro=document.getElementById('intro');if(!intro)return;
    if(existing&&existing.isConnected&&existing.currentSrc){
      scene=existing;
      const reveal=()=>{if(finished||scene!==existing)return;existing.classList.add('playing');existing.style.opacity='1';intro.style.backgroundImage='var(--welcome-wash)';intro.style.backgroundColor='transparent';};
      if(existing.classList.contains('playing'))reveal();
      else existing.addEventListener('playing',()=>{if(existing.requestVideoFrameCallback)existing.requestVideoFrameCallback(reveal);else reveal();},{once:true});
      return;
    }
    if(existing){scene=existing;return;} // Failed media stays on the matching still until cleanup.
    intro.classList.add('scene-awaiting');
    const video=document.createElement('video');scene=video;
    video.className='living-scene';video.muted=true;video.defaultMuted=true;video.playsInline=true;video.setAttribute('playsinline','');video.setAttribute('aria-hidden','true');video.tabIndex=-1;video.preload='auto';
    const reveal=()=>{if(!finished&&scene===video)video.classList.add('playing');};
    video.addEventListener('playing',()=>{
      // Wait for the first decoded frame on supported browsers before blending
      // over the still artwork. Older browsers blend after playback begins.
      if(typeof video.requestVideoFrameCallback==='function')video.requestVideoFrameCallback(reveal);
      else reveal();
    });
    video.addEventListener('error',()=>{if(scene===video)stopScene();},{once:true});
    video.src='assets/scenes/'+sceneForHour(new Date().getHours())+'.mp4';intro.prepend(video);
    try{const pending=video.play();pending?.catch(()=>{if(scene===video)stopScene();});}catch{stopScene();}
  }
  const read = (store, key) => { try { return root[store].getItem(key); } catch (_) { return null; } };
  const write = (store, key, value) => { try { root[store].setItem(key, value); } catch (_) {} };
  function applyTheme(theme) {
    const selected = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = selected;
    const button = document.getElementById('jamesThemeToggle');
    if (button) {
      button.textContent = selected === 'dark' ? 'Light' : 'Dark';
      button.setAttribute('aria-label', selected === 'dark' ? 'Use light theme' : 'Use dark theme');
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', selected === 'dark' ? '#071225' : '#f6f2e9');
    return selected;
  }
  function finish() {
    if (finished) return;
    finished = true;
    // Retain the last rendered frame through the existing dissolve; removing
    // it immediately flashes the older still underneath the fading text.
    if(scene){scene.pause();scene.style&&(scene.style.opacity='0');root.setTimeout(stopScene,700);}
    root.clearTimeout(timer);
    timer = null;
    write('sessionStorage', 'jamesIntroDate', new Date().toDateString());
    const intro = document.getElementById('intro');
    const app = document.getElementById('app');
    if (intro) { intro.classList.add('hide'); intro.inert = true; intro.setAttribute('aria-hidden', 'true'); }
    if (app) { app.inert = false; app.classList.remove('frosted'); app.classList.add('clear'); }
    // The same Perspective remains available in the Briefing for unhurried reading.
  }
  function start(options = {}) {
    if (started) return;
    started = true;
    applyTheme(read('localStorage', 'jamesTheme'));
    document.getElementById('jamesThemeToggle')?.addEventListener('click', () => {
      const theme = applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      write('localStorage', 'jamesTheme', theme);
    });
    const seen = read('sessionStorage', 'jamesIntroDate') === new Date().toDateString();
    const reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (seen || reduced) {
      scene=document.getElementById('loginScene');
      finish();
      if (seen && typeof options.onResume === 'function') options.onResume();
      return;
    }
    const app = document.getElementById('app');
    if (app) app.inert = true;
    timer = root.setTimeout(finish, 5000);
    playScene();
    // Do not leave a stale transition attached to a page restored from history.
    root.addEventListener('pagehide', () => { finish(); stopScene(); }, { once: true });
  }
  function mountIntroPicker() {
    const picker=document.getElementById('introScreenPicker');
    if(!picker)return;
    const byId=id=>document.getElementById(id);
    const mode=byId('introMode'), list=byId('introSceneList');
    const status=byId('introSceneStatus'), video=byId('introSceneVideo'), still=byId('introSceneStill');
    const previewLabel=byId('introScenePreviewLabel');
    const scenes=[
      ['waterfront','Waterfront · Follows the day'],
      ['oceanfront','Oceanfront Twilight · Summer'],
      ['strip-terrace','Strip Terrace · Private preview',false,true],
      ['forest','Moonlit Forest Retreat · Fall',true],
      ['penthouse','Las Vegas Penthouse',true],
      ['winter','Winter Lodge · Winter',true]
    ];
    const defaults={mode:'automatic',scene:'waterfront',favorites:[]};
    let prefs=defaults;
    try {
      const saved=JSON.parse(read('localStorage','jamesIntroScreen'));
      if(saved&&['automatic','fixed','rotate'].includes(saved.mode)){
        const playable=scenes.filter(([, ,concept,privatePreview])=>!concept&&!privatePreview).map(([id])=>id);
        prefs={mode:saved.mode,scene:playable.includes(saved.scene)?saved.scene:'waterfront',
          favorites:Array.isArray(saved.favorites)?playable.filter(id=>saved.favorites.includes(id)):[]};
      }
    } catch (_) {}
    mode.value=prefs.mode;
    function save(message){
      try {
        root.localStorage.setItem('jamesIntroScreen',JSON.stringify(prefs));
        status.textContent=message;
      } catch (_) {status.textContent='This browser could not save the intro preference.';}
    }
    function stopPreview(){
      video.pause();video.removeAttribute('src');video.load();video.hidden=true;
      still.removeAttribute('src');still.hidden=true;previewLabel.hidden=true;
    }
    mode.addEventListener('change',()=>{
      prefs={...prefs,mode:mode.value};
      save(prefs.mode==='rotate'&&!prefs.favorites.length?'Add a favorite to start rotating scenes.':'Saved on this device.');
    });
    byId('introScreenOpen').addEventListener('click',()=>picker.showModal());
    picker.addEventListener('close',stopPreview);
    for(const [id,name,concept,privatePreview] of scenes){
      const row=document.createElement('li');
      const title=document.createElement('span');
      title.textContent=name;
      const preview=document.createElement('button');
      preview.type='button';preview.textContent=concept?'Preview still':'Preview';
      preview.setAttribute('aria-label','Preview '+name);
      preview.onclick=()=>{
        stopPreview();
        previewLabel.hidden=false;
        if(concept){still.src='/assets/scenes/'+id+'.png';still.alt=name;still.hidden=false;}
        else {
          const clip=id==='waterfront'?sceneForHour(new Date().getHours()):id;
          video.src='/assets/scenes/'+clip+'.mp4';video.hidden=false;
          if(!root.matchMedia('(prefers-reduced-motion: reduce)').matches)video.play().catch(()=>{});
        }
        status.textContent=concept?'Concept still. Motion footage pending.':name+' preview.';
      };
      row.append(title,preview);
      if(!concept&&!privatePreview){
        const choose=document.createElement('button');
        choose.type='button';choose.textContent='Use';
        choose.setAttribute('aria-label','Use '+name);
        choose.onclick=()=>{mode.value='fixed';prefs={...prefs,mode:'fixed',scene:id};save(name+' saved on this device.');};
        const label=document.createElement('label'),favorite=document.createElement('input');
        favorite.type='checkbox';favorite.checked=prefs.favorites.includes(id);
        favorite.setAttribute('aria-label','Favorite '+name);
        favorite.onchange=()=>{
          const favorites=prefs.favorites.filter(value=>value!==id);
          if(favorite.checked)favorites.push(id);
          prefs={...prefs,favorites};save('Favorites saved on this device.');
        };
        label.append(favorite,' Favorite');row.append(choose,label);
      }
      list.append(row);
    }
  }
  if(document.readyState==='loading')document.addEventListener?.('DOMContentLoaded',mountIntroPicker,{once:true});
  else mountIntroPicker();
  root.JamesWelcome = Object.freeze({ start, finish, applyTheme, sceneForHour });
})(window);
