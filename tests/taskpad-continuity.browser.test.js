const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const revision=records=>createHash('sha256').update(JSON.stringify(records)).digest('hex');

test('Task Pad preserves other-device updates, drafts and unknown outcomes; unavailable and Preview states block edits',async()=>{
  let records=[{id:'original',title:'Fictional original',domain:'work',status:'open'}];
  let readFailure=false,loseReply=false,writable=true,posts=0,holdReads=false;
  const held=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      res.setHeader('content-type','application/json');
      if(url.pathname==='/api/tasks'){
        if(req.method==='POST'){
          posts++;let raw='';for await(const chunk of req)raw+=chunk;
          const body=JSON.parse(raw);
          if(!writable){res.statusCode=403;return res.end('{}');}
          if(body.revision!==revision(records)){res.statusCode=409;return res.end('{"error":"TASKS_CONFLICT"}');}
          records=body.tasks;
          if(loseReply){loseReply=false;res.statusCode=503;return res.end('{}');}
          return res.end(JSON.stringify({saved:true,tasks:records,revision:revision(records),writable}));
        }
        if(readFailure){res.statusCode=503;return res.end('{"error":"TASKS_UNAVAILABLE"}');}
        const snapshot=JSON.stringify({tasks:records,revision:revision(records),writable});
        if(holdReads){held.push(()=>res.end(snapshot));return;}
        return res.end(snapshot);
      }
      if(url.pathname==='/api/auth/session')return res.end('{"authenticated":true,"ok":true}');
      return res.end('{"connected":false,"messages":[],"unreadCount":0}');
    }
    const filename=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));
    try{res.setHeader('content-type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(filename));}catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await context.route('https://**',r=>r.abort());
    const address=`http://127.0.0.1:${server.address().port}`;
    const a=await context.newPage(),b=await context.newPage();
    async function open(page){
      await page.bringToFront();
      await page.goto(address);
      await page.waitForFunction(()=>typeof taskReadState!=='undefined'&&taskReadState!=='loading');
      await page.waitForFunction(()=>document.querySelector('#app').inert===false);
      await page.locator('nav [data-page=attention]').click();
      await page.locator('#attention [data-action-page=tasks]').click();
    }
    async function add(page,title){
      // Select the client and verify its draft before clicking.
      await page.bringToFront();
      await page.locator('#taskTitleInput').fill(title);
      assert.equal(await page.locator('#taskTitleInput').inputValue(),title);
      await page.locator('#taskAddButton').click();
    }
    await open(a);await open(b);
    await add(a,'Fictional device A');
    await a.waitForFunction(()=>!taskSaving&&tasks.length===2);
    await add(b,'Fictional device B');
    await b.getByText('Tasks changed on another device.',{exact:false}).waitFor();
    assert.equal(records.length,2);assert.ok(records.some(t=>t.title==='Fictional device A'));
    assert.equal(await b.locator('#taskTitleInput').inputValue(),'Fictional device B');
    assert.equal(await b.locator('.task-row').count(),2);
    await b.locator('#taskAddButton').click();await b.waitForFunction(()=>!taskSaving&&tasks.length===3);
    assert.equal(records.length,3);

    loseReply=true;const before=posts;
    await add(b,'Fictional lost response');
    await b.getByText('Could not confirm the save.',{exact:false}).waitFor();
    assert.equal(posts,before+1);assert.equal(records.length,4);
    assert.equal(await b.locator('.task-row').count(),4);
    assert.equal(await b.locator('#taskTitleInput').inputValue(),'');

    readFailure=true;
    await b.locator('#taskTitleInput').fill('Retain this unsaved draft');
    await b.evaluate(()=>loadTasks());
    assert.equal(await b.locator('.task-row').count(),4);
    assert.equal(await b.locator('#taskAddButton').isDisabled(),true);
    assert.equal(await b.locator('#taskTitleInput').inputValue(),'Retain this unsaved draft');
    assert.match(await b.locator('#taskNotice').textContent(),/previously loaded/);
    const c=await context.newPage();await open(c);
    assert.match(await c.locator('#taskEmpty').textContent(),/Tasks unavailable/);
    assert.doesNotMatch(await c.locator('#taskEmpty').textContent(),/No tasks yet/);
    assert.equal(await c.locator('#taskAddButton').isDisabled(),true);

    readFailure=false;writable=false;await b.evaluate(()=>loadTasks());
    assert.equal(await b.locator('#taskAddButton').isDisabled(),true);
    assert.equal(await b.locator('.task-row input').first().isDisabled(),true);
    assert.match(await b.locator('#taskNotice').textContent(),/Preview/);

    writable=true;holdReads=true;
    await b.evaluate(()=>{void loadTasks();});
    while(held.length<1)await new Promise(resolve=>setImmediate(resolve));
    records.push({id:'newest',title:'Fictional latest read',domain:'work',status:'open'});
    await b.evaluate(()=>{void loadTasks();});
    while(held.length<2)await new Promise(resolve=>setImmediate(resolve));
    const beforeBlocked=posts;await b.evaluate(()=>createTask());assert.equal(posts,beforeBlocked);
    held[1]();await b.waitForFunction(()=>taskReadState==='available'&&tasks.length===5);
    held[0]();holdReads=false;await b.evaluate(()=>new Promise(resolve=>setTimeout(resolve,50)));
    assert.equal(await b.locator('.task-row').count(),5);
    assert.equal(await b.locator('#taskTitleInput').inputValue(),'Retain this unsaved draft');
  }finally{held.forEach(release=>{try{release();}catch{}});await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
