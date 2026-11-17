const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');

test('Lifestyle on iPad opens existing Wardrobe, saves a recipe across refresh, and distinguishes live and unavailable feeds',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:820,height:1180},reducedMotion:'reduce'});
  let saved=null,deleted=[],cookSaved=false;
  const pick={url:'https://www.eatwell101.com/roasted-peppers',title:'Roasted peppers',publisher:'Eatwell101',photo:'https://i.pinimg.com/example.jpg'};
  await page.context().route('https://aaru-working-review.aglow-ox-8353.chatgpt.site/wardrobe/recipe-board',r=>r.fulfill({contentType:'text/html',body:'<script>(window.opener||parent).postMessage('+JSON.stringify({type:'james-recipe-board',links:[],missing:0,discovery:{status:'ready',items:[pick,{...pick,url:'https://www.eatwell101.com/roast-carrots',title:'Roast carrots'}]}})+',"https://test.invalid");if(window.opener)window.close()</script>'}));
  await page.route('https://test.invalid/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname.slice(1)||'index.html';
   if(path==='api/lifestyle/cookbook'){
    if(route.request().method()==='DELETE'){deleted.push(route.request().postDataJSON().url);return route.fulfill({status:204});}
    if(route.request().method()==='POST'){cookSaved=true;return route.fulfill({json:{status:'added'}});}
    return route.fulfill({json:url.search?{urls:deleted}:{items:cookSaved?[{...pick,ingredients:['2 peppers'],steps:['Roast the peppers.']}]:[]}});
   }
   if(path==='api/lifestyle/feed'){
    if(url.searchParams.get('source')==='recipes')throw Error('Publisher feed must not be used for Pinterest inspiration');
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
  assert.equal(await page.locator('#kitchenShelf').count(),0);
  await page.locator('#cookbookCover').click();await page.locator('#bookNext').click();
  assert.equal(await page.locator('#bookPage ul li').count(),2);
  await page.locator('#cookClose').click();
  await page.locator('#cookbookCover').click();await page.locator('#bookPrev').click();
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
  await page.locator('#recipeBoardSync').click();
  await page.locator('#pinterestPicks .mag-story').filter({hasText:'Roasted peppers'}).getByRole('button',{name:'Save to book'}).click();
  await page.waitForFunction(()=>document.querySelector('#bookPage h3').textContent==='Roasted peppers');
  assert.equal(await page.getByRole('button',{name:'Delete Roasted peppers'}).count(),0);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#bookPosition').textContent.endsWith('/ 3'));
  await page.locator('#cookbookCover').click();
  await page.locator('#bookNext').click();assert.equal(await page.locator('#bookPage a').getAttribute('href'),pick.url);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#bookPosition').textContent(),'1 / 3');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Delete Roast carrots'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Delete Roasted peppers'}).count(),0);
  await page.getByRole('button',{name:'Delete Roast carrots'}).click();
  await page.getByText('No new recipe suggestions.').waitFor();
  await page.reload();await page.getByText('No new recipe suggestions.').waitFor();
  await page.waitForFunction(()=>document.querySelector('#bookPosition').textContent==='1 / 3');
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
  const pin={url:'https://www.pinterest.com/pin/123456789/',title:'Saved dinner idea'};
  const stored=new Map();
  let postCount=0;
  await ctx.route(item.photo,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="350" height="2200"/>'}));
  await ctx.route('https://aaru-working-review.aglow-ox-8353.chatgpt.site/wardrobe/recipe-board',r=>r.fulfill({contentType:'text/html',body:'<script>(window.opener||parent).postMessage('+JSON.stringify({type:'james-recipe-board',links:[dest],pins:[{url:"https://www.pinterest.com/pin/456/",recipeSource:dest},pin],missing:1})+',"https://test.invalid");if(window.opener)window.close()</script>'}));
  await ctx.route('https://test.invalid/**',async r=>{
   const path=new URL(r.request().url()).pathname.slice(1)||'index.html';
   if(path==='api/lifestyle/cookbook'){
    if(r.request().method()==='GET')return r.fulfill({json:{items:[...stored.values()]}});
    const body=r.request().postDataJSON(),key=body.url||body.pin.url;
    postCount++;
    if(stored.has(key))return r.fulfill({json:{status:'existing'}});
    const full=key===dest;
    stored.set(key,full?item:{...pin,kind:'saved-pin',pinUrl:pin.url,publisher:'Mad Food Son'});
    return r.fulfill({json:{status:full?'added':'linked'}});
   }
   if(path==='api/james/files')return r.fulfill({json:{files:[]}});
   if(!path.includes('..')&&fs.existsSync(path)&&fs.statSync(path).isFile())return r.fulfill({path});
   return r.fulfill({json:{}});
  });
  await page.goto('https://test.invalid');
  await page.locator('nav [data-page=lifestyle]').click();await page.locator('#lifestyle [data-action-page=recipes]').click();
  await page.locator('#recipeBoardSync').click();
  await page.getByText('1 full recipe added · 1 saved as recipe links',{exact:true}).waitFor();
  await page.locator('#cookSavedPins summary').click();
  assert.equal(await page.locator('#cookSavedPins a').getAttribute('href'),pin.url);
  await page.locator('#cookbookCover').click();
  await page.locator('#bookNext').click();
  assert.equal(await page.locator('#bookPage h3').textContent(),item.title);
  assert.equal(await page.locator('#bookPhoto').getAttribute('src'),item.photo);
  assert.equal(await page.locator('#bookPage ol li').textContent(),item.steps[0]);
  await page.locator('#bookPhoto').evaluate(photo=>photo.decode());
  for(const width of [1180,820,390]){
   await page.setViewportSize({width,height:820});
   const height=await page.locator('#bookPhoto').evaluate(photo=>photo.getBoundingClientRect().height);
   assert.ok(height>0 && height<=535,'Portrait photo fits the page at '+width+'px');
  }
  await page.locator('#cookClose').click();
  await page.locator('#recipeBoardSync').click();
  await page.getByText('Book up to date',{exact:true}).waitFor();
  assert.equal(postCount,5); // Two board scans plus one automatic retry of the unresolved Pin.
  assert.equal(stored.size,2);
  await page.locator('#cookbookCover').click();
  await page.locator('#bookPrev').click();
  assert.equal(await page.locator('#bookPosition').textContent(),'1 / 3');
 }finally{await browser.close();}
});

test('a complete publisher gumbo retires the James starter page',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  const gumbo={title:'Cajun Chicken and Sausage Gumbo',publisher:'My Coffee Has Butter',url:'https://mycoffeehasbutter.com/cajun-chicken-and-sausage-gumbo/',ingredients:['6 cups chicken broth'],steps:['Serve.']};
  await page.route('https://test.invalid/**',route=>{
   const file=new URL(route.request().url()).pathname.slice(1)||'index.html';
   if(file==='api/lifestyle/cookbook')return route.fulfill({json:{items:[gumbo]}});
   if(file==='api/james/files')return route.fulfill({json:{files:[]}});
   if(!file.includes('..')&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});
   return route.fulfill({json:{}});
  });
  await page.goto('https://test.invalid');
  await page.locator('nav [data-page=lifestyle]').click();await page.locator('#lifestyle [data-action-page=recipes]').click();
  await page.waitForFunction(()=>document.querySelector('#bookPage h3')?.textContent==='Cajun Chicken and Sausage Gumbo');
  assert.equal(await page.locator('#bookPosition').textContent(),'1 / 2');
  assert.equal(await page.locator('#bookPage li').first().textContent(),'6 cups chicken broth');
 }finally{await browser.close();}
});
