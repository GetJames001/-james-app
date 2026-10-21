const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
test('Attention saved view fits devices, retains items/focus on failure and clears on departure',async()=>{
 let mode='known',reads=0,writes=0;
 const data=()=>({schemaVersion:1,status:'available',revision:1,evaluatedAt:'2026-10-15T18:00:00Z',attentionItems:[{title:'Review '+ 'LongTitle'.repeat(30),deadlineStatus:'unknown',evidenceLinks:['https://example.test/source']}],sourceHealth:[{status:'stale',lastSuccessfulScanAt:null}],needsReview:[],coverage:[{label:'Synthetic bounded Inbox window',mailboxWide:false}]});
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')){
   if(req.method!=='GET')writes++;
   res.setHeader('content-type','application/json');
   if(u.pathname==='/api/attention'){
    reads++;if(mode==='failed'){res.statusCode=503;return res.end('{}');}
    if(mode==='missing')return res.end(JSON.stringify({schemaVersion:1,status:'not_checked',revision:0,attentionItems:[],sourceHealth:[],needsReview:[],coverage:[]}));
    if(mode==='malformed')return res.end(JSON.stringify({...data(),status:'not_checked',revision:2,attentionItems:[]}));
    return res.end(JSON.stringify(data()));
   }
   if(u.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   if(u.pathname==='/api/auth/session')return res.end('{"authenticated":true,"ok":true}');
   return res.end('{"connected":false}');
  }
  const file=path.join(__dirname,'..',u.pathname==='/'?'index.html':u.pathname.slice(1));
  try{res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('https://**',r=>r.abort());
  await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('nav [data-page="attention"]').click();await page.locator('#attentionView h2').waitFor();
  for(const width of [390,820,1180]){
   await page.setViewportSize({width,height:844});
   const size=await page.locator('#attentionView').evaluate(el=>({right:el.getBoundingClientRect().right,overflow:el.scrollWidth-el.clientWidth,buttons:[...el.querySelectorAll('button,a')].map(x=>x.getBoundingClientRect().height)}));
   assert.ok(size.right<=width+1);assert.ok(size.overflow<=1);assert.ok(size.buttons.every(h=>h>=44));
  }
  await page.evaluate(()=>{window.__focusHistory=[];document.addEventListener('focusin',e=>window.__focusHistory.push({t:'in',tag:e.target.tagName,text:e.target.textContent?.slice(0,35)}),true);document.addEventListener('focusout',e=>window.__focusHistory.push({t:'out',tag:e.target.tagName,text:e.target.textContent?.slice(0,35)}),true);});
  for(const next of ['failed','malformed']){
   mode=next;const button=page.getByRole('button',{name:'Refresh saved view'});await button.focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>document.querySelector('#attentionView [role=status]').textContent.includes('previously loaded'));
   assert.equal(await page.locator('#attentionView h2').count(),1);
   const debug=await page.evaluate(()=>({active:document.activeElement?.outerHTML?.slice(0,220),refresh:document.querySelector('#attentionView button')?.outerHTML?.slice(0,220),focused:document.activeElement===document.querySelector('#attentionView button'),events:window.__focusHistory?.slice(-15)}));
   console.log('ATTENTION_FOCUS_DIAGNOSTIC '+next+' '+JSON.stringify(debug));
   assert.equal(await page.getByRole('button',{name:'Refresh saved view'}).evaluate(el=>el===document.activeElement),true);
  }
  await page.locator('nav [data-page="briefing"]').click();assert.equal(await page.locator('#attentionView h2').count(),0);
  mode='missing';await page.locator('nav [data-page="attention"]').click();await page.waitForFunction(()=>document.querySelector('#attentionView').textContent.includes('Email coverage has not been established'));
  assert.match(await page.locator('#attentionView').textContent(),/Not checked yet/);assert.doesNotMatch(await page.locator('#attentionView').textContent(),/No known items/);
  assert.ok(reads>=4);assert.equal(writes,0);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
