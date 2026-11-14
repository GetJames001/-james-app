'use strict';
const page = new URL('./', self.registration.scope);
const endpoint = new URL('/api/james/device-check', page);
const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
async function post(action,id) {
  const response = await fetch(endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(id?{action,id}:{action})});
  if (!response.ok) throw Error('Check unavailable');
  return response.json();
}
self.addEventListener('activate', event=>event.waitUntil(self.clients.claim()));
let sequence = Promise.resolve();
self.addEventListener('push', event=>{
  // No incoming payload can supply message text, navigation or a result ID.
  sequence = sequence.catch(()=>{}).then(async()=>{
    const {id}=await post('pending');
    if (!validId(id)) return;
    const tag='james-ready-'+id;
    if (!(await self.registration.getNotifications({tag})).length) {
      await self.registration.showNotification('James',{body:'Your fictional agenda is ready for review.',tag,renotify:false,data:{id}});
    }
    await post('shown',id);
  });
  event.waitUntil(sequence);
});
self.addEventListener('notificationclick',event=>{
  const id=event.notification.data?.id;
  event.notification.close();
  if (!validId(id)) return;
  const target=new URL(page);
  target.hash=id;
  event.waitUntil((async()=>{
    // Open the result first. A receipt outage must never swallow a real tap.
    const opened=await self.clients.openWindow(target.href);
    if (opened) await post('opened',id).catch(()=>{});
  })());
});
