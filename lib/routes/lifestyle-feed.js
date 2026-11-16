'use strict';
const {SaxesParser}=require('saxes');
const {requireAuth,privateNoStore}=require('../auth.js');
const sources=new Map([
 ['recipes',['Budget Bytes','https://www.budgetbytes.com/feed/','budgetbytes.com']],
 ['business',['BBC Business','https://feeds.bbci.co.uk/news/business/rss.xml','bbc.com','bbc.co.uk']],
 ['life',['NPR Life Kit','https://feeds.npr.org/510338/podcast.xml','npr.org']]
]);
const cache=new Map();
function allowedUrl(value,hosts){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null;}catch{return null;}
}
async function readFeed(source){
 const [publisher,url,...hosts]=source;
 const imageHosts=[...hosts,...(publisher==='BBC Business'?['bbci.co.uk']:publisher==='NPR Life Kit'?['nprstatic.org']:[])];
 const photoUrl=value=>allowedUrl(String(value||'').replace(/^http:/i,'https:'),imageHosts);
 const response=await fetch(url,{signal:AbortSignal.timeout(9000),redirect:'error'});
 if(!response.ok||!response.body)throw Error('Feed unavailable');
 const items=[],stack=[],parser=new SaxesParser(),decoder=new TextDecoder();
 let item=null,field='',bytes=0;
 parser.on('doctype',()=>{throw Error('Invalid feed');});
 parser.on('opentag',tag=>{
  const parent=stack.at(-1);stack.push(tag.name);
  if(tag.name==='item'&&parent==='channel')item={title:'',link:'',description:'', 'content:encoded':''};
  if(item&&['media:thumbnail','itunes:image','media:content','enclosure'].includes(tag.name)){
   const attrs=tag.attributes;
   if(['media:thumbnail','itunes:image'].includes(tag.name)||attrs.medium==='image'||String(attrs.type).startsWith('image/')){
    item.photo ||= photoUrl(attrs.url||attrs.href);
   }
  }
  if(item&&parent==='item'&&['title','link','description','content:encoded'].includes(tag.name))field=tag.name;
 });
 const append=text=>{if(item&&field)item[field]=(item[field]+text).slice(0,4096);};
 parser.on('text',append);parser.on('cdata',append);
 parser.on('closetag',tag=>{
  stack.pop();if(tag.name===field)field='';
  if(tag.name==='item'&&item){
   const link=allowedUrl(item.link.trim(),hosts);
   if(link&&item.title.trim()&&!items.some(row=>row.url===link)){
    const html=item['content:encoded']||item.description;
    const photo=item.photo||photoUrl(html.match(/<img[^>]+\bsrc=["']([^"']+)["']/i)?.[1]);
    const summary=item.description.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().slice(0,180);
    items.push({title:item.title.trim().slice(0,160),url:link,photo,summary});
   }
   item=null;
  }
 });
 const reader=response.body.getReader();
 try{
  while(items.length<6){
   const {done,value}=await reader.read();
   if(done){parser.write(decoder.decode()).close();break;}
   bytes+=value.byteLength;if(bytes>1536*1024)throw Error('Feed too large');
   parser.write(decoder.decode(value,{stream:true}));
  }
 }finally{await reader.cancel();}
 if(!items.length)throw Error('No stories');
 return {publisher,items:items.slice(0,6)};
}
module.exports=async(req,res)=>{
 privateNoStore(res);if(!requireAuth(req,res))return;
 if(req.method!=='GET')return res.status(405).end();
 const key=req.query.source,source=sources.get(key);if(!source)return res.status(400).json({error:'Unknown feed'});
 const saved=cache.get(key);if(saved&&Date.now()-saved.time<900000)return res.json(saved.data);
 try{const data=await readFeed(source);cache.set(key,{data,time:Date.now()});return res.json(data);}
 catch{return res.status(503).json({error:'Feed unavailable'});}
};
