'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('Gmail saved review opens plain source without Hotmail mutations, survives refresh and handles stale navigation',async()=>{
 let mutations=0,scans=0,delay=false,release;
 const saved={checkedAt:'2026-11-06T17:00:00Z',inventoryCount:1,stale:false,sources:{hotmail:{checkedAt:'2026-11-06T17:00:00Z',stale:false},gmail:{checkedAt:'2026-11-06T17:00:00Z',stale:false}},items:[{id:'gmail:abc',subject:'Interview invitation',sender:'Fixture',preview:'Confirm a time',reasons:['Possible career response']}]};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(url.pathname==='/api/attention/scan'){scans++;return res.end('{"saved":true}');}
   if(req.method!=='GET'){if(['/api/tasks','/api/microsoft/mail','/api/microsoft/compose'].includes(url.pathname))mutations++;return res.end('{}');}
   if(url.pathname==='/api/attention')return res.end(JSON.stringify({mailReview:saved}));
   if(url.pathname==='/api/google/gmail/messages'){
    if(delay)await new Promise(resolve=>{release=resolve;});
    return res.end(JSON.stringify({connected:true,message:{id:'gmail:abc',subject:'Interview invitation',sender:'Fixture',bodyText:'<script>window.injected=true</script> Plain source text.'}}));
   }
   if(url.pathname==='/api/microsoft/mail')return res.end('{"connected":true,"unreadCount":0,"messages":[]}');
   if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   if(url.pathname==='/api/auth/session')return res.end('{"ok":true,"authenticated":true}');
   return res.end('{"connected":false}');
  }
  const filename=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));
  try{res.setHeader('Content-Type',/\.m?js$/.test(filename)?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(filename));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:768}});await page.route('https://**',route=>route.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#mailAttentionView article').waitFor({state:'attached'});await page.evaluate(()=>window.page('attention'));
  assert.match(await page.locator('#mailAttentionView article').textContent(),/Gmail · Fixture/);assert.equal(scans,0);
  await page.locator('#mailAttentionView').getByRole('button',{name:'Check recent mail'}).click();await page.waitForFunction(()=>!document.querySelector('#mailAttentionView button').disabled);assert.equal(scans,1);
  await page.locator('#mailAttentionView').getByRole('button',{name:'Review in Mail'}).click();await page.locator('#personalMailDetailBody pre').waitFor();assert.match(await page.locator('#personalMailDetailMeta').textContent(),/Gmail.*Read only/);
  assert.equal(await page.locator('#personalMailReplyButton').count(),0);assert.equal(await page.locator('#personalMailReadButton').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(mutations,0);
  await page.reload();await page.locator('#mailAttentionView article').waitFor({state:'attached'});assert.equal(scans,1);await page.evaluate(()=>window.page('attention'));
  delay=true;await page.locator('#mailAttentionView').getByRole('button',{name:'Review in Mail'}).click();await page.locator('#personalMailDetailBody').getByText('Loading Gmail message…').waitFor();
  await page.evaluate(()=>window.page('appointments'));while(!release)await new Promise(resolve=>setTimeout(resolve,10));const ready=page.waitForResponse(r=>r.url().includes('/api/google/gmail/messages'));release();await ready;
  assert.equal(await page.locator('#appointments.active').count(),1);assert.equal(await page.locator('#personalMailDetailBody pre').count(),0);assert.equal(mutations,0);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
