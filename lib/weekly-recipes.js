'use strict';
const sources=[['I Heart Recipes','https://iheartrecipes.com/feed/','iheartrecipes.com'],['Girl Gone Gourmet','https://www.girlgonegourmet.com/feed/','girlgonegourmet.com']];
const hasScallops=r=>/\bscallops?\b/i.test([r.title,...(r.ingredients||[]),...(r.steps||[])].join(' '));
function weekStart(date){const d=new Date(date);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
async function weeklyRecipes({kv,key,readRecipe,readFeed=require('./routes/lifestyle-feed').readFeed,now=new Date()}){
 const week=weekStart(now),cacheKey=key+':discover:'+week;
 const cached=await kv('GET',cacheKey);if(cached)return JSON.parse(cached);
 const locked=await kv('SET',cacheKey+':loading','1','NX','EX',45);
 if(!locked)return {week,status:'loading',items:[]};
 try{
  const feeds=await Promise.allSettled(sources.map(s=>readFeed(s,20)));
  const lists=feeds.map(r=>r.status==='fulfilled'?r.value.items:[]),seen=new Set(),candidates=[];
  for(let i=0;i<20&&candidates.length<10;i++)for(const list of lists){
   const item=list[i];if(!item||!item.photo||hasScallops(item)||seen.has(item.url)||candidates.length>=10)continue;
   seen.add(item.url);candidates.push(item);
  }
  const checked=await Promise.allSettled(candidates.map(item=>readRecipe(new URL(item.url))));
  const items=checked.flatMap(result=>result.status==='fulfilled'&&result.value?.ingredients?.length&&result.value?.steps?.length&&result.value.photo&&!hasScallops(result.value)?[result.value]:[]);
  const data={week,status:items.length?'ready':'unavailable',items};
  if(items.length)await kv('SET',cacheKey,JSON.stringify(data),'EX',691200);
  return data;
 }finally{await kv('DEL',cacheKey+':loading');}
}
module.exports={weeklyRecipes,weekStart,hasScallops};
