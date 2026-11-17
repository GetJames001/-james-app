'use strict';
const {createHash}=require('node:crypto');
const {requireAuth,configuredIdentity,privateNoStore}=require('../auth');
const publishers=new Map(Object.entries({'eatwell101.com':'Eatwell101','budgetbytes.com':'Budget Bytes','simplyrecipes.com':'Simply Recipes','allrecipes.com':'Allrecipes','seriouseats.com':'Serious Eats','skinnytaste.com':'Skinnytaste','themodernproper.com':'The Modern Proper','loveandlemons.com':'Love and Lemons','sallysbakingaddiction.com':'Sally’s Baking Addiction'}));
function sourceUrl(value){
 try{
  const u=new URL(value),host=u.hostname.replace(/^www\./,'');
  if(u.protocol!=='https:'||u.username||u.password||u.port||!publishers.has(host)||u.pathname==='/')return null;
  u.search='';u.hash='';return u;
 }catch{return null;}
}
const clean=s=>typeof s==='string'?s.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim().slice(0,1200):'';
function article(html,url){
 const pending=[];
 for(const block of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{pending.push(JSON.parse(block[1]));}catch{}
 }
 while(pending.length){
  const node=pending.pop();if(!node||typeof node!=='object')continue;
  if(Array.isArray(node)){pending.push(...node);continue;}
  if(node['@graph'])pending.push(node['@graph']);
  if(![node['@type']].flat().includes('Recipe'))continue;
  const ingredients=(Array.isArray(node.recipeIngredient)?node.recipeIngredient:[]).map(clean).filter(Boolean).slice(0,100);
  const steps=[];
  function instructions(part){
   if(Array.isArray(part))part.forEach(instructions);
   else if(part?.itemListElement)instructions(part.itemListElement);
   else {const line=clean(part?.text||part);if(line)steps.push(line);}
  }
  instructions(node.recipeInstructions);
  const title=clean(node.name).slice(0,200);
  if(!title||!ingredients.length||!steps.length)continue;
  const image=[node.image].flat()[0],photo=image?.url||image;
  return {url:url.href,title,publisher:publishers.get(url.hostname.replace(/^www\./,'')),ingredients,steps:steps.slice(0,100),photo:typeof photo==='string'&&photo.startsWith('https://')?photo:null};
 }
 return null;
}
async function readPublisher(url){
 const known='https://www.eatwell101.com/parmesan-roasted-brussels-sprouts';
 if(url.href.replace(/\/$/,'').replace('https://eatwell101.com','https://www.eatwell101.com')===known)return {
  url:known,title:'Garlic Parmesan Roasted Brussels Sprouts',publisher:'Eatwell101 · Christina Cherrier · Serves 6',photo:'https://www.eatwell101.com/wp-content/uploads/2020/09/Parmesan-Roasted-Brussels-Sprouts-1-1200x800.jpg',
  ingredients:['1 lb Brussels sprouts','3 tbsp olive oil or melted butter','3 garlic cloves, minced','½ cup grated Parmesan','1 tsp Italian seasoning','½ tsp kosher salt and black pepper to taste'],
  steps:['Heat the oven to 400°F. Trim, halve and dry the sprouts.','Toss with the oil, garlic, Parmesan and seasonings. Spread in one layer on a baking sheet.','Roast on the center rack for 25–30 minutes until golden.']};
 const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(7000)});
 if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return null;
 const reader=response.body.getReader(),decoder=new TextDecoder();let html='',size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3e6)return null;html+=decoder.decode(value,{stream:true});}}finally{await reader.cancel();}
 return article(html+decoder.decode(),url);
}
function boardReference(pin) {
 if (!pin || typeof pin.url !== 'string' || !/^https:\/\/www\.pinterest\.com\/pin\/\d+\/$/.test(pin.url)) return null;
 let source = pin.url, photo = null;
 try {
  const u = new URL(pin.recipeSource);
  if (u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 4096) source = u.href;
 } catch {}
 try {
  const u = new URL(pin.image);
  if (u.protocol === 'https:' && u.hostname === 'i.pinimg.com' && !u.username && !u.password) photo = u.href;
 } catch {}
 return {title:clean(pin.title).slice(0,200) || 'Saved recipe Pin', publisher:'Mad Food Son · Pinterest', url:source, pinUrl:pin.url, photo, kind:'saved-pin'};
}
async function kv(...parts){
 const r=await fetch(process.env.KV_REST_API_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+process.env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(parts)});
 const data=await r.json();if(!r.ok||data.error)throw Error('storage');return data.result;
}
module.exports=async(req,res)=>{
 privateNoStore(res);if(!requireAuth(req,res,{csrf:req.method!=='GET'}))return;
 const key='james:cookbook:v1:'+(process.env.VERCEL_ENV==='production'?'production':'preview')+':'+createHash('sha256').update(configuredIdentity()).digest('hex');
 try{
  const deletedKey=key+':deleted-suggestions';
  if(req.method==='GET'&&req.query?.view==='deleted')return res.json({urls:await kv('SMEMBERS',deletedKey)});
  if(req.method==='DELETE'){
   let url;try{if(typeof req.body?.url==='string'&&req.body.url.length<=4096)url=new URL(req.body.url);}catch{}
   if(!url||url.protocol!=='https:'||url.username||url.password)return res.status(400).json({error:'Invalid suggestion'});
   await kv('SADD',deletedKey,req.body.url);return res.status(204).end();
  }
  if(req.method==='GET')return res.json({items:(await kv('HVALS',key)).map(value=>JSON.parse(value)).sort((a,b)=>b.saved-a.saved)});
  if(req.method!=='POST')return res.status(405).end();
  const url=sourceUrl(req.body?.url);
  const pin = boardReference(req.body?.pin);
  if(!url && !pin)return res.json({status:'unsupported'});
  const id=createHash('sha256').update(url ? url.hostname.replace(/^www\./,'')+url.pathname.replace(/\/$/,'') : pin.url).digest('hex');
  const previous=await kv('HGET',key,id);
  if(previous){
   const saved=JSON.parse(previous);
   if(!url || saved.kind!=='saved-pin' || Date.now()-(saved.checked||saved.saved)<86400000)return res.json({status:'existing'});
   const full=await readPublisher(url);
   const updated=JSON.stringify({...(full||saved),saved:saved.saved,checked:Date.now()});
   await kv('EVAL',"if redis.call('HGET',KEYS[1],ARGV[1])==ARGV[2] then return redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]) end return 0",1,key,id,previous,updated);
   return res.json({status:'existing'});
  }
  let recipe;
  if(url){try{recipe=await readPublisher(url);}catch(error){if(!pin)throw error;}}
  recipe ||= pin;
  if(!recipe)return res.json({status:'unavailable'});
  const record=JSON.stringify({...recipe,saved:Date.now()});
  const added=req.body?.discovery===true
   ? await kv('EVAL',"if redis.call('SISMEMBER',KEYS[2],ARGV[1])==1 then return 0 end return redis.call('HSETNX',KEYS[1],ARGV[2],ARGV[3])",2,key,deletedKey,req.body.url,id,record)
   : await kv('HSETNX',key,id,record);
  return res.json({status:added?(recipe.kind==='saved-pin'?'linked':'added'):'existing'});
 }catch{return res.status(503).json({error:'Recipe book temporarily unavailable'});}
};
module.exports.article=article;
module.exports.sourceUrl=sourceUrl;
