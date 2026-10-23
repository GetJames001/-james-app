'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const gateway=require('../api/gateway.js'),login=require('../lib/routes/login-page.js');
function res(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},send(body){this.body=body;return this},json(body){this.body=body;return this},end(){return this}};}
test('only exact decorative sign-in artwork routes are public; app files and private APIs remain protected',async()=>{
 for(const route of ['login-art-dark.png','login-art-light.png']){const r=res();await gateway({method:'GET',headers:{host:'www.getjames.ai'},query:{path:route}},r);assert.equal(r.statusCode,200);assert.equal(r.headers['Content-Type'],'image/png');assert.ok(Buffer.isBuffer(r.body));assert.equal(r.body.subarray(1,4).toString(),'PNG');assert.match(r.headers['Cache-Control'],/no-store/);}
 for(const route of ['assets/welcome-dark.png','app.js','api/customer-activity','login-art-other.png']){const r=res();await gateway({method:'GET',headers:{host:'www.getjames.ai'},query:{path:route}},r);assert.equal(r.statusCode,401);assert.equal(Buffer.isBuffer(r.body),false);}
 for(const method of ['POST','PUT']){const r=res();await gateway({method,headers:{host:'www.getjames.ai'},query:{path:'login-art-dark.png'}},r);assert.equal(r.statusCode,405);}
 const hostile=res();await login.artwork({method:'GET',headers:{host:'attacker.example'}},hostile,'login-art-dark.png');assert.equal(hostile.statusCode,403);
});
