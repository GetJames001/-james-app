const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
test('task deletion persists, undo preserves records, failures roll back and concurrent writes are blocked',async()=>{
  const original=[{id:'test',title:'Synthetic test',domain:'work',status:'completed',createdAt:'2026-01-01',extra:'preserve'},{id:'real',title:'Synthetic real task',domain:'personal',status:'open'}];
  let records=structuredClone(original),fail=false,hold=false,release,posts=0;
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      res.setHeader('content-type','application/json');
      if(url.pathname==='/api/tasks'){
        if(req.method==='POST'){
          posts++;let body='';for await(const chunk of req)body+=chunk;
          if(hold)await new Promise(resolve=>release=resolve);
          if(fail){res.statusCode=503;return res.end('{}');}
          records=JSON.parse(body).tasks;
        }
        return res.end(JSON.stringify({tasks:records}));
      }
      if(url.pathname==='/api/auth/session')return res.end('{"authenticated":true,"ok":true}');
      return res.end('{"connected":false,"messages":[],"unreadCount":0}');
    }
    const filename=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));
    try{res.setHeader('content-type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(filename));}catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.route('https://**',r=>r.abort());const address=`http://127.0.0.1:${server.address().port}`;
    async function open(){await page.goto(address);await page.waitForFunction(()=>document.querySelectorAll('.task-row').length===2);await page.evaluate(()=>{document.querySelectorAll('.intro,.intro-overlay').forEach(el=>el.remove());document.querySelector('[data-page=tasks]').click();document.body.classList.remove('frosted');});}
    await open();
    const row=id=>page.locator(`[data-task-id="${id}"]`);
    await row('test').locator('summary').click();await row('test').getByRole('button',{name:'Delete task'}).click();
    await page.getByText('Task deleted.',{exact:false}).waitFor();assert.deepEqual(records,[original[1]]);
    await page.locator('#taskUndoButton').click();await page.getByText('Task restored.',{exact:true}).waitFor();assert.deepEqual(records,original);
    fail=true;await row('test').locator('summary').click();await row('test').getByRole('button',{name:'Delete task'}).click();
    await page.getByText('Could not save the change.',{exact:false}).waitFor();assert.equal(await page.locator('.task-row').count(),2);assert.deepEqual(records,original);
    fail=false;hold=true;const before=posts;
    await row('test').locator('summary').click();await row('test').getByRole('button',{name:'Delete task'}).click();
    await page.waitForFunction(()=>document.querySelector('#taskAddButton').disabled);
    assert.equal(await row('real').locator('input').isDisabled(),true);
    while(!release)await new Promise(resolve=>setImmediate(resolve));release();hold=false;
    await page.getByText('Task deleted.',{exact:false}).waitFor();assert.equal(posts,before+1);assert.deepEqual(records,[original[1]]);
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.task-row').length===1);
    assert.equal(await row('test').count(),0);assert.deepEqual(records,[original[1]]);
    assert.equal(await page.locator('#taskUndoButton').isHidden(),true);
  }finally{if(release)release();await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
