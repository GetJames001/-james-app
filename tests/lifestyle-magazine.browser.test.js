const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');

test('Lifestyle on iPad opens existing Wardrobe, saves a recipe across refresh, and distinguishes live and unavailable feeds',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:820,height:1180},reducedMotion:'reduce'});
  let saved=null,deleted=[];
  await page.route('https://test.invalid/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname.slice(1)||'index.html';
   if(path==='api/lifestyle/cookbook'){
    if(route.request().method()==='DELETE'){deleted.push(route.request().postDataJSON().url);return route.fulfill({status:204});}
    return route.fulfill({json:url.search?{urls:deleted}:{items:[]}});
   }
   if(path==='api/lifestyle/feed'){
    if(url.searchParams.get('source')==='recipes')return route.fulfill({json:{publisher:'Budget Bytes',items:[{title:'Roasted peppers',url:'https://www.budgetbytes.com/roasted-peppers/'}]}});
    if(url.searchParams.get('source')==='business')return route.fulfill({json:{publisher:'PBS News',items:[1,2,3].map(n=>({title:'Sample story '+n,url:'https://www.pbs.org/newshour/economy/'+n,photo:'https://test.invalid/assets/lifestyle/finance.jpg'}))}});
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
  await page.locator('#cookbookCover').click();
  assert.equal(await page.locator('#cookReader').evaluate(d=>d.open),true);
  await page.locator('#cookFit').click();
  assert.equal(await page.locator('#cookFit').textContent(),'Fit to screen');
  await page.locator('#cookFit').click();
  assert.equal(await page.locator('#bookPage ul li').count(),8);
  assert.equal(await page.locator('#bookPage ol li').count(),4);
  for(const width of [1180,820,390]){
   await page.setViewportSize({width,height:900});
   const layout=await page.locator('#bookPage ol li').first().evaluate(li=>{
    const range=document.createRange();range.selectNodeContents(li);
    return {display:getComputedStyle(li).display,width:li.getBoundingClientRect().width,line:range.getClientRects()[0].width};
   });
   assert.equal(layout.display,'list-item');
   assert.ok(layout.width>130 && layout.line>layout.width*.6,'Method uses the available page width');
  }
  await page.setViewportSize({width:820,height:1180});
  await page.locator('#cookClose').click();
  await page.getByRole('button',{name:'Save to book'}).click();
  await page.waitForFunction(()=>document.querySelector('#bookPage h3').textContent==='Roasted peppers');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#bookPosition').textContent.endsWith('/ 2'));
  await page.locator('#cookbookCover').click();
  await page.locator('#bookNext').click();assert.equal(await page.locator('#bookPage a').getAttribute('href'),'https://www.budgetbytes.com/roasted-peppers/');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#bookPosition').textContent(),'1 / 2');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Delete Roasted peppers'}).click();
  await page.getByText('No new recipe suggestions.').waitFor();
  await page.reload();await page.getByText('No new recipe suggestions.').waitFor();
  await page.waitForFunction(()=>document.querySelector('#bookPosition').textContent==='1 / 2');
  await page.locator('nav [data-page=lifestyle]').click();await page.locator('#lifestyle [data-action-page=growth]').click();
  const visual=await page.evaluate(()=>({
   canvas:getComputedStyle(document.getElementById('app')).backgroundImage,
   feature:getComputedStyle(document.querySelector('#growth .lead-panel')).backgroundImage,
   featureWidth:document.querySelector('#growth .lead-panel').getBoundingClientRect().width,
   folderWidth:document.querySelector('.career-box').getBoundingClientRect().width
  }));
  assert.ok(!visual.canvas.includes('url('));
  assert.ok(visual.feature.includes('development.jpg'));
  assert.ok(visual.featureWidth>visual.folderWidth);
  await page.getByRole('button',{name:'Personal growth',exact:true}).click();
  await page.locator('#growth').getByRole('button',{name:'Retry feed'}).first().waitFor();
  assert.equal(await page.locator('#growth a').first().getAttribute('href'),'https://ggia.berkeley.edu/practice/active_listening');
  await page.locator('nav [data-page=lifestyle]').click();
  await page.locator('#lifestyle [data-action-page=fitness]').click();
  await page.getByRole('button',{name:'Browse workouts'}).click();
  await page.getByRole('button',{name:/Core and strength circuit/}).click();
  assert.equal(await page.locator('#workoutTitle').textContent(),'Core and strength circuit');
  await page.getByRole('button',{name:'Set as today’s workout'}).click();
  await page.reload();
  assert.equal(await page.locator('#dailyWorkout').textContent(),'Core and strength circuit');
  await page.getByRole('button',{name:'View workout'}).click();
  assert.equal(await page.locator('#workoutMoves li').count(),5);
  await page.locator('#workoutStart').click();
  assert.match(await page.locator('#workoutStage').textContent(),/Air squat/);
  await page.locator('#workoutNext').click();
  assert.match(await page.locator('#workoutStage').textContent(),/Rest/);
  await page.locator('#workoutStart').click();
  assert.equal(await page.locator('#workoutStart').textContent(),'Resume');
  await page.setViewportSize({width:1180,height:820});
  await page.evaluate(()=>window.jamesPageNow('finance'));
  const financeCards=page.locator('#finance .money-grid > section');
  assert.equal(await financeCards.count(),4);
  const boxes=await financeCards.evaluateAll(cards=>cards.map(card=>card.getBoundingClientRect().top));
  assert.equal(boxes[0],boxes[1]);
  assert.ok(boxes[2]>boxes[1]);
  assert.equal(boxes[2],boxes[3]);
  await page.locator('#financeToday .headline-card').first().waitFor();
  assert.equal(await page.locator('#financeToday .headline-card').count(),2);
  assert.equal(await page.locator('#financeToday a.headline-card').first().getAttribute('href'),'https://www.pbs.org/newshour/economy/1');
  await page.getByRole('button',{name:'Investments',exact:true}).click();
  assert.equal(await page.locator('#financeOverview').isVisible(),false);
  assert.equal(await page.locator('#financeInvestments').isVisible(),true);
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  if(process.env.JAMES_CARD_PREVIEWS){
   fs.mkdirSync('card-previews',{recursive:true});
   for(const screen of ['finance','growth','briefing','travel']){
    await page.evaluate(screen=>window.jamesPageNow(screen),screen);
    await page.locator('#'+screen).screenshot({path:'card-previews/'+screen+'.jpg',quality:70});
   }
  }
 }finally{await browser.close();}
});

test('cookbook imports board destinations and a second scan keeps a single recipe',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:820,height:1180}}),ctx=page.context();
  const dest='https://www.eatwell101.com/parmesan-roasted-brussels-sprouts';
  const item={url:dest,title:'Garlic Parmesan Roasted Brussels Sprouts',publisher:'Eatwell101',ingredients:['Brussels sprouts'],steps:['Roast until golden.'],photo:'https://www.eatwell101.com/photo.jpg'};
  let stored=false;
  await ctx.route('https://aaru-working-review.aglow-ox-8353.chatgpt.site/wardrobe/recipe-board',r=>r.fulfill({contentType:'text/html',body:'<script>(window.opener||parent).postMessage('+JSON.stringify({type:'james-recipe-board',links:[dest,dest],missing:0})+',"https://test.invalid");if(window.opener)window.close()</script>'}));
  await ctx.route('https://test.invalid/**',async r=>{
   const path=new URL(r.request().url()).pathname.slice(1)||'index.html';
   if(path==='api/lifestyle/cookbook'){
    if(r.request().method()==='GET')return r.fulfill({json:{items:stored?[item]:[]}});
    const status=stored?'existing':'added';stored=true;return r.fulfill({json:{status}});
   }
   if(path==='api/james/files')return r.fulfill({json:{files:[]}});
   if(!path.includes('..')&&fs.existsSync(path)&&fs.statSync(path).isFile())return r.fulfill({path});
   return r.fulfill({json:{}});
  });
  await page.goto('https://test.invalid');
  await page.locator('nav [data-page=lifestyle]').click();await page.locator('#lifestyle [data-action-page=recipes]').click();
  await page.locator('#recipeBoardSync').click();
  await page.getByText('1 added to your book').waitFor();
  await page.locator('#cookbookCover').click();
  await page.locator('#bookNext').click();
  assert.equal(await page.locator('#bookPage h3').textContent(),item.title);
  assert.equal(await page.locator('#bookPhoto').getAttribute('src'),item.photo);
  assert.equal(await page.locator('#bookPage ol li').textContent(),item.steps[0]);
  await page.reload();await page.getByText('Book up to date',{exact:true}).waitFor();
  assert.equal(await page.locator('#bookPosition').textContent(),'1 / 2');
 }finally{await browser.close();}
});
