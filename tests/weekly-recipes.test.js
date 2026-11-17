const {test}=require('node:test');
const assert=require('node:assert/strict');
const {weeklyRecipes,weekStart,hasScallops}=require('../lib/weekly-recipes');
test('weekly discoveries cache exact full recipes, omit scallops and refresh on a new week',async()=>{
 const db=new Map();let calls=0;
 const kv=async(command,key,value,...options)=>{if(command==='GET')return db.get(key);if(command==='DEL')return db.delete(key);if(command==='SET'){if(options.includes('NX')&&db.has(key))return null;db.set(key,value);return 'OK';}};
 const readFeed=async source=>({items:Array.from({length:8},(_,i)=>({url:'https://'+source[2]+'/recipe-'+i,photo:'https://example.test/photo.jpg',title:'Dinner '+i}))});
 const readRecipe=async url=>{calls++;return {url:url.href,title:'Dinner',photo:'https://example.test/photo.jpg',ingredients:[url.pathname.endsWith('0')?'1 lb scallops':'2 cups beans'],steps:['Cook the beans.']};};
 const options={kv,key:'owner-preview',readFeed,readRecipe,now:new Date('2026-11-17T12:00:00Z')};
 const first=await weeklyRecipes(options);assert.equal(calls,10);assert.equal(first.items.length,8);assert.ok(first.items.every(r=>!hasScallops(r)));
 assert.deepEqual(await weeklyRecipes(options),first);assert.equal(calls,10);
 await weeklyRecipes({...options,now:new Date('2026-11-23T12:00:00Z')});assert.equal(calls,20);
 assert.equal(weekStart(new Date('2026-11-22T23:00:00Z')),'2026-11-16');
});
test('concurrent discovery requests do not duplicate publisher fetches',async()=>{
 const data=await weeklyRecipes({key:'owner',kv:async cmd=>cmd==='GET'?null:null,readRecipe:()=>{throw Error('must not run');},readFeed:()=>{throw Error('must not run');}});
 assert.equal(data.status,'loading');
});
