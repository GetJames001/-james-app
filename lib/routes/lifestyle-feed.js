'use strict';
const {SaxesParser}=require('saxes');
const {requireAuth,privateNoStore}=require('../auth.js');
const sources=new Map([
 ['recipes',['Budget Bytes','https://www.budgetbytes.com/feed/','budgetbytes.com']],
 ['business',['PBS News','https://www.pbs.org/newshour/feeds/rss/headlines','pbs.org']],
 ['life',['NPR Life Kit','https://feeds.npr.org/510338/podcast.xml','npr.org']]
]);
const cache=new Map();
function allowedUrl(value,hosts){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null;}catch{return null;}
}
async function readFeed(source,limit=6){
 const [publisher,url,...hosts]=source;
 const imageHosts=[...hosts,...(publisher==='PBS News'?['pbs.twimg.com','d3i6fh83elv35t.cloudfront.net']:[]),...(publisher==='NPR Life Kit'?['nprstatic.org']:[])];
 const photoUrl=value=>allowedUrl(String(value||'').replace(/^http:/i,'https:'),imageHosts);
 const response=await fetch(url,{signal:AbortSignal.timeout(9000),redirect:'error'});
 if(!response.ok||!response.body)throw Error('Feed unavailable');
 const items=[],stack=[],parser=new SaxesParser(),decoder=new TextDecoder();
 let item=null,field='',bytes=0;
 parser.on('doctype',()=>{throw Error('Invalid feed');});
 parser.on('opentag',tag=>{
  const parent=stack.at(-1);stack.push(tag.name);
  if(tag.name==='item'&&['channel','rdf:RDF'].includes(parent))item={title:'',link:'',description:'', 'content:encoded':''};
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
    const summary=item.description.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().slice(0,600);
    if(publisher!=='PBS News'||(photo && /^\/newshour\/(economy|nation|world|politics|health|science|arts|education)\/[^/]+/.test(new URL(link).pathname)))items.push({title:item.title.trim().slice(0,160),url:link,photo,summary});
   }
   item=null;
  }
 });
 const reader=response.body.getReader();
 try{
  while(items.length<limit){
   const {done,value}=await reader.read();
   if(done){parser.write(decoder.decode()).close();break;}
   bytes+=value.byteLength;if(bytes>1536*1024)throw Error('Feed too large');
   parser.write(decoder.decode(value,{stream:true}));
  }
 }finally{await reader.cancel();}
 if(!items.length)throw Error('No stories');
 return {publisher,items:items.slice(0,limit)};
}
const subjects=new Map([['sales-books','selling'],['business-books','business'],['life-books','self-help']]);
async function readBooks(key){
 const year=new Date().getFullYear();
 const query=new URLSearchParams({q:'subject:'+subjects.get(key)+' AND first_publish_year:['+(year-5)+' TO '+year+']',sort:'new',language:'eng',limit:'12',fields:'key,title,author_name,first_publish_year,cover_i'});
 const response=await fetch('https://openlibrary.org/search.json?'+query,{signal:AbortSignal.timeout(9000),headers:{'User-Agent':'James-Lifestyle/1.0 (https://getjames.ai)'}});
 if(!response.ok)throw Error('Catalogue unavailable');
 const data=await response.json();
 const items=(data.docs||[]).filter(book=>/^\/works\/OL\d+W$/.test(book.key)&&book.title).slice(0,4).map(book=>({
  title:book.title,url:'https://openlibrary.org'+book.key,author:(book.author_name||[]).slice(0,2).join(', '),
  year:book.first_publish_year,photo:Number.isSafeInteger(book.cover_i)?'https://covers.openlibrary.org/b/id/'+book.cover_i+'-M.jpg':null
 }));
 if(!items.length)throw Error('No books');
 return {publisher:'Open Library',items};
}
async function citySights(city){
 const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',titles:city,prop:'revisions',rvslots:'main',rvprop:'content',redirects:'1'});
 const response=await fetch('https://en.wikivoyage.org/w/api.php?'+params,{signal:AbortSignal.timeout(7000),headers:{'User-Agent':'JamesTravel/1.0 (https://getjames.ai)'}});
 if(!response.ok)throw Error();
 const json=await response.json(),guide=json.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content||'';
 const sights=[];
 for(const match of guide.matchAll(/\{\{see\s*\|[^{}]{0,1200}?\bname\s*=\s*([^|}\n]+)/gi)){
  const name=match[1].replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g,'$2').trim();
  if(name&&name.length<=100&&!/[<>{}]/.test(name)&&!sights.includes(name))sights.push(name);
  if(sights.length===3)break;
 }
 return {items:sights};
}
module.exports=async(req,res)=>{
 privateNoStore(res);if(!requireAuth(req,res))return;
 if(req.method!=='GET')return res.status(405).end();
 const key=req.query.source;
 if(key==='sights'){
  const city=req.query.city;
  if(typeof city!=='string'||!city.trim()||city.length>100)return res.status(400).json({error:'Invalid city'});
  try{return res.json(await citySights(city));}catch{return res.status(503).json({error:'Guide unavailable'});}
 }
 const source=sources.get(key);if(!source&&!subjects.has(key))return res.status(400).json({error:'Unknown feed'});
 const saved=cache.get(key);if(saved&&Date.now()-saved.time<900000)return res.json(saved.data);
 try{const data=subjects.has(key)?await readBooks(key):await readFeed(source);cache.set(key,{data,time:Date.now()});return res.json(data);}
 catch{return res.status(503).json({error:'Feed unavailable'});}
};


module.exports.readFeed=readFeed;
