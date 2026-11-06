'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('handled suggestions persist, undo restores them, failures retain them and To Do glow follows active work',async()=>{
 let failDecision=false,mailWrites=0,taskWrites=0,decisions=0;
 const item={id:'gmail:abc',reviewKey:'a'.repeat(64),subject:'Interview invitation',sender:'Fixture',preview:'Confirm a time',reasons:['Possible career response']};
 const saved={checkedAt:'2026-11-06T18:00:00Z',inventoryCount:1,stale:false,sources:{hotmail:{checkedAt:'2026-11-06T18:00:00Z',stale:false},gmail:{checkedAt:'2026-11-06T18:00:00Z',stale:false}},items:[item],handledItems:[]};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(url.pathname==='/api/attention/decision'){
    let raw='';for await(const chunk of req)raw+=chunk;decisions++;
    if(failDecision){res.statusCode=503;return res.end('{}');}
    const body=JSON.parse(raw);assert.equal(body.reviewKey,item.reviewKey);saved.items=body.action==='handled'?[]:[item];saved.handledItems=body.action==='handled'?[item]:[];return res.end('{"saved":true}');
   }
   if(url.pathname==='/api/attention/scan')return res.end('{"saved":true}');
   if(req.method!=='GET'){if(url.pathname==='/api/microsoft/mail')mailWrites++;if(url.pathname==='/api/tasks')taskWrites++;return res.end('{}');}
   if(url.pathname==='/api/attention')return res.end(JSON.stringify({schemaVersion:1,status:'available',revision:1,attentionItems:[],sourceHealth:[],needsReview:[],coverage:[],mailReview:saved}));
   if(url.pathname==='/api/microsoft/mail')return res.end('{"connected":true,"unreadCount":0,"messages":[]}');
   if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   if(url.pathname==='/api/auth/session')return res.end('{"ok":true,"authenticated":true}');
   return res.end('{"connected":false}');
  }
  const file=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));
  try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:768}});await page.route('https://**',route=>route.abort());await page.clock.install();const url='http://127.0.0.1:'+server.address().port;
  await page.goto(url);await page.locator('#mailAttentionView article').waitFor({state:'attached'});await page.evaluate(()=>window.page('attention'));
  const nav=page.locator('nav [data-page="attention"]'),view=page.locator('#mailAttentionView');assert.match(await nav.getAttribute('class'),/has-attention/);assert.equal(await page.locator('.saved-attention').getAttribute('open'),null);
  await view.getByRole('button',{name:'Mark handled'}).click();await view.getByText('Marked handled. Your email and tasks are unchanged.',{exact:true}).waitFor();assert.equal(await view.locator('.mail-review-list article').count(),0);assert.doesNotMatch(await nav.getAttribute('class'),/has-attention/);assert.equal(decisions,1);
  await view.getByRole('button',{name:'Undo',exact:true}).click();await view.getByText('Suggestion restored.',{exact:true}).waitFor();assert.equal(await view.locator('.mail-review-list article').count(),1);assert.match(await nav.getAttribute('class'),/has-attention/);
  await view.getByRole('button',{name:'Mark handled'}).click();await view.getByText('Marked handled. Your email and tasks are unchanged.',{exact:true}).waitFor();assert.equal(await view.getByRole('button',{name:'Undo',exact:true}).count(),1);
  await page.clock.fastForward(10000);assert.equal(await view.getByRole('button',{name:'Undo',exact:true}).count(),0);assert.equal(await view.locator('.handled-mail-review').count(),0);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#mailAttentionView').textContent.includes('No suggestions need your review'));await page.evaluate(()=>window.page('attention'));assert.equal(await view.locator('.mail-review-list article').count(),0);assert.equal(await view.getByRole('button',{name:'Undo',exact:true}).count(),0);
  item.reviewKey='b'.repeat(64);saved.items=[item];saved.handledItems=[];await view.getByRole('button',{name:'Check recent mail'}).click();await view.locator('article').waitFor();
  failDecision=true;await view.getByRole('button',{name:'Mark handled'}).click();await view.getByText('Could not save that change. Refresh the review and try again.',{exact:true}).waitFor();assert.equal(await view.locator('.mail-review-list article').count(),1);assert.equal(mailWrites,0);assert.equal(taskWrites,0);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
