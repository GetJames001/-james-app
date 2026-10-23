'use strict';
// Isolated browser fixture: no live providers, accounts, credentials, or hosted writes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const auth=require('../lib/auth.js');
const {createHeadStore}=require('../lib/conversation/head-store.cjs');
const {createHandler}=require('../lib/routes/conversation.js');
const origin='https://www.getjames.ai';
process.env.JAMES_AUTH_EMAIL='browser-fixture@example.test';
process.env.JAMES_SESSION_SECRET='synthetic-browser-fixture-secret-at-least-32-characters';

async function fixture(browser){
 const values=new Map();let failure=true,providerCalls=0;
 const store=createHeadStore({read:async k=>values.get(k)??null,compareAndSwap:async(k,old,next)=>{if((values.get(k)??null)!==old)return false;values.set(k,next);return true;}});
 const handler=createHandler({store});
 async function install(context){
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin)throw Error('Unexpected external request');
   const headers={...request.headers(),host:url.host};
   if(url.pathname==='/api/james/conversation'){
    const response={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
    await handler({method:request.method(),headers,query:{},body:request.postData()||undefined},response);
    return route.fulfill({status:response.code,headers:response.headers,contentType:'application/json',body:JSON.stringify(response.body)});
   }
   if(url.pathname==='/api/fast'){
    const response={code:200,setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
    if(!auth.requireAuth({headers},response,{csrf:true}))return route.fulfill({status:response.code,json:response.body});
    providerCalls++;
    return route.fulfill({status:failure?502:200,json:failure?{ok:false,error:'FAST_MODEL_UNAVAILABLE'}:{ok:true,answer:'Recovered fixture reply'}});
   }
   if(['/conversation-ui.js','/conversation-runtime.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'..',url.pathname.slice(1)),'utf8')});
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><label>Question<textarea id="question"></textarea></label><div><button id="ask">Ask James</button></div><div id="answer"></div><script src="/conversation-runtime.js"></script><script src="/conversation-ui.js"></script><script>window.testUI=JamesConversationUI.mount({input:document.querySelector('#question'),answer:document.querySelector('#answer'),askButton:document.querySelector('#ask')});document.querySelector('#ask').onclick=()=>testUI.ask();</script>`});
   return route.fulfill({status:404,body:''});
  });
 }
 return {install,recover(){failure=false;},calls:()=>providerCalls};
}

test('browser provider failure retains draft, retry works, and fresh read confirms End',async()=>{
 const browser=await chromium.launch();try{
  const h=await fixture(browser),context=await browser.newContext();await h.install(context);
  await context.addCookies([{name:auth.SESSION_COOKIE,value:auth.createSessionToken(process.env.JAMES_AUTH_EMAIL),url:origin,secure:true,httpOnly:true,sameSite:'Strict'}]);
  const page=await context.newPage();await page.goto(origin);
  await page.locator('#question').fill('Synthetic retained draft');await page.locator('#ask').click();
  await page.getByRole('status').filter({hasText:'configured model is unavailable'}).waitFor();
  assert.equal(await page.locator('#question').inputValue(),'Synthetic retained draft');
  h.recover();await page.locator('#ask').click();await page.getByText('Recovered fixture reply',{exact:true}).waitFor();
  assert.equal(await page.locator('#question').inputValue(),'');
  await page.getByRole('button',{name:'End conversation',exact:true}).click();await page.getByRole('status').filter({hasText:'Conversation ended'}).waitFor();
  const read=await context.newPage();await read.goto(origin+'/api/james/conversation');
  const ended=JSON.parse(await read.locator('body').innerText());assert.equal(ended.status,'ended');assert.ok(ended.conversationId);
  const outsider=await browser.newContext();await h.install(outsider);const denied=await outsider.newPage();
  const result=await denied.goto(origin+'/api/james/conversation');assert.equal(result.status(),401);
  assert.equal(JSON.parse(await denied.locator('body').innerText()).error,'UNAUTHORIZED');
  assert.equal(h.calls(),2);await outsider.close();await context.close();
 }finally{await browser.close();}
});
