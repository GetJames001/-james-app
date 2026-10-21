const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright');

function createFixtureServer(){
  const root=path.join(__dirname,'..');
  let mutations=0,externalCalls=0;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(!['GET','HEAD'].includes(req.method))mutations++;
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
  return {server,counts:()=>({mutations,externalCalls})};
}

test('Customer Activity opens over unchanged briefing; keeps demo notes on close and rejects real saves',async()=>{
  const h=createFixtureServer();
  await new Promise(resolve=>h.server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1024,height:880}});
    await page.route('https://**',route=>route.abort());
    await page.addInitScript(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
    await page.goto('http://127.0.0.1:'+h.server.address().port);
    await page.locator('#customerActivityOpen').waitFor();
    assert.equal(await page.locator('#customerActivityOverlay').isVisible(),false);
    assert.equal(await page.locator('#briefing').evaluate(el=>el.classList.contains('active')),true);
    const before=await page.locator('#calendar').boundingBox();
    await page.locator('#customerActivityOpen').click();
    assert.equal(await page.locator('#customerActivityOverlay').isVisible(),true);
    assert.equal(await page.locator('#customerActivityOverlay').getAttribute('role'),'dialog');
    assert.match(await page.locator('.customer-demo-note').textContent(),/fictional customers/i);
    assert.equal(await page.locator('#customerDemoList button').count(),5);
    assert.equal(await page.locator('#customerDemoVisited').textContent(),'Not yet visited');
    await page.locator('#customerDemoOutcome').fill('Left sample card; call fictional contact Thursday');
    await page.locator('#customerDemoNext').fill('Review on Thursday');
    await page.locator('#customerDemoKeepDraft').click();
    assert.match(await page.locator('#customerDraftStatus').textContent(),/not saved to James/i);
    await page.locator('#customerDemoList button').nth(1).click();
    assert.equal(await page.locator('#customerDemoVisited').textContent(),'Previously visited');
    await page.locator('#customerDemoList button').first().click();
    assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'Left sample card; call fictional contact Thursday');
    assert.equal(await page.locator('#customerDemoNext').inputValue(),'Review on Thursday');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#customerActivityOverlay').isVisible(),false);
    assert.equal(await page.locator('#customerActivityOpen').evaluate(el=>document.activeElement===el),true);
    await page.locator('#customerActivityOpen').click();
    assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'Left sample card; call fictional contact Thursday');
    await page.locator('#customerDemoDone').click();
    const after=await page.locator('#calendar').boundingBox();
    assert.equal(await page.locator('#briefing').evaluate(el=>el.classList.contains('active')),true);
    assert.equal(after?.width,before?.width,'existing briefing calendar width should remain unchanged');
    assert.deepEqual(h.counts(),{mutations:0,externalCalls:0});
    await page.reload();
    await page.locator('#customerActivityOpen').click();
    assert.equal(await page.locator('#customerDemoOutcome').inputValue(),'','demo drafts are scoped to tab page lifetime');
  }finally{await browser?.close();h.server.closeAllConnections();await new Promise(resolve=>h.server.close(resolve));}
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
