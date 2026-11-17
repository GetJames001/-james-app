'use strict';
const {readPublisher}=require('../lib/routes/recipe-book');
const {weeklyRecipes}=require('../lib/weekly-recipes');
(async()=>{
 const urls=['https://mycoffeehasbutter.com/wprm_print/cajun-chicken-and-sausage-gumbo','https://iheartrecipes.com/baked-candied-yams-soul-food/','https://iheartrecipes.com/crock-pot-collard-greens-and-ham-hocks-soul-food/','https://www.girlgonegourmet.com/slow-cooked-short-rib-ragu/'];
 for(const url of urls){
  const r=await readPublisher(new URL(url));
  if(!r?.ingredients?.length||!r?.steps?.length)throw Error('Full recipe unavailable: '+url);
  console.log('Verified public recipe',r.url,r.ingredients.length,'ingredients',r.steps.length,'steps');
  if(url.includes('gumbo')&&!r.ingredients.some(i=>/6.*(?:broth|stock)/i.test(i)))throw Error('Expected publisher gumbo quantities missing');
 }
 const db=new Map(),kv=async(cmd,key,value)=>{if(cmd==='GET')return db.get(key);if(cmd==='SET'){db.set(key,value);return 'OK';}if(cmd==='DEL')db.delete(key);};
 const result=await weeklyRecipes({key:'public-source-verification-only',kv,readRecipe:readPublisher});
 console.log('Weekly full recipes',result.items.length,result.items.map(r=>r.title));
 if(!result.items.length)throw Error('Weekly discovery has no readable recipes');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
