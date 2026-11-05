const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
test('To Do reviews loaded mail, preserves drafts and stale suggestions without automatic writes',async()=>{
 let mode='populated',writes=0;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(req.method!=='GET'){if(['/api/tasks','/api/microsoft/mail'].includes(url.pathname))writes++;return res.end('{}');}
   if(url.pathname==='/api/microsoft/mail'){
    if(mode==='failed'){res.statusCode=502;return res.end('{"error":"Mail unavailable","messagesStatus":"unavailable"}');}
    return res.end(JSON.stringify({connected:true,unreadCount:1,messages:mode==='empty'?[]:[{id:'bill',subject:'Payment due <script>window.injected=true</script>',sender:'Synthetic bank',preview:'Verify your statement',isRead:false}]}));
   }
   if(url.pathname==='/api/tasks')return res.end('{"tasks":[]}');
   if(url.pathname==='/api/auth/session')return res.end('{"ok":true,"authenticated":true}');
   return res.end('{"connected":false}');
  }
  const filename=path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1));
  try{res.setHeader('content-type',/\.m?js$/.test(filename)?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(filename));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:768}});
  await page.route('https://**',route=>route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>document.querySelector('#mailAttentionView article'));
  await page.evaluate(()=>window.page('attention'));
  assert.equal(await page.locator('nav [data-page="attention"]').textContent(),'To Do');
  assert.equal(await page.locator('nav [data-page="files"]').count(),0);
  assert.equal(await page.locator('nav [data-page="tasks"]').count(),0);
  assert.match(await page.locator('#mailAttentionView').textContent(),/Possible bill/);
  assert.equal(await page.evaluate(()=>window.injected),undefined);
  await page.locator('#mailAttentionView').getByRole('button',{name:'Draft a task'}).click();
  assert.match(await page.locator('#taskTitleInput').inputValue(),/^Review email: Payment due/);
  assert.equal(writes,0,'drafting does not save a task or mark mail read');
  await page.locator('#taskTitleInput').fill('Keep my unsaved task');
  await page.evaluate(()=>window.page('attention'));
  await page.locator('#mailAttentionView').getByRole('button',{name:'Draft a task'}).click();
  assert.equal(await page.locator('#taskTitleInput').inputValue(),'Keep my unsaved task');
  mode='failed';await page.waitForTimeout(5100);await page.evaluate(()=>loadPersonalMicrosoftMail());
  assert.match(await page.locator('#mailAttentionView').textContent(),/may be out of date/);
  assert.equal(await page.locator('#mailAttentionView article').count(),1);
  mode='empty';await page.waitForTimeout(5100);await page.evaluate(()=>loadPersonalMicrosoftMail());
  assert.equal(await page.locator('#mailAttentionView article').count(),0);
  assert.equal(writes,0);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
