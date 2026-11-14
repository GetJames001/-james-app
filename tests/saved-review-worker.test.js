'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('saved review worker verifies eligibility and opens only the matching local result',async()=>{
  const key='a'.repeat(64),url='https://fixture.test/review/mail/'+key;
  const listeners={},shown=[],opened=[],receipts=[];
  let state='handled',requests=0;
  const self={
    location:{origin:'https://fixture.test'},addEventListener:(name,fn)=>listeners[name]=fn,
    registration:{getNotifications:async()=>shown,showNotification:async(title,options)=>shown.push({title,...options})},
    clients:{openWindow:async href=>opened.push(href)}
  };
  const fetch=async(href,options)=>{
    if(href==='/api/attention/alert'){receipts.push(JSON.parse(options.body).action);return {ok:true};}
    requests++;assert.equal(href,url);assert.equal(options.method,'HEAD');assert.equal(options.redirect,'error');
    return {ok:true,headers:{get:()=>state}};
  };
  vm.runInNewContext(fs.readFileSync('saved-review-worker.js','utf8'),{self,URL,fetch});
  function push(message){let work;listeners.push({data:{json:()=>message},waitUntil:p=>work=p});return work;}
  await push({kind:'saved-mail-review',key:'https://elsewhere.invalid'});assert.equal(requests,0);
  const message={kind:'saved-mail-review',key,url:'https://elsewhere.invalid',subject:'Private'};
  await push(message);assert.equal(shown.length,0);
  state='ready';await Promise.all([push(message),push(message)]);assert.equal(shown.length,1);assert.doesNotMatch(JSON.stringify(shown),/Private|elsewhere/);
  let work;listeners.notificationclick({notification:{data:shown[0].data,close(){}},waitUntil:p=>work=p});await work;assert.deepEqual(opened,[url]);assert.deepEqual(receipts,['shown','opened']);
});
