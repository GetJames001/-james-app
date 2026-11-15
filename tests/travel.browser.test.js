const {chromium}=require('playwright');
const fs=require('fs');
const assert=require('node:assert/strict');
require('node:test')('Travel opens a private link, saves and restores a dated itinerary at phone width', async()=>{
 const b=await chromium.launch();
 try{
 const page=await b.newPage({viewport:{width:390,height:844}, reducedMotion:'reduce'});
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
 await page.goto('https://test.invalid/#trip?title=Fixture&start=2099-01-01&end=2099-01-02&stop='+encodeURIComponent(stop));
 await page.getByRole('button',{name:'Save trip',exact:true}).click();
 await page.getByText('Upcoming trips',{exact:true}).waitFor({state:'attached',timeout:4000});
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
 }finally{await b.close();}
});
