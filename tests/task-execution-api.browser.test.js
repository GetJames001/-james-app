'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{fork}=require('node:child_process');
const {chromium}=require('playwright');
const auth=require('../lib/auth.js'),gateway=require('../api/gateway.js');
const {CAS}=require('../lib/customer-activity/storage.cjs');
const {openStore}=require('../tools/task-execution-proof/store.cjs');
const fixture=require('./fixtures/task-execution/inputs.json');
test('authenticated browser clients recover preparation results through the real task gateway; unauthenticated and forged writes fail',{timeout:60000},async()=>{
 const envKeys=['JAMES_AUTH_EMAIL','JAMES_SESSION_SECRET','JAMES_ALLOWED_HOSTS','JAMES_TASK_EXECUTION_PREVIEW_ENABLED','VERCEL_ENV','VERCEL_GIT_COMMIT_REF','KV_REST_API_URL','KV_REST_API_TOKEN'],previous=Object.fromEntries(envKeys.map(k=>[k,process.env[k]])),originalFetch=global.fetch;
 const owner='fixture@example.test',origin='https://james.fixture.test',dir=fs.mkdtempSync(path.join(os.tmpdir(),'james-task-browser-')),filename=path.join(dir,'fictional.sqlite'),store=openStore(filename);let browser,worker,storageCalls=0;
 Object.assign(process.env,{JAMES_AUTH_EMAIL:owner,JAMES_SESSION_SECRET:'synthetic-secret-for-task-browser-isolation',JAMES_ALLOWED_HOSTS:'james.fixture.test',JAMES_TASK_EXECUTION_PREVIEW_ENABLED:'true',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'work/agent-systems-first-proof-20261112',KV_REST_API_URL:'https://kv.fixture.test',KV_REST_API_TOKEN:'synthetic-task-browser'});
 const token=auth.createSessionToken(owner);
 global.fetch=async(url,options)=>{
  assert.equal(url,'https://kv.fixture.test');assert.equal(options.headers.Authorization,'Bearer synthetic-task-browser');storageCalls++;const c=JSON.parse(options.body);
  if(c[0]==='GET')return Response.json({result:await store.read(c[1])});
  assert.equal(c[0],'EVAL');assert.equal(c[1],CAS);assert.equal(c[2],1);
  return Response.json({result:await store.compareAndSwap(c[3],c[4]==='absent'?null:c[5],c[6])?1:0});
 };
 const command={type:'create',operationId:'browser-create',taskId:'agenda',expectedRevision:0,kind:'agenda_fixture',objective:'Fictional agenda',input:fixture.agenda,budget:fixture.budget,requiresApproval:false};
 // Test-only view. It exercises the actual gateway/auth/storage, without
 // changing the real James interface or sending traffic to an external site.
 const html='<!doctype html><button id="queue">Prepare fictional agenda</button><p id="request-status"></p><pre id="tasks"></pre><script>const command='+JSON.stringify(command)+';async function refresh(){const r=await fetch("/api/james/task-execution");const d=await r.json();document.querySelector("#tasks").textContent=r.ok?d.tasks.map(t=>t.id+" "+t.status).join("\\n"):String(r.status);}document.querySelector("#queue").onclick=async()=>{const r=await fetch("/api/james/task-execution",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(command)});document.querySelector("#request-status").textContent=String(r.status);await refresh();};refresh();</script>';
 try{
  browser=await chromium.launch({headless:true});
  async function client(signedIn){
   const context=await browser.newContext();if(signedIn)await context.addCookies([{name:auth.SESSION_COOKIE,value:token,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'no third-party traffic in this proof');
    if(url.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:html});
    if(url.pathname!=='/api/james/task-execution')return route.fulfill({status:404,body:''});
    const req={method:request.method(),query:{path:'api/james/task-execution',...Object.fromEntries(url.searchParams)},headers:{...await request.allHeaders(),host:url.host},body:request.postData()||undefined},response={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(){return this;}};
    await gateway(req,response);await route.fulfill({status:response.code,headers:response.headers,body:JSON.stringify(response.body)});
   });
   const page=await context.newPage();await page.goto(origin);return {context,page};
  }
  const first=await client(true);await first.page.locator('#queue').click();await first.page.waitForFunction(()=>document.querySelector('#request-status').textContent==='201');assert.match(await first.page.locator('#tasks').textContent(),/agenda queued/);
  await first.context.close();
  worker=fork(path.join(__dirname,'../tools/task-execution-proof/worker.cjs'),[filename,owner,'agenda','worker-after-browser-close','finish'],{stdio:['ignore','ignore','pipe','ipc']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture worker timeout')),15000);worker.on('message',event=>{if(event.event==='finished'){clearTimeout(timer);event.status==='completed'?resolve():reject(Error('Fixture preparation did not finish'));}if(event.event==='failed'){clearTimeout(timer);reject(Error('Fixture worker failed'));}});worker.once('error',reject);});
  const second=await client(true);await second.page.waitForFunction(()=>document.querySelector('#tasks').textContent==='agenda completed');await second.page.reload();await second.page.waitForFunction(()=>document.querySelector('#tasks').textContent==='agenda completed');
  const denied=await client(false);await denied.page.waitForFunction(()=>document.querySelector('#tasks').textContent==='401');
  const before=storageCalls;
  const rejected=await second.page.evaluate(async()=>{
   const post=async command=>(await fetch('/api/james/task-execution',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)})).status;
   return {owner:await post({...command,owner:'different-owner'}),completion:await post({...command,type:'complete'})};
  });
  assert.deepEqual(rejected,{owner:400,completion:403});assert.equal(storageCalls,before,'rejected commands never reach storage');assert.equal(store.artifactCount(),1);
  console.log('TASK_API_BROWSER_EVIDENCE',JSON.stringify({actualGatewayAuth:true,firstBrowserClosedBeforeWorker:true,secondAuthenticatedContextRead:true,reloadPersisted:true,unauthenticatedRejected:true,forgedOwnerRejected:true,workerCommandRejected:true,preparedArtifacts:1,externalProviderCalls:0,actualDeviceTest:false,hostedSchedulerTest:false}));
 }finally{
  await browser?.close();if(worker&&worker.exitCode===null&&worker.signalCode===null)worker.kill('SIGKILL');store.close();fs.rmSync(dir,{recursive:true,force:true});global.fetch=originalFetch;for(const key of envKeys)previous[key]===undefined?delete process.env[key]:process.env[key]=previous[key];
 }
});
