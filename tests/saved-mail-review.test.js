'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const gateway=require('../api/gateway.js'),auth=require('../lib/auth.js');
const {collectReview,projectReview,decideReview}=require('../lib/attention/mail-review.cjs');

test('saved review survives login and resolves only the current owner and message version',async t=>{
  const owner='fixture@example.test',at='2026-11-14T18:00:00Z';
  process.env.JAMES_AUTH_EMAIL=owner;
  process.env.JAMES_SESSION_SECRET='fictional-saved-review-test-key-2026';
  process.env.KV_REST_API_URL='https://fixture.invalid';
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const accountId='owner:'+digest(owner);
  let snapshot={accountId,schemaVersion:1,revision:1,...collectReview(null,accountId,[{id:'one',subject:'Interview invitation <example>'},{id:'two',subject:'Your invoice is overdue'}],at)};
  const item=projectReview(snapshot).items[0],path='review/mail/'+item.reviewKey;
  let reads=0,offline=false;
  t.mock.method(global,'fetch',async(_url,options)=>{
    reads++;
    const [op,key]=JSON.parse(options.body);assert.equal(op,'GET');
    if(offline)throw Error();
    return Response.json({result:key==='james:attention:v1:'+digest(accountId)?JSON.stringify(snapshot):null});
  });
  async function open(path,signedIn){
    const headers={host:'www.getjames.ai'};
    if(signedIn)headers.cookie=auth.SESSION_COOKIE+'='+auth.createSessionToken(process.env.JAMES_AUTH_EMAIL);
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},end(){return this;},send(body){this.body=body;return this;},json(body){this.body=body;return this;}};
    await gateway({method:'GET',headers,query:{path}},res);return res;
  }
  const login=await open(path,false);assert.equal(login.code,302);assert.equal(reads,0);
  const target=new URL(login.headers.Location,'https://www.getjames.ai');
  const html=fs.readFileSync('login.html','utf8');
  const handoff=html.slice(html.indexOf('        const reviewKey='),html.indexOf('        // Load the authenticated application'));
  let destination;vm.runInNewContext('(function(){'+handoff+'})()',{URLSearchParams,location:{search:target.search,replace:value=>destination=value}});
  assert.equal(destination,'/'+path);
  const result=await open(path,true);assert.equal(result.code,200);assert.equal(result.headers['X-James-Review-State'],'ready');assert.match(result.body,/Interview invitation &lt;example&gt;/);assert.doesNotMatch(result.body,/invoice is overdue/);
  snapshot={...snapshot,...decideReview(snapshot,item.reviewKey,'handled',at)};
  const handled=await open(path,true);assert.match(handled.body,/already handled/);assert.equal(handled.headers['X-James-Review-State'],'handled');
  process.env.JAMES_AUTH_EMAIL='other@example.test';assert.equal((await open(path,true)).code,404);
  offline=true;assert.equal((await open(path,true)).code,503);
});
