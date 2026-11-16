'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const handler=require('../lib/routes/lifestyle-feed.js'), auth=require('../lib/auth.js');
test('publisher feed returns safe titled recipe links and preserves the source',async()=>{
 process.env.JAMES_AUTH_EMAIL='reader@example.test';process.env.JAMES_SESSION_SECRET='fictional-lifestyle-session-secret';
 const original=global.fetch,calls=[];
 global.fetch=async url=>{calls.push(url);return new Response('<rss><channel><item><title>Roasted peppers</title><link>https://www.budgetbytes.com/peppers/</link><description><![CDATA[<img src="https://www.budgetbytes.com/peppers.jpg">A simple side.]]></description></item><item><title>Other site</title><link>https://example.org/</link></item></channel></rss>');};
 try{
  const res={setHeader(){},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
  await handler({method:'GET',headers:{host:'www.getjames.ai',cookie:auth.SESSION_COOKIE+'='+auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)},query:{source:'recipes'}},res);
  assert.equal(res.data.publisher,'Budget Bytes');assert.equal(res.data.items.length,1);
  assert.equal(res.data.items[0].photo,'https://www.budgetbytes.com/peppers.jpg');
  assert.deepEqual(calls,['https://www.budgetbytes.com/feed/']);
 }finally{global.fetch=original;}
});
