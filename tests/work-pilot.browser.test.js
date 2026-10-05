const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');

test('work pilot import review, backup restore and logout remain isolated at iPad width', async () => {
  const server = http.createServer((req,res) => {
    const url = new URL(req.url, 'http://localhost');
    if(url.pathname.startsWith('/api/')) {
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({ok:true,connected:false,tasks:[],events:[]})); return;
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(root, relative);
    if(!file.startsWith(root + path.sep) || !fs.existsSync(file)) {res.writeHead(404);res.end();return;}
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.csv':'text/csv','.png':'image/png'};
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'text/plain'});res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:820,height:1180}});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    const mutations=[]; page.on('request', r=>{if(r.url().includes('/api/') && r.method()!=='GET') mutations.push(new URL(r.url()).pathname);});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(()=>{document.querySelector('#intro')?.classList.add('hide');document.querySelector('#app')?.classList.remove('frosted');document.querySelector('#app')?.classList.add('clear');});
    await page.locator('button[data-page="workPilot"]').click();
    await page.locator('#pilotFixture').click();
    await page.locator('#pilotCommit').waitFor();
    assert.equal(await page.locator('#pilotRecords article').count(),0);
    await page.locator('#pilotCommit').click();
    assert.ok(await page.locator('#pilotRecords article').count()>=6);
    const count=await page.locator('#pilotRecords article').count();
    await page.locator('#pilotFixture').click();
    await page.locator('#pilotCommit').click();
    assert.equal(await page.locator('#pilotRecords article').count(),count);
    const changed=fs.readFileSync(path.join(root,'assets/workday-pilot-synthetic.csv'),'utf8').replace('Review renewal follow-up', 'Review changed renewal follow-up');
    // A source conflict needs a field comparison and explicit decision.
    await page.locator('#pilotCSV').setInputFiles({name:'changed.csv',mimeType:'text/csv',buffer:Buffer.from(changed)});
    await page.locator('#pilotCommit').waitFor();
    const conflicts=await page.locator('#pilotPreview select').count();
    assert.equal(conflicts,1);
    assert.equal(await page.locator('#pilotCommit').isDisabled(),true);
    assert.match(await page.locator('#pilotPreview').innerText(),/existing Review renewal follow-up/);
    for(const select of await page.locator('#pilotPreview select').all()) await select.selectOption('keep');
    await page.locator('#pilotCommit').click();
    const backup=await page.evaluate(()=>window.JamesWorkPilotUI.exportJSON());
    await page.locator('#pilotRestore').setInputFiles({name:'pilot.json',mimeType:'application/json',buffer:Buffer.from(backup)});
    await page.locator('#pilotRestoreCommit').waitFor();
    await page.locator('#pilotRestoreCommit').click();
    assert.equal(await page.locator('#pilotRecords article').count(),count);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.setViewportSize({width:1180,height:820});
    await page.locator('button[data-page="briefing"]').click();
    await page.locator('button[data-page="workPilot"]').click();
    assert.equal(await page.locator('#pilotRecords article').count(),count);
    page.once('dialog', d=>d.accept());
    await page.locator('#pilotClear').click();
    assert.equal(await page.locator('#pilotRecords article').count(),0);
    await page.locator('#pilotFixture').click();await page.locator('#pilotCommit').click();
    const logoutEmpty=await page.evaluate(()=>{document.querySelector('#logoutButton').click();return JSON.parse(window.JamesWorkPilotUI.exportJSON()).records.length;});
    assert.equal(logoutEmpty,0);
    await page.waitForURL('**/login');
    assert.deepEqual(mutations,['/api/auth/logout']);
    assert.deepEqual(errors,[]);
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
