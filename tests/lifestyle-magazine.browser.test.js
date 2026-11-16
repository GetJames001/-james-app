const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');

test('Lifestyle on iPad opens existing Wardrobe, saves a recipe across refresh, and distinguishes live and unavailable feeds',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:820,height:1180},reducedMotion:'reduce'});
  let saved=null;
  await page.route('https://test.invalid/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname.slice(1)||'index.html';
   if(path==='api/lifestyle/feed'){
    if(url.searchParams.get('source')==='recipes')return route.fulfill({json:{publisher:'Budget Bytes',items:[{title:'Roasted peppers',url:'https://www.budgetbytes.com/roasted-peppers/'}]}});
    return route.fulfill({status:503,json:{}});
   }
   if(path==='api/james/files'){
    if(route.request().method()==='POST')saved={...route.request().postDataJSON(),size:200,id:'fixture'};
    return route.fulfill({json:url.search?{file:saved}:{files:saved?[saved]:[]}});
   }
   if(!path.includes('..')&&fs.existsSync(path)&&fs.statSync(path).isFile())return route.fulfill({path});
   return route.fulfill({json:{}});
  });
  await page.goto('https://test.invalid');await page.locator('nav [data-page=lifestyle]').click();
  const cards=page.locator('#lifestyle .mag-tile');assert.equal(await cards.count(),7);
  assert.equal(await page.locator('#lifestyle a.mag-tile').getAttribute('href'),await page.locator('.wardrobe-launch').getAttribute('href'));
  await page.locator('#lifestyle [data-action-page=recipes]').click();
  await page.getByRole('button',{name:'Save to book'}).click();
  await page.waitForFunction(()=>document.querySelector('#bookPage h3').textContent==='Roasted peppers');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#bookPosition').textContent.endsWith('/ 2'));
  await page.locator('#bookNext').click();assert.equal(await page.locator('#bookPage a').getAttribute('href'),'https://www.budgetbytes.com/roasted-peppers/');
  await page.locator('nav [data-page=lifestyle]').click();await page.locator('#lifestyle [data-action-page=growth]').click();
  await page.locator('#growth').getByRole('button',{name:'Retry feed'}).first().waitFor();
  assert.equal(await page.locator('#growth a').first().getAttribute('href'),'https://ggia.berkeley.edu/practice/active_listening');
  await page.locator('nav [data-page=lifestyle]').click();
  await page.locator('#lifestyle [data-action-page=fitness]').click();
  await page.getByRole('button',{name:'Swap workout'}).click();
  await page.getByRole('button',{name:/Mobility reset/}).click();
  assert.equal(await page.locator('#workoutTitle').textContent(),'Mobility reset');
  await page.getByRole('button',{name:'Use this workout today'}).click();
  await page.reload();
  assert.equal(await page.locator('#dailyWorkout').textContent(),'Mobility reset');
  await page.getByRole('button',{name:'View workout'}).click();
  assert.equal(await page.locator('#workoutMoves li').count(),3);
 }finally{await browser.close();}
});
