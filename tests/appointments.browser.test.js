'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('appointment card requires explicit confirmation, renders safe text, supports cancellation and safe retry',async()=>{
 let confirms=0,uncertain=true;const server=http.createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<script src="/appointments-ui.js"></script>');}
  if(req.url==='/appointments-ui.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(fs.readFileSync(path.join(__dirname,'..','appointments-ui.js')));}
  res.setHeader('Content-Type','application/json');if(req.method==='GET')return res.end('{"createConnected":true}');
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);if(req.url==='/api/james/places')return res.end(JSON.stringify({status:'ready',places:[{name:'Fixture business',address:'Verified fixture address'}]}));
  if(body.action==='prepare')return res.end(JSON.stringify({status:'review_required',details:body.details,reviewToken:'same-signed-review',expiresAt:new Date(Date.now()+600000).toISOString()}));
  assert.equal(body.reviewToken,'same-signed-review');confirms++;if(uncertain){uncertain=false;res.statusCode=503;return res.end('{"error":"CALENDAR_SAVE_UNCONFIRMED"}');}return res.end('{"status":"created","event":{"id":"fixture"}}');
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch();const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{window.changed=0;window.appointments=JamesAppointments.mount({onCreated:()=>{window.changed++;}});window.details={title:'Test <img src=x onerror=alert(1)>',location:'Confirmed example address',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),timeZone:'America/Los_Angeles'};});
  await page.evaluate(()=>window.appointments.prepare(window.details));assert.equal(confirms,0);assert.equal(await page.locator('dialog img').count(),0);assert.match(await page.locator('dialog').textContent(),/Test <img/);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.evaluate(()=>window.appointments.read().status),'cancelled');assert.equal(confirms,0);
  await page.evaluate(()=>window.appointments.prepare(window.details));await page.getByRole('button',{name:'Create appointment',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Retry this same review'));assert.equal(await page.evaluate(()=>window.changed),0);
  await page.getByRole('button',{name:'Create appointment',exact:true}).click();await page.waitForFunction(()=>window.appointments.read().status==='created');assert.equal(confirms,2);assert.equal(await page.evaluate(()=>window.changed),1);assert.match(await page.locator('dialog > [role=status]').textContent(),/saved/);await page.getByRole('button',{name:'Done',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);await page.evaluate(()=>window.appointments.setup());await page.getByLabel('Business and city or street').fill('Fixture business Las Vegas');await page.getByRole('button',{name:'Find business',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('section button').disabled);assert.match(await page.locator('section').textContent(),/Fixture business — Verified fixture address/);assert.equal(confirms,2);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
