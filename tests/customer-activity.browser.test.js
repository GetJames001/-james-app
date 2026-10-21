const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright');

function createFixtureServer(){
  const root=path.join(__dirname,'..');
  let mutations=0,externalCalls=0,fail=false,conflict=false,loseReply=false,expired=false;
  const {makeStore}=require('../lib/customer-activity/records.cjs');
  const {createHandler}=require('../lib/routes/customer-activity.js');
  const backing=new Map();
  const store=makeStore({read:async k=>backing.get(k)??null,compareAndSwap:async(k,old,next)=>{if((backing.get(k)??null)!==old)return false;backing.set(k,next);return true;}});
  const activityHandler=createHandler({store,authorize:()=>true,identity:()=> 'fictional-browser-test'});
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(!['GET','HEAD'].includes(req.method))mutations++;
    if(url.pathname==='/api/customer-activity'){
      res.setHeader('Content-Type','application/json');
      if(expired){res.statusCode=401;return res.end('{}');}
      if(fail){res.statusCode=503;return res.end('{}');}
      if(conflict&&req.method==='POST'){res.statusCode=409;return res.end('{}');}
      let body='';req.on('data',c=>body+=c);req.on('end',()=>activityHandler({method:req.method,body:body||undefined,headers:req.headers,query:{}},{setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(data){if(loseReply&&req.method==='POST'&&data.ok){loseReply=false;res.statusCode=503;res.end('{}');return;}res.end(JSON.stringify(data));}}));return;
    }
    if(url.pathname.startsWith('/api/')){
      res.setHeader('Content-Type','application/json');
      if(url.pathname==='/api/google/events')return res.end(JSON.stringify({connected:true,complete:true,partial:false,fetchedAt:new Date().toISOString(),calendars:[],completedCalendarIds:[],events:[]}));
      if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
      if(url.pathname==='/api/attention')return res.end('{"schemaVersion":1,"status":"not_checked","attentionItems":[],"sourceHealth":[],"needsReview":[],"coverage":[]}');
      if(url.pathname==='/api/microsoft/mail')return res.end('{"connected":false,"unreadCount":null,"messages":[]}');
      return res.end('{}');
    }
    const filename=path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
    if(!filename.startsWith(root)) {res.statusCode=404;return res.end();}
    try{
      res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');
      return res.end(fs.readFileSync(filename));
    }catch{res.statusCode=404;return res.end();}
  });
  return {server,counts:()=>({mutations,externalCalls}),fail:value=>fail=value,conflict:value=>conflict=value,loseReply:()=>loseReply=true,expire:()=>expired=true};
}

test('Customer Activity saves and reopens actual reports; retains drafts after failure/conflict',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:880}});
  await page.route('https://**',r=>r.abort());await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
  await page.goto('http://127.0.0.1:'+h.server.address().port);
  await page.locator('#customerActivityOpen').click();
  await page.waitForFunction(()=>!document.getElementById('customerAdd').disabled);
  await page.locator('#customerNewName').fill('Fictional warehouse');await page.locator('#customerAdd').click();
  await page.waitForFunction(()=>document.getElementById('customerDemoName').textContent==='Fictional warehouse');
  await page.locator('#customerDemoKeepDraft').click();assert.match(await page.locator('#customerDraftStatus').textContent(),/Choose what happened/);
  await page.locator('#customerOutcomeKind').selectOption('attempted');await page.locator('#customerOccurredAt').fill('2026-10-20T10:00');
  await page.locator('#customerDemoOutcome').fill('Left a card. Nobody available.');await page.locator('#customerDemoNext').fill('Call Thursday');
  h.fail(true);await page.locator('#customerDemoKeepDraft').click();
  await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Save not confirmed'));
  assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'Left a card. Nobody available.');
  h.fail(false);await page.locator('#customerReload').click();await page.waitForFunction(()=>!document.getElementById('customerDemoKeepDraft').disabled);
  h.conflict(true);await page.locator('#customerDemoKeepDraft').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Another update'));
  h.conflict(false);await page.locator('#customerReload').click();await page.waitForFunction(()=>!document.getElementById('customerDemoKeepDraft').disabled);
  await page.locator('#customerDemoKeepDraft').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});
  assert.equal(await page.locator('#briefing').evaluate(el=>el.classList.contains('active')),true);
  await page.reload();await page.locator('#customerActivityOpen').click();
  await page.waitForFunction(()=>document.getElementById('customerDemoHistory').textContent.includes('Left a card'));
  assert.match(await page.locator('#customerDemoHistory').textContent(),/Attempted visit/);
  assert.match(await page.locator('#customerDemoHistory').textContent(),/Call Thursday/);
  assert.equal(await page.locator('#customerDemoVisited').textContent(),'No meeting recorded');
  assert.match(await page.locator('#customerLastSummary').textContent(),/Left a card/);
  assert.match(await page.locator('#customerLastSummary').textContent(),/Call Thursday/);
  await page.locator('#customerViewHistory').click();
  assert.equal(await page.locator('#customerDemoHistory').evaluate(el=>document.activeElement===el),true);
  assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'');
  await page.locator('#customerOutcomeKind').selectOption('met');await page.locator('#customerOccurredAt').fill('2026-10-20T11:00');
  await page.locator('#customerDemoOutcome').fill('Met the manager');h.loseReply();await page.locator('#customerDemoKeepDraft').click();
  await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Save not confirmed'));
  await page.locator('#customerReload').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Previous save confirmed'));
  assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'');
  assert.equal((await page.locator('#customerDemoHistory').textContent()).split('Met the manager').length-1,1);
  assert.equal(await page.locator('#customerDemoVisited').textContent(),'Meeting recorded');
  h.expire();await page.locator('#customerReload').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Session expired'));
  assert.equal(await page.locator('#customerDemoList button').count(),0);
  assert.doesNotMatch(await page.locator('#customerDemoHistory').textContent(),/Met the manager/);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#customerActivityOpen').evaluate(el=>document.activeElement===el),true);
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});

test('Customer Activity is usable at phone and tablet widths with no horizontal overflow',async()=>{
  const h=createFixtureServer();await new Promise(resolve=>h.server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:390,height:740}});
    await page.route('https://**',route=>route.abort());
    await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
    await page.goto('http://127.0.0.1:'+h.server.address().port);
    for(const width of [320,390,820,1280]){
      await page.setViewportSize({width,height:800});
      await page.locator('#customerActivityOpen').click();
      assert.equal(await page.locator('#customerActivityOverlay').isVisible(),true);
      const measures=await page.evaluate(()=>{
        const workspace=document.querySelector('.customer-workspace');
        const r=workspace.getBoundingClientRect();
        return {left:r.left,right:r.right,windowWidth:innerWidth};
      });
      assert.ok(measures.left>=-1,JSON.stringify(measures));
      assert.ok(measures.right<=measures.windowWidth+1,JSON.stringify(measures));
      assert.equal(await page.locator('#customerActivityClose').isVisible(),true);
      await page.locator('#customerActivityClose').click();
      assert.equal(await page.locator('#customerActivityOverlay').isVisible(),false);
    }
    assert.deepEqual(h.counts(),{mutations:0,externalCalls:0});
  }finally{await browser?.close();h.server.closeAllConnections();await new Promise(resolve=>h.server.close(resolve));}
});

test('Company contacts persist, activity keeps contact identity, and uncertain edits reconcile',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.route('https://**',r=>r.abort());await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
  await page.goto('http://127.0.0.1:'+h.server.address().port);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>!document.getElementById('customerAdd').disabled);
  await page.locator('#customerNewName').fill('Fictional Beacon');await page.locator('#customerAdd').click();await page.waitForFunction(()=>document.getElementById('customerDemoName').textContent==='Fictional Beacon');
  await page.locator('#companyAddress').fill('Fictional test location');
  for(const name of ['Alex Example','Jordan Example']){await page.locator('#companyAddContact').click();await page.locator('#companyContacts fieldset').last().getByLabel('Name',{exact:true}).fill(name);}
  h.loseReply();await page.locator('#companySave').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Save not confirmed'));
  await page.locator('#customerReload').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Previous save confirmed'));
  assert.equal(await page.locator('#companyContacts fieldset').count(),2);
  await page.locator('#activityContact').selectOption({label:'Jordan Example'});
  await page.locator('#customerOutcomeKind').selectOption('attempted');await page.locator('#customerOccurredAt').fill('2026-10-20T10:00');await page.locator('#customerDemoOutcome').fill('Fictional attempt only');await page.locator('#customerNextKind').selectOption('Call');await page.locator('#customerDemoNext').fill('Tuesday');
  await page.locator('#customerDemoKeepDraft').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});
  await page.reload();await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.getElementById('customerDemoHistory').textContent.includes('Jordan Example'));
  assert.match(await page.locator('#customerLastSummary').textContent(),/Call: Tuesday/);assert.equal(await page.locator('#customerDemoVisited').textContent(),'No meeting recorded');
  await page.locator('#companyEditor summary').click();assert.equal(await page.locator('#companyAddress').inputValue(),'Fictional test location');
  await page.locator('#companyName').fill('Fictional renamed company');h.fail(true);await page.locator('#companySave').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Save not confirmed'));
  h.fail(false);await page.locator('#customerReload').click();await page.waitForFunction(()=>!document.getElementById('companySave').disabled);
  assert.doesNotMatch(await page.locator('#customerDraftStatus').textContent(),/Previous save confirmed/);assert.equal(await page.locator('#companyName').inputValue(),'Fictional renamed company');
  await page.locator('#companySave').click();await page.waitForFunction(()=>document.getElementById('customerDemoName').textContent==='Fictional renamed company');assert.match(await page.locator('#customerDemoHistory').textContent(),/Jordan Example/);
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});
