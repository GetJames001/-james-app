const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const wardrobe='https://aaru-working-review.aglow-ox-8353.chatgpt.site/wardrobe';

test('all Wardrobe entrances navigate directly in the same tab and preserve Lifestyle for return',async()=>{
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext({viewport:{width:820,height:1180},reducedMotion:'reduce'});
  await context.route('https://test.invalid/**',route=>{
   const path=new URL(route.request().url()).pathname.slice(1)||'index.html';
   if(!path.includes('..')&&fs.existsSync(path)&&fs.statSync(path).isFile())return route.fulfill({path});
   return route.fulfill({json:{}});
  });
  await context.route(wardrobe+'?**',route=>route.fulfill({contentType:'text/html',body:'<h1>Wardrobe fixture</h1><button onclick="history.back()">Lifestyle</button>'}));
  const page=await context.newPage();
  for(const selector of ['nav [data-page=wardrobe]','#lifestyle [data-action-page=wardrobe]','.briefing-wardrobe[data-action-page=wardrobe]']){
   await page.goto('https://test.invalid');
   await page.evaluate(()=>sessionStorage.setItem('jamesIntroDate',new Date().toDateString()));
   if(selector.startsWith('#lifestyle'))await page.locator('nav [data-page=lifestyle]').click();
   else if(selector.startsWith('.briefing'))await page.locator('nav [data-page=briefing]').click();
   await page.locator(selector).click();
   await page.waitForURL(wardrobe+'?**');
   assert.equal(context.pages().length,1);
   assert.equal(new URL(page.url()).searchParams.get('returnTo'),'https://test.invalid/#lifestyle');
   await page.getByRole('button',{name:'Lifestyle'}).click();
   await page.waitForURL('https://test.invalid/');
   await page.waitForFunction(()=>document.querySelector('#lifestyle').classList.contains('active'));
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('jamesCurrentPage')),'lifestyle');
  }
  await page.goto('https://test.invalid/#lifestyle');
  await page.waitForFunction(()=>document.querySelector('#lifestyle').classList.contains('active'));
  assert.equal(new URL(page.url()).hash,'');
 }finally{await browser.close();}
});
