const {chromium}=require('playwright');
const fs=require('fs');
require('node:test')('Travel opens a private link, saves and restores a dated itinerary at phone width', async()=>{
 const b=await chromium.launch();
 try{
 const page=await b.newPage({viewport:{width:390,height:844}});
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
 await page.goto('https://test.invalid/#trip?title=Fixture&start=2099-01-01&end=2099-01-02&stop=Test');
 await page.locator('#travel.active button').waitFor({state:'attached',timeout:7000});
 await page.locator('#travel.active button').evaluate(el=>el.click());
 await page.getByText('Upcoming trips',{exact:true}).waitFor({state:'attached',timeout:4000});
 await page.reload();
 await page.getByText('Fixture',{exact:true}).waitFor({state:'attached',timeout:4000});
 }finally{await b.close();}
});
