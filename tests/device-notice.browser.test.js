'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const {chromium} = require('playwright');
const id='0d337199-6857-44ac-930d-b6bae117dd03';
test('Chrome handles an injected wake with zero James windows and suppresses replay', {timeout:25000}, async t=>{
  const events=[], notices=[];
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/device-check/worker.js') {
      res.setHeader('Content-Type','application/javascript');
      res.end(fs.readFileSync('device-check-worker.js'));return;
    }
    if(req.url==='/api/james/device-check') {
      let data='';for await(const chunk of req)data+=chunk;
      const action=JSON.parse(data).action;
      res.setHeader('Content-Type','application/json');
      events.push(action);
      if(action==='shown')notices.push(id);
      res.end(JSON.stringify(action==='pending'&&!notices.length?{id}:{}));return;
    }
    res.setHeader('Content-Type','text/html');res.end('<title>Fictional agenda</title>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext();
  await context.grantPermissions(['notifications'],{origin});
  const controller=await context.newPage(), cdp=await context.newCDPSession(controller);
  const registered=new Promise(resolve=>cdp.on('ServiceWorker.workerRegistrationUpdated',({registrations})=>{
    const reg=registrations.find(r=>r.scopeURL===origin+'/device-check/'&&!r.isDeleted);
    if(reg)resolve(reg.registrationId);
  }));
  await cdp.send('ServiceWorker.enable');
  const app=await context.newPage();
  await app.goto(origin+'/device-check/');
  await app.evaluate(async()=>{await navigator.serviceWorker.register('./worker.js');await navigator.serviceWorker.ready;});
  const registrationId=await registered;
  await app.close();
  assert.equal(context.pages().filter(p=>p.url().startsWith(origin)).length,0);
  for(let i=1;i<=2;i++) {
    await cdp.send('ServiceWorker.deliverPushMessage',{origin,registrationId,data:''});
    await controller.waitForFunction(()=>true);
    for(let n=0;n<100 && (events.filter(x=>x==='pending').length<i || notices.length===0);n++)await new Promise(r=>setTimeout(r,25));
    assert.equal(events.filter(x=>x==='pending').length,i);assert.equal(notices.length,1);
  }
  const page=await context.newPage();await page.goto(origin+'/device-check/');
  const displayed=await page.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;return (await reg.getNotifications()).map(n=>[n.title,n.tag,n.data.id]);});
  assert.deepEqual(displayed,[['James','james-ready-'+id,id]]);
});
