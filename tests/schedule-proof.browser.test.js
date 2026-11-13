'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('isolated proof page reads results on a fresh client without dispatching tasks and labels undelivered updates honestly',{timeout:30000},async()=>{
 const now=Date.now();let down=false;
 const state={armed:false,stopped:false,window:{start:now-1000,end:now+1800000},tasks:[],notifications:[],runs:[],schedulerDisabled:false},actions=[];
 const server=http.createServer((req,res)=>{
  if(req.url==='/api/james/hosted-proof'){
   res.setHeader('Content-Type','application/json');
   if(req.method==='GET'){res.statusCode=down?503:200;res.end(JSON.stringify(down?{error:'unavailable'}:state));return;}
   let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw);actions.push(body);if(body.action==='arm')state.armed=true;if(body.action==='stop'){state.stopped=true;state.armed=false;}res.end(JSON.stringify({status:body.action==='stop'?'stopped':'armed'}));});return;
  }
  if(req.url==='/hosted-proof'||req.url==='/hosted-proof-ui.js'){res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(path.join(__dirname,'..',req.url.endsWith('.js')?'hosted-proof-ui.js':'hosted-proof.html')));return;}
  res.statusCode=404;res.end();
 });
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/hosted-proof';
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844}}),first=await context.newPage();
  await first.goto(url);await first.locator('#arm').waitFor({state:'visible'});await first.waitForFunction(()=>!document.getElementById('arm').disabled);
  assert.equal(actions.length,0);await first.locator('#arm').click();await first.waitForFunction(()=>document.getElementById('state').textContent.includes('close this page'));
  assert.deepEqual(actions,[{action:'arm'}]);await context.close();
  // Only the fixture server changes state while there are no browser clients.
  // This verifies presentation/continuity; it is not hosted-scheduler evidence.
  state.tasks=[{id:'task-a',kind:'agenda_fixture',status:'completed',outcome:'prepared'},{id:'task-b',kind:'followup_fixture',status:'blocked',outcome:null}];state.notifications=[{id:'notice',state:'queued',hasReceipt:false}];
  const secondContext=await browser.newContext({viewport:{width:390,height:844}}),second=await secondContext.newPage();await second.goto(url);
  await second.locator('#tasks').getByText('Agenda: prepared',{exact:true}).waitFor();assert.match(await second.locator('#tasks').innerText(),/waiting for a fictional customer detail/);
  assert.match(await second.locator('#notices').innerText(),/delivery has not been tested/);assert.equal(actions.length,1);
  assert.equal(await second.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  down=true;await second.locator('#refresh').click();await second.locator('#error').getByText(/Results are unavailable/).waitFor();assert.match(await second.locator('#tasks').innerText(),/Agenda: prepared/);
  down=false;await second.locator('#stop').click();await second.waitForFunction(()=>document.getElementById('state').textContent.includes('shutdown still needs verification'));
  assert.deepEqual(actions,[{action:'arm'},{action:'stop'}]);assert.equal(await second.locator('#arm').isEnabled(),false);await secondContext.close();
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
