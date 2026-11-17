'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../lib/routes/speech.js');
const scope={accountId:'fixture',conversationId:'conversation-fixture',generation:1};
const env={ELEVENLABS_API_KEY:'synthetic-fixture-key',JAMES_ARCHER_ENABLED:'true'};
const request=()=>({method:'POST',headers:{'content-type':'application/json'},body:{scope:{...scope},text:'Use 6 cups of chicken broth.'}});
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};}
function setup(overrides={}){let calls=[];const handler=createHandler({authorize:()=>true,identity:()=>scope.accountId,store:{execute:async()=>({status:'ready',...scope})},env,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(new Uint8Array([73,68,51]),{headers:{'content-type':'audio/mpeg'}});},...overrides});return {handler,calls};}
test('Archer cannot incur speech usage without both connection and activation',async()=>{
 for(const config of [{},{ELEVENLABS_API_KEY:'fixture'},{JAMES_ARCHER_ENABLED:'true'}]){
  const {handler,calls}=setup({env:config}),response=res();await handler(request(),response);assert.equal(response.code,503);assert.equal(calls.length,0);
  const readiness=res();await handler({method:'GET'},readiness);assert.equal(readiness.body.ready,false);assert.equal(JSON.stringify(readiness.body).includes('fixture'),false);
 }
});
test('Archer preserves exact text, uses a fixed voice, keeps credentials server-side and requires current scope',async()=>{
 const {handler,calls}=setup(),response=res();await handler(request(),response);assert.equal(response.code,200);assert.equal(response.headers['Content-Type'],'audio/mpeg');
 assert.match(calls[0].url,/Fahco4VZzobUeiPqni1S\/stream\?output_format=mp3_44100_128$/);assert.equal(calls[0].options.headers['xi-api-key'],env.ELEVENLABS_API_KEY);assert.equal(JSON.parse(calls[0].options.body).text,request().body.text);
 const stale=request();stale.body.scope.generation=2;const rejected=res();await handler(stale,rejected);assert.equal(rejected.code,409);assert.equal(calls.length,1);
 const huge=request();huge.body.text='x'.repeat(12001);const invalid=res();await handler(huge,invalid);assert.equal(invalid.code,400);assert.equal(calls.length,1);
});
test('unauthorized callers, malformed audio, provider denial and unexpected bodies are rejected without leaked details',async()=>{
 const denied=setup({authorize:()=>false});await denied.handler(request(),res());assert.equal(denied.calls.length,0);
 for(const upstream of [new Response('private error',{status:403}),new Response('<html>not audio</html>',{headers:{'content-type':'text/html'}})]){
  const {handler}=setup({fetchImpl:async()=>upstream}),response=res();await handler(request(),response);assert.equal(response.code,502);assert.equal(JSON.stringify(response.body).includes('private'),false);
 }
 const {handler,calls}=setup(),bad=request();bad.body.voice='other';const response=res();await handler(bad,response);assert.equal(response.code,400);assert.equal(calls.length,0);
});
