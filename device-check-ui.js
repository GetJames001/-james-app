'use strict';
(() => {
  const get=id=>document.getElementById(id), endpoint='/api/james/device-check';
  const reviewId=location.hash.slice(1);
  const supported='serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function request(action,extra={}) {
    const options=action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra})}:{};
    const r=await fetch(endpoint,{...options,credentials:'same-origin',cache:'no-store',redirect:'error'});
    if (!r.ok) throw Error(r.status===401?'Sign in to this James Preview and open this link again.':'James could not confirm this check. Reopen this page to see its saved state.');
    return r.json();
  }
  async function refresh() {
    const s=await request();
    if (reviewId && s.id!==reviewId) throw Error('This saved result is unavailable.');
    const show=!!s.agenda;
    get('result').hidden=!show;
    if(show){get('title').textContent=s.agenda.title;get('text').textContent=s.agenda.text;}
    const setup=['new','pairing'].includes(s.state);
    get('pair').hidden=!!reviewId || !setup || !supported;
    get('run').hidden=!!reviewId || s.state!=='registered' || show;
    get('stop').hidden=!!reviewId || !['pairing','registered'].includes(s.state);
    get('message').textContent=s.opened?'Alert opened on the device.':s.shown?'The browser reported showing the alert.':s.state==='stopped'?'Test stopped.':s.state==='expired'?'Test window ended.':s.transport==='accepted'?'Push service accepted the alert. Waiting for the device.':show?'Agenda prepared. Device delivery is unconfirmed.':s.state==='registered'?'Phone registered. Close James on your phone. The test can run from another signed-in device.':supported?'Allow one test alert for a fictional agenda.':'Open this page in Chrome on Android to enable a test alert.';
  }
  async function action(fn) {
    const buttons=document.querySelectorAll('button');
    buttons.forEach(b=>b.disabled=true);
    try {await fn(); await refresh();} catch(e) {get('message').textContent=e.message;}
    finally {buttons.forEach(b=>b.disabled=false);}
  }
  get('pair').onclick=()=>action(async()=>{
    // Keep the permission prompt inside the user's tap.
    if(await Notification.requestPermission()!=='granted') throw Error('Notifications are off. No phone was registered.');
    const {subscriptionKey}=await request('begin');
    const reg=await navigator.serviceWorker.register('/device-check/worker.js',{scope:'/device-check/'});
    await navigator.serviceWorker.ready;
    const key=Uint8Array.from(atob(subscriptionKey.replace(/-/g,'+').replace(/_/g,'/')+'='),c=>c.charCodeAt(0));
    let sub=await reg.pushManager.getSubscription();
    if(sub && (!sub.options.applicationServerKey || !key.every((b,i)=>new Uint8Array(sub.options.applicationServerKey)[i]===b))) {
      if (!await sub.unsubscribe()) throw Error('Could not replace the previous test subscription.');
      sub=null;
    }
    sub ||= await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await request('pair',{endpoint:sub.endpoint});
  });
  get('run').onclick=()=>action(()=>request('run'));
  get('stop').onclick=()=>action(async()=>{
    await request('stop');
    const reg=await navigator.serviceWorker?.getRegistration('/device-check/');
    if (reg?.scope===new URL('/device-check/',location.href).href) {
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      await reg.unregister();
    }
  });
  refresh().catch(e=>get('message').textContent=e.message);
})();
