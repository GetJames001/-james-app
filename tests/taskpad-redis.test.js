const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),run=promisify(execFile);
const auth=require('../lib/auth.js'),handler=require('../api/tasks.js');

test('actual disposable Redis enforces Task Pad atomic races and preserves records after a lost response and corruption',
  {skip:!process.env.JAMES_TEST_REDIS_BIN,timeout:30000},async()=>{
  const binary=process.env.JAMES_TEST_REDIS_BIN,cli=path.join(path.dirname(binary),'redis-cli');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'james-taskpad-')),socket=path.join(dir,'redis.sock');
  const child=spawn(binary,['--port','0','--unixsocket',socket,'--save','','--appendonly','no','--dir',dir],{stdio:['ignore','pipe','pipe']});
  let server,loseReply=false,racing=false;const waiting=[];
  const keys=['JAMES_AUTH_EMAIL','JAMES_SESSION_SECRET','KV_REST_API_URL','KV_REST_API_TOKEN','VERCEL_ENV'];
  const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Fixture Redis startup timeout')),10000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture Redis exited'));});
      child.stdout.on('data',value=>{if(/ready to accept connections/i.test(value.toString())){clearTimeout(timer);resolve();}});
    });
    const redis=async parts=>JSON.parse((await run(cli,['-s',socket,'--json',...parts.map(String)])).stdout);
    server=http.createServer(async(req,res)=>{
      try{
        assert.equal(req.headers.authorization,'Bearer fictional-taskpad-token');
        let raw='';for await(const chunk of req)raw+=chunk;
        const parts=JSON.parse(raw);assert.ok(['GET','EVAL'].includes(parts[0]));
        assert.equal(parts[parts[0]==='GET'?1:3],'james:tasks');
        const result=await redis(parts);
        if(racing&&parts[0]==='GET'){
          await new Promise(resolve=>{waiting.push(resolve);if(waiting.length===2){racing=false;waiting.forEach(release=>release());}});
        }
        if(loseReply&&parts[0]==='EVAL'&&result===1){loseReply=false;res.destroy();return;}
        res.setHeader('content-type','application/json');res.end(JSON.stringify({result}));
      }catch{res.statusCode=503;res.end('{}');}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    process.env.JAMES_AUTH_EMAIL='fixture@example.test';
    process.env.JAMES_SESSION_SECRET='fictional-taskpad-session-secret-at-least-32-bytes';
    process.env.KV_REST_API_URL=`http://127.0.0.1:${server.address().port}`;
    process.env.KV_REST_API_TOKEN='fictional-taskpad-token';delete process.env.VERCEL_ENV;
    async function call(method='GET',body){
      const req={method,body,headers:{host:'www.getjames.ai',origin:'https://www.getjames.ai',cookie:`${auth.SESSION_COOKIE}=${auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}`}};
      const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
      await handler(req,res);return res;
    }
    const initial=(await call()).body;assert.deepEqual(initial.tasks,[]);
    racing=true;
    const race=await Promise.all(['A','B'].map(id=>call('POST',{revision:initial.revision,tasks:[{id,title:`Fictional ${id}`,extra:'preserve'}]})));
    assert.deepEqual(race.map(r=>r.code).sort(),[200,409]);
    const saved=(await call()).body;assert.equal(saved.tasks.length,1);assert.equal(saved.tasks[0].extra,'preserve');
    loseReply=true;
    const changed=[...saved.tasks,{id:'lost',title:'Fictional lost reply'}];
    const unknown=await call('POST',{revision:saved.revision,tasks:changed});assert.equal(unknown.code,503);
    assert.deepEqual((await call()).body.tasks,changed);
    assert.equal((await call('POST',{revision:saved.revision,tasks:changed})).code,409);
    assert.deepEqual(JSON.parse(await redis(['GET','james:tasks'])),changed);
    await redis(['SET','james:tasks','{corrupt-fixture']);
    assert.equal((await call()).code,503);assert.equal(await redis(['GET','james:tasks']),'{corrupt-fixture');
    assert.deepEqual(await redis(['KEYS','*']),['james:tasks']);
  }finally{
    waiting.forEach(release=>release());
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});
    fs.rmSync(dir,{recursive:true,force:true});
    keys.forEach(k=>{if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];});
  }
});
