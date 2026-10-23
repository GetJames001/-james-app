'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
const {createStorage}=require('../lib/customer-activity/storage.cjs');
const {scopedKey}=require('../lib/customer-activity/records.cjs');
// Explicit disposable local binaries only. Never uses live KV credentials.
test('real disposable Redis: REST adapter, atomic races, reload, account isolation, corrupt data and lost reply',{skip:!process.env.JAMES_TEST_REDIS_BIN},async()=>{
 const binary=process.env.JAMES_TEST_REDIS_BIN,cli=path.join(path.dirname(binary),'redis-cli');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'james-redis-')),socket=path.join(dir,'redis.sock');
 const probe=require('node:net').createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(binary,['--bind','127.0.0.1','--port',String(port),'--save','','--appendonly','no','--dir',dir],{stdio:['ignore','pipe','pipe']});
 let server;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Redis startup timeout')),10000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',()=>{clearTimeout(timer);reject(new Error('Redis exited'));});child.stdout.on('data',data=>{if(/ready to accept connections/i.test(data.toString())){clearTimeout(timer);resolve();}});});
  const redis=async parts=>JSON.parse((await run(cli,['-h','127.0.0.1','-p',String(port),'--json',...parts.map(String)])).stdout);
  let loseReply=false;
  server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',async()=>{
   try{assert.equal(req.headers.authorization,'Bearer disposable-test');const parts=JSON.parse(raw);const key=parts[parts[0]==='GET'?1:3];assert.match(key,/^james:customer-activity:v1:/);const result=await redis(parts);
    if(loseReply&&parts[0]==='EVAL'){loseReply=false;res.destroy();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));
   }catch{res.statusCode=503;res.end('{}');}
  });});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const options={url:'http://127.0.0.1:'+server.address().port,token:'disposable-test'},store=createStorage(options),owner='fictional-a';
  const customer={id:'c1',name:'Fictional customer'};
  assert.equal((await store.commit(owner,{type:'upsert_customer',expectedRevision:0,customer})).ok,true);
  const activity={id:'a1',customerId:'c1',occurredAt:'2026-10-20T12:00:00.000Z',outcome:'attempted',notes:'No contact'};
  const race=await Promise.all([store.commit(owner,{type:'record_activity',expectedRevision:1,activity}),store.commit(owner,{type:'record_activity',expectedRevision:1,activity:{...activity,id:'a2'}})]);
  assert.equal(race.filter(x=>x.ok).length,1);
  assert.equal((await createStorage(options).load(owner)).activities.length,1);
  assert.equal((await store.load('fictional-b')).customers.length,0);
  loseReply=true;await assert.rejects(()=>store.commit(owner,{type:'record_activity',expectedRevision:2,activity:{...activity,id:'lost-reply'}}));
  assert.equal((await store.load(owner)).activities.filter(a=>a.id==='lost-reply').length,1,'reload can confirm a committed write after its reply was lost');
  await redis(['SET',scopedKey('corrupt'),'not-json']);
  await assert.rejects(()=>store.commit('corrupt',{type:'upsert_customer',expectedRevision:0,customer}));
  assert.equal(await redis(['GET',scopedKey('corrupt')]),'not-json');
  await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});
  await assert.rejects(()=>store.load(owner),'outage must not look like an empty customer list');
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(child.exitCode===null)child.kill('SIGTERM');fs.rmSync(dir,{recursive:true,force:true});}
});
