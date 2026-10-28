const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../lib/routes/workbench.js');
const {createStorage,CAS}=require('../lib/workbench/storage.cjs');
const auth=require('../lib/auth.js');
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(body){this.body=body;return this}}}
function memory(){const data=new Map(),commands=[];return {data,commands,store:createStorage({url:'https://fixture.invalid',token:'fictional',fetchImpl:async(_,o)=>{const c=JSON.parse(o.body);commands.push(c);let result;if(c[0]==='GET')result=data.get(c[1])??null;else{assert.equal(c[1],CAS);const old=data.get(c[3])??null;result=(c[4]==='absent'?old===null:old===c[5])?1:0;if(result)data.set(c[3],c[6]);}return new Response(JSON.stringify({result}));}})}}
test('Workbench current-host auth, atomic save, exact replay, conflict and isolated namespace',async()=>{
 const {createProject}=await import('../workbench/core.js');
 const h=memory(),handler=createHandler({store:h.store,authorize:()=>true,identity:()=> 'owner-a'});
 const call=async(method,body)=>{const r=response();await handler({method,body,query:{},headers:{'content-type':'application/json'}},r);return r};
 assert.equal((await call('GET')).body.accountId,'owner-a');
 const project=createProject({id:'qa-project',accountId:'owner-a',title:'Fictional project'});
 const command={action:'save',accountId:'owner-a',accountGeneration:1,operationId:'save-1',expectedRevision:0,project};
 const saved=await call('POST',command);assert.equal(saved.code,200);assert.equal(saved.body.status,'succeeded');assert.equal(saved.body.project.revision,1);
 assert.deepEqual((await call('POST',command)).body,saved.body);
 assert.equal((await call('POST',{...command,project:{...project,title:'Changed payload'}})).code,409);
 assert.equal((await call('POST',{...command,operationId:'save-2'})).body.status,'conflict');
 const loaded=await call('POST',{action:'load',accountId:'owner-a',accountGeneration:1,id:'qa-project'});assert.equal(loaded.body.project.title,'Fictional project');
 assert.equal((await call('POST',{...command,accountId:'owner-b'})).code,403);
 assert.equal(await h.store.load('owner-b'),null);
 assert.ok(h.commands.every(c=>c[c[0]==='GET'?1:3].startsWith('james:workbench:v1:')));
});
test('Workbench ignores forged Sites identity, requires James session and rejects foreign origin before storage',async()=>{
 const old={...process.env};process.env.JAMES_AUTH_EMAIL='qa@example.test';process.env.JAMES_SESSION_SECRET='fictional-secret-'.repeat(4);let reads=0;
 try{const handler=createHandler({store:{load:async()=>{reads++;return null}}});const headers={host:'getjames.ai',origin:'https://getjames.ai','content-type':'application/json','oai-authenticated-user-id':'qa@example.test'};
 const call=async(h,method='GET')=>{const r=response();await handler({method,headers:h,query:{},body:{}},r);return r};
 assert.equal((await call(headers)).code,401);assert.equal(reads,0);
 headers.cookie=`${auth.SESSION_COOKIE}=${auth.createSessionToken('qa@example.test')}`;
 assert.equal((await call({...headers,origin:'https://foreign.invalid'},'POST')).code,403);assert.equal(reads,0);
 assert.equal((await call(headers)).body.accountId,'qa@example.test');
 }finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)}
});
test('Workbench unavailable storage fails without private error leakage',async()=>{
 const handler=createHandler({store:{load:async()=>{throw Error('private credential')}},authorize:()=>true,identity:()=> 'owner'});
 const r=response();await handler({method:'POST',headers:{'content-type':'application/json'},body:{action:'list',accountId:'owner',accountGeneration:1}},r);
 assert.equal(r.code,503);assert.doesNotMatch(JSON.stringify(r.body),/private credential/);
});
