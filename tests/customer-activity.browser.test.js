const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright');

function createFixtureServer(){
  const root=path.join(__dirname,'..');
  let mutations=0,externalCalls=0,fail=false,conflict=false,loseReply=false,expired=false,loseReplyCountdown=0;
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
      let body='';req.on('data',c=>body+=c);req.on('end',()=>activityHandler({method:req.method,body:body||undefined,headers:req.headers,query:{}},{setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(data){if(req.method==='POST'&&data.ok&&(loseReply||(loseReplyCountdown>0&&--loseReplyCountdown===0))){loseReply=false;res.statusCode=503;res.end('{}');return;}res.end(JSON.stringify(data));}}));return;
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
  return {server,counts:()=>({mutations,externalCalls}),fail:value=>fail=value,conflict:value=>conflict=value,loseReply:()=>loseReply=true,loseReplyAfter:n=>loseReplyCountdown=n,expire:()=>expired=true};
}

test('Customer Activity saves and reopens actual reports; retains drafts after failure/conflict',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:880}});
  await page.route('https://**',r=>r.abort());await page.addInitScript(()=>{sessionStorage.setItem('jamesIntroDate',new Date().toDateString());sessionStorage.setItem('jamesCustomerMode','saved');});
  await page.goto('http://127.0.0.1:'+h.server.address().port);
  await page.locator('#customerActivityOpen').click();
  await page.waitForFunction(()=>!document.getElementById('customerAdd').disabled);
  await page.locator('#customerNewName').fill('Fictional warehouse');await page.locator('#customerAdd').click();
  await page.waitForFunction(()=>document.getElementById('customerDemoName').textContent==='Fictional warehouse');
  await page.locator('#customerDemoOutcome').fill('Partial draft');await page.locator('#customerDemoKeepDraft').click();assert.match(await page.locator('#customerDraftStatus').textContent(),/Choose what happened/);
  await page.locator('#customerOutcomeKind').selectOption('attempted');await page.locator('#customerOccurredAt').fill('2026-10-20T10:00');await page.locator('#customerNextKind').selectOption('No follow-up needed');
  await page.locator('#customerDemoOutcome').fill('Left a card. Nobody available.');await page.locator('#customerNextKind').selectOption('Call');await page.locator('#customerNextDetailsText').fill('Call about proposal');await page.locator('#customerNextWhen').fill('2099-10-23T10:00');
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
  assert.match(await page.locator('#customerDemoHistory').textContent(),/Call/);
  assert.equal(await page.locator('#customerDemoVisited').textContent(),'No in-person meeting recorded');
  assert.match(await page.locator('#customerLastSummary').textContent(),/Left a card/);
  assert.match(await page.locator('#customerLastSummary').textContent(),/Call/);
  await page.locator('#customerViewHistory').click();
  assert.equal(await page.locator('#customerDemoHistory').evaluate(el=>document.activeElement===el),true);
  assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'');
  await page.locator('#customerOutcomeKind').selectOption('met');await page.locator('#customerOccurredAt').fill('2026-10-20T11:00');await page.locator('#customerNextKind').selectOption('No follow-up needed');
  await page.locator('#customerDemoOutcome').fill('Met the manager');h.loseReply();await page.locator('#customerDemoKeepDraft').click();
  await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Save not confirmed'));
  await page.locator('#customerReload').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Previous save confirmed'));
  assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'');
  assert.equal((await page.locator('#customerDemoHistory').textContent()).split('Met the manager').length-1,1);
  assert.equal(await page.locator('#customerDemoVisited').textContent(),'In-person meeting recorded');
  await page.locator('#customerActivityClose').click();h.expire();await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Session expired'));
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
    await page.addInitScript(()=>{sessionStorage.setItem('jamesIntroDate',new Date().toDateString());sessionStorage.setItem('jamesCustomerMode','saved');});
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
  await page.route('https://**',r=>r.abort());await page.addInitScript(()=>{sessionStorage.setItem('jamesIntroDate',new Date().toDateString());sessionStorage.setItem('jamesCustomerMode','saved');});
  await page.goto('http://127.0.0.1:'+h.server.address().port);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>!document.getElementById('customerAdd').disabled);
  await page.locator('#customerNewName').fill('Fictional Beacon');await page.locator('#customerAdd').click();await page.waitForFunction(()=>document.getElementById('customerDemoName').textContent==='Fictional Beacon');
  await page.locator('#companyAddress').fill('Fictional test location');
  for(const name of ['Alex Example','Jordan Example']){await page.locator('#companyAddContact').click();await page.locator('#companyContacts fieldset').last().getByLabel('Name',{exact:true}).fill(name);}
  h.loseReply();await page.locator('#companySave').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Save not confirmed'));
  await page.locator('#customerReload').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Previous save confirmed'));
  assert.equal(await page.locator('#companyContacts fieldset').count(),2);
  await page.locator('#activityContact').selectOption({label:'Jordan Example'});
  await page.locator('#customerOutcomeKind').selectOption('attempted');await page.locator('#customerOccurredAt').fill('2026-10-20T10:00');await page.locator('#customerNextKind').selectOption('No follow-up needed');await page.locator('#customerDemoOutcome').fill('Fictional attempt only');await page.locator('#customerNextKind').selectOption('Call');await page.locator('#customerNextDetailsText').fill('Call about proposal');await page.locator('#customerNextWhen').fill('2099-10-23T10:00');
  await page.locator('#customerDemoKeepDraft').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});
  await page.reload();await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.getElementById('customerDemoHistory').textContent.includes('Jordan Example'));
  assert.match(await page.locator('#customerLastSummary').textContent(),/Call/);assert.equal(await page.locator('#customerDemoVisited').textContent(),'No in-person meeting recorded');
  await page.locator('#companyEditor summary').click();assert.equal(await page.locator('#companyAddress').inputValue(),'Fictional test location');
  await page.locator('#companyName').fill('Fictional renamed company');h.fail(true);await page.locator('#companySave').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Save not confirmed'));
  h.fail(false);await page.locator('#customerReload').click();await page.waitForFunction(()=>!document.getElementById('companySave').disabled);
  assert.doesNotMatch(await page.locator('#customerDraftStatus').textContent(),/Previous save confirmed/);assert.equal(await page.locator('#companyName').inputValue(),'Fictional renamed company');
  await page.locator('#companySave').click();await page.waitForFunction(()=>document.getElementById('customerDemoName').textContent==='Fictional renamed company');assert.match(await page.locator('#customerDemoHistory').textContent(),/Jordan Example/);
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});

test('Close protects drafts; one save persists company edits and activity, refreshes history, and avoids empty records',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.route('https://**',r=>r.abort());await page.addInitScript(()=>{sessionStorage.setItem('jamesIntroDate',new Date().toDateString());sessionStorage.setItem('jamesCustomerMode','saved');});
  await page.goto('http://127.0.0.1:'+h.server.address().port);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>!document.getElementById('customerAdd').disabled);
  await page.locator('#customerNewName').fill('Fictional Close Test');await page.locator('#customerAdd').click();await page.waitForFunction(()=>document.getElementById('customerDemoName').textContent==='Fictional Close Test');
  assert.equal(await page.locator('#customerReload').isVisible(),false);
  assert.equal(await page.locator('#customerDemoDone').count(),0);assert.equal(await page.locator('#customerDemoNext').count(),0);
  await page.locator('#companyPhone').fill('555-0100');await page.locator('#customerDemoOutcome').fill('Draft requiring an outcome');
  const before=h.counts().mutations;
  await page.locator('#customerActivityClose').click();await page.locator('#customerClosePrompt').waitFor();
  assert.equal(await page.locator('#customerCloseSave').evaluate(el=>el===document.activeElement),true);
  await page.locator('#customerKeepEditing').click();assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'Draft requiring an outcome');
  await page.locator('#customerDemoKeepDraft').click();assert.equal(h.counts().mutations,before,'validate the activity before saving company changes');
  await page.locator('#customerOutcomeKind').selectOption('attempted');await page.locator('#customerOccurredAt').fill('2026-10-20T12:00');await page.locator('#customerNextKind').selectOption('No follow-up needed');
  await page.locator('#customerActivityClose').click();await page.locator('#customerCloseSave').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});
  assert.equal(h.counts().mutations,before+2);
  await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.getElementById('customerDemoHistory').textContent.includes('Draft requiring an outcome'));
  assert.equal(await page.locator('#companyPhone').inputValue(),'555-0100');assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'');
  const after=h.counts().mutations;await page.locator('#customerDemoKeepDraft').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});assert.equal(h.counts().mutations,after,'empty save must not invent an activity');
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});

test('A lost second acknowledgment retains pending work and reconciles without repeating the confirmed company write',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.route('https://**',r=>r.abort());await page.addInitScript(()=>{sessionStorage.setItem('jamesIntroDate',new Date().toDateString());sessionStorage.setItem('jamesCustomerMode','saved');});
  await page.goto('http://127.0.0.1:'+h.server.address().port);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>!document.getElementById('customerAdd').disabled);
  await page.locator('#customerNewName').fill('Fictional Partial Save');await page.locator('#customerAdd').click();await page.waitForFunction(()=>document.getElementById('customerDemoName').textContent==='Fictional Partial Save');
  await page.locator('#companyPhone').fill('555-0123');await page.locator('#customerOutcomeKind').selectOption('attempted');await page.locator('#customerOccurredAt').fill('2026-10-20T12:00');await page.locator('#customerNextKind').selectOption('No follow-up needed');await page.locator('#customerDemoOutcome').fill('One reported attempt');
  const before=h.counts().mutations;h.loseReplyAfter(2);await page.locator('#customerDemoKeepDraft').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Save not confirmed'));
  assert.equal(await page.locator('#customerActivityOverlay').isVisible(),true);assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'One reported attempt');
  assert.equal(await page.locator('#customerDemoKeepDraft').isEnabled(),false);
  await page.locator('#customerReload').click();await page.waitForFunction(()=>document.getElementById('customerDraftStatus').textContent.includes('Previous save confirmed'));
  assert.equal(await page.locator('#customerReload').isVisible(),false);assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'');
  assert.equal((await page.locator('#customerDemoHistory').textContent()).split('One reported attempt').length-1,1);
  await page.locator('#customerDemoKeepDraft').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});assert.equal(h.counts().mutations,before+2);
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});

test('Save and return includes drafts from more than one company',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.route('https://**',r=>r.abort());await page.addInitScript(()=>{sessionStorage.setItem('jamesIntroDate',new Date().toDateString());sessionStorage.setItem('jamesCustomerMode','saved');});
  await page.goto('http://127.0.0.1:'+h.server.address().port);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>!document.getElementById('customerAdd').disabled);
  for(const name of ['Fictional Alpha','Fictional Beta']){await page.locator('#customerNewName').fill(name);await page.locator('#customerAdd').click();await page.waitForFunction(name=>document.getElementById('customerDemoName').textContent===name,name);}
  for(const [name,note] of [['Fictional Alpha','First attempted visit'],['Fictional Beta','Second attempted visit']]){
   await page.locator('#customerDemoList').getByRole('button',{name,exact:true}).click();await page.locator('#companyPhone').fill('555-0199');await page.locator('#customerOutcomeKind').selectOption('attempted');await page.locator('#customerOccurredAt').fill('2026-10-20T12:00');await page.locator('#customerNextKind').selectOption('No follow-up needed');await page.locator('#customerDemoOutcome').fill(note);
  }
  const before=h.counts().mutations;await page.locator('#customerDemoKeepDraft').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});assert.equal(h.counts().mutations,before+4);
  await page.reload();await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>!document.getElementById('customerDemoKeepDraft').disabled);
  for(const [name,note] of [['Fictional Alpha','First attempted visit'],['Fictional Beta','Second attempted visit']]){
   await page.locator('#customerDemoList').getByRole('button',{name,exact:true}).click();assert.match(await page.locator('#customerDemoHistory').textContent(),new RegExp(note));assert.equal(await page.locator('#companyPhone').inputValue(),'555-0199');assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'');
  }
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});

test('Five-company practice template explains fields, saves only locally and leaves saved records unchanged',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:820,height:1000}});let customerRequests=0;
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/customer-activity')customerRequests++;});
  await page.route('https://**',r=>r.abort());await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
  await page.goto('http://127.0.0.1:'+h.server.address().port);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.querySelectorAll('#customerDemoList button').length===5);
  assert.equal(customerRequests,0);assert.match(await page.locator('#customerModeNotice').textContent(),/fictional.*until reload/);
  await page.locator('#companyEditor summary').click();assert.equal(await page.locator('#companyContacts fieldset').count(),2);
  assert.equal(await page.locator('#companyNameHelp').count(),0);assert.equal(await page.locator('#customerOutcomeKindHelp').count(),0);assert.equal(await page.locator('.customer-guide').count(),1);
  for(const [name,note] of [['Silver Mesa Facilities','Practice attempt only'],['Desert Willow Hospitality','Practice second attempt']]){
   await page.locator('#customerDemoList').getByRole('button',{name,exact:true}).click();await page.locator('#customerOutcomeKind').selectOption('attempted');await page.locator('#customerOccurredAt').fill('2026-10-20T12:00');await page.locator('#customerNextKind').selectOption('No follow-up needed');await page.locator('#customerDemoOutcome').fill(note);
  }
  await page.locator('#customerActivityClose').click();assert.equal(await page.locator('#customerClosePrompt').isVisible(),true);await page.locator('#customerCloseSave').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});
  assert.match(await page.locator('#customerSaveNotice').textContent(),/Practice.*tab only/);assert.equal(customerRequests,0);assert.equal(h.counts().mutations,0);
  await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.getElementById('customerDemoHistory').textContent.includes('Practice second attempt'));
  await page.locator('#customerModeSwitch').click();await page.waitForFunction(()=>document.getElementById('customerModeNotice').textContent.startsWith('Your saved'));
  assert.equal(await page.locator('#customerDemoList button').count(),0);assert.equal(h.counts().mutations,0);assert.equal(customerRequests,1);
  await page.locator('#customerModeSwitch').click();await page.waitForFunction(()=>document.querySelectorAll('#customerDemoList button').length===5);
  await page.reload();await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.querySelectorAll('#customerDemoList button').length===5);assert.doesNotMatch(await page.locator('#customerDemoHistory').textContent(),/Practice.*attempt/);
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});

test('Top save-and-close detects company autofill and activity values without input events',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.route('https://**',r=>r.abort());await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
  await page.goto('http://127.0.0.1:'+h.server.address().port);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.querySelectorAll('#customerDemoList button').length===5);
  await page.evaluate(()=>{document.getElementById('companyPhone').value='702-555-0198';});
  await page.locator('#customerActivityClose').click();assert.equal(await page.locator('#customerClosePrompt').isVisible(),true);await page.locator('#customerKeepEditing').click();assert.equal(await page.locator('#companyPhone').inputValue(),'702-555-0198');
  await page.evaluate(()=>{document.getElementById('customerNextKind').value='No follow-up needed';document.getElementById('customerOutcomeKind').value='attempted';document.getElementById('customerOccurredAt').value='2026-10-20T12:00';document.getElementById('customerDemoOutcome').value='Dictation fixture';});
  await page.locator('#customerActivityClose').click();await page.locator('#customerCloseSave').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});
  await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.getElementById('customerDemoHistory').textContent.includes('Dictation fixture'));assert.equal(await page.locator('#companyPhone').inputValue(),'702-555-0198');assert.equal(h.counts().mutations,0);
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});

test('Follow-up requires a commitment, preserves date/time, and exposes explicit contact actions',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.route('https://**',r=>r.abort());await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
  await page.goto('http://127.0.0.1:'+h.server.address().port);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.querySelectorAll('#customerDemoList button').length===5);
  assert.equal(await page.locator('#customerLastSummary').isVisible(),false);
  await page.locator('#customerOutcomeKind').selectOption('attempted');await page.locator('#customerOccurredAt').fill('2026-10-20T12:00');
  await page.locator('#customerDemoKeepDraft').click();assert.match(await page.locator('#customerDraftStatus').textContent(),/Choose a next step/);
  await page.locator('#customerNextKind').selectOption('Email');await page.locator('#customerDemoKeepDraft').click();assert.match(await page.locator('#customerDraftStatus').textContent(),/future date and time/);
  assert.equal(await page.locator('#customerNextOpen').isVisible(),true);assert.match(await page.locator('#customerNextOpen').getAttribute('href'),/^mailto:\?subject=/);
  await page.locator('#activityContact').selectOption({label:'Alex Example'});assert.match(await page.locator('#customerNextOpen').getAttribute('href'),/^mailto:/);
  await page.locator('#customerNextDetailsText').fill('Send the requested proposal');await page.locator('#customerNextWhen').fill('2099-10-23T10:00');
  await page.locator('#customerDemoKeepDraft').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});
  await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.getElementById('customerLastSummary').textContent.includes('Pending: Email'));
  assert.match(await page.locator('#customerLastSummary').textContent(),/2099/);assert.match(await page.locator('#customerLastSummary').textContent(),/Send the requested proposal/);assert.equal(h.counts().mutations,0);
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});

test('saved reminders become due automatically, survive refresh failure, reschedule, and reconcile completion without repeat writes',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  const base='http://127.0.0.1:'+h.server.address().port;
  const post=body=>fetch(base+'/api/customer-activity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
  await post({type:'upsert_customer',expectedRevision:0,customer:{id:'reminder-c',name:'Fictional Reminder Company',contacts:[{id:'reminder-person',name:'Alex Example',email:'alex@example.com',phone:'702-555-0199'}]}});
  const past=new Date(Date.now()-60000).toISOString(),future=new Date(Date.now()+60000).toISOString();
  await post({type:'record_activity',expectedRevision:1,activity:{id:'reminder-past',customerId:'reminder-c',contactId:'reminder-person',contactName:'Alex Example',occurredAt:'2026-10-20T10:00:00.000Z',outcome:'attempted',nextAction:'Email',nextActionDetails:'Send requested material',nextActionAt:past}});
  await post({type:'record_activity',expectedRevision:2,activity:{id:'reminder-future',customerId:'reminder-c',occurredAt:'2026-10-20T10:00:00.000Z',outcome:'attempted',nextAction:'Other',nextActionDetails:'Prepare flowers',nextActionAt:future}});
  browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.route('https://**',r=>r.abort());await page.addInitScript(()=>{sessionStorage.setItem('jamesIntroDate',new Date().toDateString());sessionStorage.setItem('jamesCustomerMode','saved');});
  await page.goto(base);await page.waitForFunction(()=>document.getElementById('customerReminderSummary').textContent.includes('1 due'));
  await page.locator('#customerReminderSummary').click();assert.equal(await page.locator('.customer-reminder-item').count(),2);
  const row=page.locator('[data-follow-up-id="reminder-past"]');assert.match(await row.getByRole('link',{name:'Open email draft'}).getAttribute('href'),/^mailto:alex%40example.com\?subject=/);
  const futureRow=page.locator('[data-follow-up-id="reminder-future"]');await futureRow.getByText('Complete or reschedule',{exact:true}).click();await futureRow.getByLabel('New reminder date and time').fill('2099-11-01T11:15');
  await page.evaluate(()=>{window.actualReminderNow=Date.now;Date.now=()=>window.actualReminderNow()+120000;});
  await page.waitForFunction(()=>document.getElementById('customerReminderSummary').textContent.includes('2 due'),{timeout:15000});
  assert.equal(await futureRow.getByLabel('New reminder date and time').inputValue(),'2099-11-01T11:15');assert.equal(await futureRow.locator('details').evaluate(el=>el.open),true);assert.match(await page.locator('#customerReminderAlert').textContent(),/2 customer follow-ups are due/);
  await page.evaluate(()=>{Date.now=window.actualReminderNow;});
  h.fail(true);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.getElementById('customerReminderStatus').textContent.includes('Could not refresh'));assert.equal(await page.locator('.customer-reminder-item').count(),2);
  h.fail(false);await page.locator('#customerReload').click();await page.waitForFunction(()=>!document.getElementById('customerDemoKeepDraft').disabled);await page.locator('#customerActivityClose').click();
  await row.getByText('Complete or reschedule',{exact:true}).click();await row.getByLabel('New reminder date and time').fill('2099-10-24T10:00');await row.getByRole('button',{name:'Save reminder time'}).click();await page.waitForFunction(()=>document.querySelector('[data-follow-up-id="reminder-past"] h4').textContent.startsWith('Upcoming'));
  assert.equal(await row.locator('details').evaluate(el=>el.open),true,'rescheduling keeps recovery controls open');const before=h.counts().mutations;h.loseReply();await row.getByRole('button',{name:'Confirm follow-up completed'}).click();await page.waitForFunction(()=>document.getElementById('customerReminderStatus').textContent.includes('not confirmed'));
  assert.equal(await row.count(),1,'unknown acknowledgment must retain reminder');
  await page.locator('#customerReminderRetry').click();await page.waitForFunction(()=>!document.querySelector('[data-follow-up-id="reminder-past"]'));
  assert.equal(h.counts().mutations,before+1,'readback must not repeat completion');await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.customer-reminder-item').length===1);
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});

test('email composer supports a blank or saved recipient and 30-minute, hour and custom time choices',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.route('https://**',r=>r.abort());await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));await page.goto('http://127.0.0.1:'+h.server.address().port);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.querySelectorAll('#customerDemoList button').length===5);
  await page.locator('#customerNextKind').selectOption('Email');assert.match(await page.locator('#customerNextOpen').getAttribute('href'),/^mailto:\?subject=/);assert.equal(await page.locator('#customerAddEmail').count(),0);
  await page.locator('#activityContact').selectOption({label:'Alex Example'});assert.match(await page.locator('#customerNextOpen').getAttribute('href'),/^mailto:contact0%40example.com/);assert.equal(await page.locator('#customerNextOpenHelp').textContent(),'To: contact0@example.com');
  await page.getByRole('button',{name:'30 minutes',exact:true}).click();let value=await page.locator('#customerNextWhen').inputValue();assert.match(value,/T\d{2}:\d{2}$/);assert.ok(new Date(value)>new Date());
  await page.getByRole('button',{name:'1 hour',exact:true}).click();assert.ok(new Date(await page.locator('#customerNextWhen').inputValue())-new Date(value)>=29*60000);
  await page.getByRole('button',{name:'Custom date/time',exact:true}).click();assert.equal(await page.locator('#customerNextWhen').evaluate(el=>el===document.activeElement),true);assert.equal(h.counts().mutations,0);
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});

test('Exit keeps incomplete company and activity drafts without validation or writes',async()=>{
 const h=createFixtureServer();await new Promise(r=>h.server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.route('https://**',r=>r.abort());await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));await page.goto('http://127.0.0.1:'+h.server.address().port);await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>document.querySelectorAll('#customerDemoList button').length===5);
  await page.locator('#companyEditor summary').click();await page.locator('#companyName').fill('');await page.locator('#customerDemoOutcome').fill('Unfinished note');await page.locator('#customerActivityClose').click();await page.locator('#customerExitDraft').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});assert.equal(h.counts().mutations,0);assert.match(await page.locator('#customerSaveNotice').textContent(),/Not saved/);
  await page.locator('#customerActivityOpen').click();await page.waitForFunction(()=>!document.getElementById('customerDemoKeepDraft').disabled);assert.equal(await page.locator('#companyName').inputValue(),'');assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'Unfinished note');await page.locator('#customerDemoKeepDraft').click();assert.equal(await page.locator('#customerActivityOverlay').isVisible(),true);assert.match(await page.locator('#customerDraftStatus').textContent(),/company name/);
  await page.locator('#customerActivityClose').click();await page.locator('#customerExitDraft').click();await page.locator('#customerActivityOverlay').waitFor({state:'hidden'});assert.equal(h.counts().mutations,0);
 }finally{await browser?.close();h.server.closeAllConnections();await new Promise(r=>h.server.close(r));}
});
