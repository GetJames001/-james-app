const {chromium}=require('playwright');
const fs=require('fs');
const assert=require('node:assert/strict');
require('node:test')('Travel opens a private link, saves and restores a dated itinerary at phone width', async()=>{
 const b=await chromium.launch();
 try{
 const page=await b.newPage({viewport:{width:390,height:844}, reducedMotion:'reduce'});
 await page.clock.setFixedTime(new Date('2098-12-25T12:00:00'));
 let saved;
 await page.route('https://test.invalid/**',async r=>{
 const u=new URL(r.request().url()),path=u.pathname.slice(1)||'index.html';
 if(path==='api/james/files'){
 const payload=r.request().postDataJSON();
 if(payload)saved={...payload,id:'abc',size:50};
 return r.fulfill({json:u.search?{file:saved}:{files:saved?[saved]:[]}});
 }
 if(!path.includes('..')&&fs.existsSync(path)&&fs.statSync(path).isFile())return r.fulfill({path});
 return r.fulfill({json:{}});
 });
 const stop = 'Leave the hotel after breakfast and continue along the river for an afternoon stop before reaching the last town.';
 await page.goto('https://test.invalid/#trip?title=Fixture&start=2099-01-01&end=2099-01-02&stop='+encodeURIComponent(stop)+'&stop=The+original+Drive+Weather+route+shows+A+and+omits+B.');
 await page.getByRole('button',{name:'Save trip',exact:true}).click();
 await page.locator('#travelCards').getByText('Upcoming trips',{exact:true}).waitFor({state:'attached',timeout:4000});
 await page.reload();
 await page.getByText('Fixture',{exact:true}).waitFor({state:'attached',timeout:4000});
 const paragraph=page.getByText(stop,{exact:true});
 for (const width of [360,390]) {
   await page.setViewportSize({width,height:844});
   const layout=await paragraph.evaluate(node=>{
     const range=document.createRange();
     range.selectNodeContents(node);
     const lines=Array.from(range.getClientRects());
     const card=node.closest('article');
     const style=getComputedStyle(card);
     const contentWidth=card.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
     return {width:contentWidth,firstLine:lines[0].width,lines:lines.length};
   });
   assert.ok(layout.firstLine > layout.width * 0.7, 'Itinerary text should use the card width');
   assert.ok(layout.lines > 1 && layout.lines < 10, 'A sentence should wrap naturally');
 }
 assert.equal(await page.getByText(/route shows A and omits B/i).count(),0);
 await page.evaluate(()=>window.jamesPageNow('briefing'));
 const summaryLink=page.locator('#briefingTripLinks a');
 await summaryLink.waitFor();
 const cards=await page.locator('.intel-strip > .intel-card').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));
 assert.equal(cards.length,4);
 assert.ok(cards.every(y=>Math.abs(cards[0]-y)<2));
 await summaryLink.click();
 await page.locator('#travel.active article').waitFor();
 await page.evaluate(()=>window.jamesPageNow('briefing'));
 await page.locator('#quickCalendarNext').click();
 const dates=page.locator('#quickCalendarDays .trip-day');
 assert.deepEqual(await dates.evaluateAll(nodes=>nodes.map(n=>n.dataset.date)),['2099-01-01','2099-01-02']);
 await dates.last().click();
 await page.locator('#apptList a.trip-link').click();
 await page.locator('#travel.active article').waitFor();
 }finally{await b.close();}
});
