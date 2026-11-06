'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('new orb is an explicitly allowed authenticated SVG and is included in the deployment',async()=>{
 const auth=require('../lib/auth.js'),gateway=require('../api/gateway.js');process.env.JAMES_AUTH_EMAIL='orb-fixture@example.test';process.env.JAMES_SESSION_SECRET='synthetic-orb-session-secret-123456789';
 function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(value){this.body=value;return this;},send(value){this.body=value;return this;}};}
 for(const loggedIn of [false,true]){const response=res();await gateway({method:'GET',headers:{host:'www.getjames.ai',...(loggedIn?{cookie:auth.SESSION_COOKIE+'='+auth.createSessionToken(process.env.JAMES_AUTH_EMAIL)}:{})},query:{path:'assets/orb/james-concierge.svg'}},response);assert.equal(response.code,loggedIn?200:401);if(loggedIn){assert.equal(response.headers['Content-Type'],'image/svg+xml');assert.match(response.body,/<svg/);assert.doesNotMatch(response.body,/<script|(?:href|src)=[\x22\x27]https?:|onload=/i);}}
 const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));assert.match(config.functions['api/gateway.js'].includeFiles,/assets\/orb\/\*\.svg/);assert.doesNotMatch(fs.readFileSync('index.html','utf8'),/class="orb-status"/);
});
