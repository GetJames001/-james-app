'use strict';
// Isolated fictional browser acceptance. No credentials, provider calls or disk writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {fixture,candidate}=require('../tests/helpers/travel-link-fixture.cjs');
const {createStore}=require('../lib/travel/mail-trip-store.cjs');
const db=fixture(),root=path.resolve(__dirname,'..'),before=[db.files.get(db.oregon),db.files.get('bytes:'+db.oregon)];let applied=false;
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'none'; frame-src 'none'; form-action 'self'");
 if(u.pathname==='/qa'){
  res.setHeader('Content-Type','text/html');return res.end('<!doctype html><h1>Isolated trip-link check</h1><p>Fictional records only.</p><p><a href="/#travel/'+db.chicago+'">Original Briefing trip link</a></p><form method="post" action="/qa/update"><button>Add fictional pickup</button></form><p>Pickup applied: '+applied+'</p><p>Oregon unchanged: '+(JSON.stringify(before)===JSON.stringify([db.files.get(db.oregon),db.files.get('bytes:'+db.oregon)]))+'</p><p>Trip records: '+[...db.files.keys()].filter(id=>/^[a-f0-9]{64}$/.test(id)).length+'</p>');
 }
 if(u.pathname==='/qa/update'&&req.method==='POST'){
  const store=createStore({command:db.command,environment:'preview'});await store.upsert('qa@example.invalid',candidate);await store.upsert('qa@example.invalid',{...candidate,at:2,values:{start:candidate.values.start,destination:'Chicago',pickup:'Terminal 2'}});applied=true;res.writeHead(303,{Location:'/qa'});return res.end();
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return json(res,{error:'READ_ONLY_FIXTURE'},405);
 if(u.pathname==='/api/james/files'){
  const id=u.searchParams.get('id');if(id)return db.files.has(id)?json(res,{file:{...JSON.parse(db.files.get(id)),content:db.files.get('bytes:'+id)}}):json(res,{error:'FILE_NOT_FOUND'},404);
  return json(res,{files:[...db.files].filter(([id])=>/^[a-f0-9]{64}$/.test(id)).map(([,meta])=>JSON.parse(meta))});
 }
 if(u.pathname==='/api/auth/session')return json(res,{ok:true,authenticated:true});
 if(u.pathname.startsWith('/api/'))return json(res,{connected:false,messages:[],tasks:[],events:[],unreadCount:0});
 const name=u.pathname==='/'?'index.html':u.pathname.slice(1);if(name.split('/').some(part=>part.startsWith('.'))||!/^[-a-zA-Z0-9_/.]+$/.test(name))return json(res,{},404);
 const f=path.join(root,name);if(!fs.existsSync(f)||!fs.statSync(f).isFile())return json(res,{},404);
 const types={'.js':'application/javascript','.mjs':'application/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};res.setHeader('Content-Type',types[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);
}).listen(Number(process.env.PORT||4173),'0.0.0.0');
