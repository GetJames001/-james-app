'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),run=promisify(execFile);
const {createStorage}=require('../lib/task-execution/storage.cjs'),{createLedger,scopedKey}=require('../lib/task-execution/ledger.cjs');
const fixture=require('./fixtures/task-execution/inputs.json');
test('disposable real Redis task adapter: atomic race, reload, scoped owners, lost reply, corrupt data and outage',{skip:!process.env.JAMES_TEST_REDIS_BIN,timeout:25000},async()=>{
 const binary=process.env.JAMES_TEST_REDIS_BIN,cli=path.join(path.dirname(binary),'redis-cli'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'james-task-redis-'));
 const probe=require('node:net').createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(binary,['--bind','127.0.0.1','--port',String(port),'--save','','--appendonly','no','--dir',dir],{stdio:['ignore','pipe','pipe']});let server,loseReply=false;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture Redis startup timeout')),10000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture Redis exited'));});child.stdout.on('data',value=>{if(/ready to accept connections/i.test(value.toString())){clearTimeout(timer);resolve();}});});
  const redis=async parts=>JSON.parse((await run(cli,['-h','127.0.0.1','-p',String(port),'--json',...parts.map(String)])).stdout);
  server=http.createServer((req,res)=>{let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',async()=>{
   try{assert.equal(req.headers.authorization,'Bearer synthetic-task-test');const c=JSON.parse(raw);assert.match(c[c[0]==='GET'?1:3],/^james:task-execution:v1:[a-f0-9]{64}$/);const result=await redis(c);
    if(loseReply&&c[0]==='EVAL'&&result===1){loseReply=false;res.destroy();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));
   }catch{res.statusCode=503;res.end('{}');}
  });});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const options={url:'http://127.0.0.1:'+server.address().port,token:'synthetic-task-test'},ledger=createLedger(createStorage(options));
  const create=id=>({type:'create',operationId:'create-'+id,taskId:id,expectedRevision:0,kind:'agenda_fixture',objective:'Fictional agenda',input:fixture.agenda,budget:fixture.budget,requiresApproval:false});
  const command=create('agenda'),race=await Promise.all([ledger.execute('fictional-owner-a',command),createLedger(createStorage(options)).execute('fictional-owner-a',command)]);
  assert.equal(race.filter(r=>r.replayed).length,1);assert.equal((await ledger.snapshot('fictional-owner-a')).tasks.length,1);assert.equal((await ledger.snapshot('fictional-owner-b')).tasks.length,0);
  loseReply=true;const lost=create('lost-reply');await assert.rejects(()=>ledger.execute('fictional-owner-a',lost));assert.equal((await ledger.execute('fictional-owner-a',lost)).replayed,true);assert.equal((await ledger.snapshot('fictional-owner-a')).tasks.length,2);
  await redis(['SET',scopedKey('corrupt-owner'),'not-json']);await assert.rejects(()=>ledger.snapshot('corrupt-owner'),/CORRUPT_LEDGER/);assert.equal(await redis(['GET',scopedKey('corrupt-owner')]),'not-json');
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});await assert.rejects(()=>ledger.snapshot('fictional-owner-a'),/TASK_STORAGE_UNAVAILABLE/);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');fs.rmSync(dir,{recursive:true,force:true});}
});
