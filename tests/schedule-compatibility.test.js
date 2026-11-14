const test=require('node:test'),assert=require('node:assert/strict');
const config=require('../vercel.json');
const handler=require('../api/proof-schedule.js');

test('pilot declares only the quarter-hour private function and no public worker route',()=>{
  assert.deepEqual(config.functions['api/proof-schedule.js'].experimentalTriggers,[{type:'schedule/v1beta'}]);
  assert.equal(config.functions['api/proof-schedule.js'].maxDuration,15);
  assert.deepEqual(config.schedules,{'james-fictional-proof':{schedule:'*/15 * * * *',timezone:'UTC',jitter:1,function:'api/proof-schedule'}});assert.equal(config.crons,undefined);
  assert.deepEqual(config.routes,[{src:'^/(.*)$',dest:'/api/gateway?path=$1'}]);
});

test('disabled target rejects all methods and forged scheduler metadata without storage, secrets or actions',async()=>{
  const original=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;throw Error('External access is forbidden in this fixture');};
  try{
    for(const method of ['GET','POST','PUT','DELETE','HEAD']){
      const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
      await handler({method,headers:{'x-vercel-schedule-name':'fictional','authorization':'Bearer fictional'},body:{action:'tick',owner:'fictional'}},res);
      assert.equal(res.code,503);assert.deepEqual(res.body,{error:'HOSTED_PROOF_DISABLED'});
      assert.match(res.headers['Cache-Control'],/private, no-store/);
    }
    assert.equal(calls,0);
  }finally{global.fetch=original;}
});
