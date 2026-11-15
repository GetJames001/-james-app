'use strict';
const validKey=key=>typeof key==='string' && /^[a-f0-9]{64}$/.test(key);
const reviewUrl=key=>new URL('/review/mail/'+key,self.location.origin).href;

async function receipt(action,key){
  try{await fetch('/api/attention/alert',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,key})});}catch{/* Opening the result takes priority over its receipt. */}
}
async function showReview(key){
  const response=await fetch(reviewUrl(key),{
    method:'HEAD',credentials:'same-origin',cache:'no-store',redirect:'error'
  });
  if(!response.ok || response.headers.get('X-James-Review-State')!=='ready')return;
  const tag='james-review-'+key;
  if((await self.registration.getNotifications({tag})).length)return;
  await self.registration.showNotification('James',{
    body:response.headers.get('X-James-Review-Category')==='reservation'?'A reservation confirmation arrived.':'A saved item needs your review.',tag,renotify:false,data:{key}
  });
  await receipt('shown',key);
}

let pending=Promise.resolve();
self.addEventListener('push',event=>{
  let message;
  try{message=event.data?.json();}catch{return;}
  if(message?.kind!=='saved-mail-review' || !validKey(message.key))return;
  pending=pending.catch(()=>{}).then(()=>showReview(message.key));
  event.waitUntil(pending);
});
self.addEventListener('notificationclick',event=>{
  const key=event.notification.data?.key;
  event.notification.close();
  if(validKey(key))event.waitUntil((async()=>{const opened=await self.clients.openWindow(reviewUrl(key));if(opened)await receipt('opened',key);})());
});
