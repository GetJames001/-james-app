const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const {chromium}=require('playwright');
test('only opening Mail changes read state; confirmed states/counts persist and errors/stale refresh cannot replace them',async()=>{
  let message={id:'synthetic-mail',subject:'Synthetic mail',sender:'Synthetic sender',preview:'Sample',body:'<p>Sample body</p>',isRead:false};
  let count=33,patches=0,mode='hold',release,holdGet=false,releaseGet;
  const data=()=>({connected:true,unreadCount:count,messages:[structuredClone(message)]});
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      res.setHeader('content-type','application/json');
      if(url.pathname==='/api/microsoft/mail'){
        if(req.method==='PATCH'){
          patches++;let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body);
          assert.deepEqual(Object.keys(payload).sort(),['isRead','messageId']);assert.equal(payload.messageId,message.id);
          if(mode==='hold')await new Promise(resolve=>release=resolve);
          if(mode==='permission'){res.statusCode=403;return res.end('{"error":"MAIL_PERMISSION_REQUIRED"}');}
          if(mode==='failure'){res.statusCode=502;return res.end('{}');}
          message.isRead=payload.isRead;count=payload.isRead?32:33;
          return res.end(JSON.stringify({ok:true,messageId:message.id,isRead:message.isRead,unreadCount:count,unreadCountVerified:true}));
        }
        const snapshot=data();if(holdGet)await new Promise(resolve=>releaseGet=resolve);return res.end(JSON.stringify(snapshot));
      }
      if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
      if(url.pathname==='/api/auth/session')return res.end('{"ok":true,"authenticated":true}');
      return res.end('{"connected":false}');
    }
    const filename=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));try{res.setHeader('content-type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(filename));}catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:820,height:1180}});
    await page.route('https://**',r=>r.abort());const address=`http://127.0.0.1:${server.address().port}`;
    await page.goto(address);await page.waitForFunction(()=>document.querySelector('#personalEmailCount').textContent==='33 unread');
    await page.evaluate(()=>{document.querySelectorAll('.intro,.intro-overlay').forEach(el=>el.remove());document.body.classList.remove('frosted');document.querySelector('#personalMailRow').click();});
    assert.equal(patches,0);assert.match(await page.locator('#personalMailMessages b').textContent(),/^●/);
    await page.locator('[data-message-id="synthetic-mail"]').click();await page.waitForFunction(()=>document.querySelector('#personalMailReadButton').disabled);
    assert.match(await page.locator('#personalMailMessages b').textContent(),/^●/);assert.equal(await page.locator('#personalEmailCount').textContent(),'33 unread');
    while(!release)await new Promise(resolve=>setImmediate(resolve));mode='success';release();
    await page.waitForFunction(()=>document.querySelector('#personalEmailCount').textContent==='32 unread');
    assert.doesNotMatch(await page.locator('#personalMailMessages b').textContent(),/^●/);assert.equal(await page.locator('#personalMailReadButton').textContent(),'Mark unread');
    await page.locator('#personalMailReadButton').click();await page.waitForFunction(()=>document.querySelector('#personalEmailCount').textContent==='33 unread');assert.match(await page.locator('#personalMailMessages b').textContent(),/^●/);
    const before=patches;await page.evaluate(()=>applyPersonalMicrosoftMail({connected:true,unreadCount:33,messages:window.personalMicrosoftMessages}));assert.equal(patches,before,'restoring displayed detail never marks unread back to read');
    mode='permission';await page.locator('#personalMailReadButton').click();await page.locator('#personalMailDetail .mail-state-notice a').waitFor();assert.equal(await page.locator('#personalEmailCount').textContent(),'33 unread');assert.match(await page.locator('#personalMailMessages b').textContent(),/^●/);
    mode='success';holdGet=true;await page.evaluate(()=>{window.oldRead=requestPersonalMicrosoftMail().then(applyPersonalMicrosoftMail).catch(()=>{});});
    while(!releaseGet)await new Promise(resolve=>setImmediate(resolve));await page.locator('#personalMailReadButton').click();await page.waitForFunction(()=>document.querySelector('#personalEmailCount').textContent==='32 unread');holdGet=false;releaseGet();await page.evaluate(()=>window.oldRead);
    assert.equal(await page.locator('#personalEmailCount').textContent(),'32 unread');assert.doesNotMatch(await page.locator('#personalMailMessages b').textContent(),/^●/);
    mode='failure';await page.locator('#personalMailReadButton').click();await page.waitForFunction(()=>document.querySelector('.mail-state-notice').textContent.includes('Could not confirm'));
    assert.equal(await page.locator('#personalEmailCount').textContent(),'32 unread');assert.doesNotMatch(await page.locator('#personalMailMessages b').textContent(),/^●/);
    await page.reload();await page.waitForFunction(()=>document.querySelector('#personalEmailCount').textContent==='32 unread');assert.equal(patches,before+3,'reload does not send mark-read');
  }finally{release?.();releaseGet?.();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
