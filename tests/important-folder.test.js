const test=require('node:test');
const assert=require('node:assert/strict');
const {includeImportantFolder}=require('../lib/attention/important-folder.cjs');
const {collectReview,projectReview}=require('../lib/attention/mail-review.cjs');
const at='2026-11-16T18:00:00Z';
for(const [provider,folder] of [['gmail','Spam'],['microsoft','Junk']]){
 test(provider+' persists a hiring decision once with folder provenance on repeat scans',async()=>{
  const rows=[{id:provider+'1',subject:'Thank you for your interest',preview:'Thank you for applying to our territory manager position. At this time, you were not selected to move forward in the interview process.'},
   {id:provider+'2',subject:'Job alert for Territory Manager',preview:'New positions for you.'}];
  const data=await includeImportantFolder({messages:[],discovery:{cursor:null,failed:false,lastCompletedAt:at}},null,folder,async()=>({messages:rows,nextCursor:null}));
  let state=null;
  for(let i=0;i<2;i++)state={...collectReview(state,'owner',data.messages,at,provider,null,null,data.discovery),revision:i+1};
  const items=projectReview(state).items;
  assert.equal(items.length,1);assert.equal(items[0].sourceFolder,folder);assert.match(items[0].reasons[0],/Hiring/);
 });
}
