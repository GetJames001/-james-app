const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','login.html'),'utf8');
const start=html.indexOf('        const appScriptPaths = new Set(');
const end=html.indexOf('        // Fetch only authenticated, allowlisted assets concurrently.',start);
assert.ok(start>=0&&end>start,'actual login loader policy must exist');
const policy=html.slice(start,end)+'\nresult=scripts;';
function select(entries){const context={URL,location:{origin:'https://james.test'},parsed:{body:{querySelectorAll:()=>entries.map(x=>({getAttribute:k=>x[k]??null,textContent:x.text??''}))}}};vm.runInNewContext(policy,context);return JSON.parse(JSON.stringify(context.result));}
test('hosting feedback and injected inline scripts cannot block app bootstrap',()=>{
 const chosen=select([{src:'mail-refresh.js'},{src:'https://vercel.live/_next-live/feedback/feedback.js'},{src:'app.js'},{text:'throw new Error("optional instrumentation")'},{src:'/workbench/host.mjs',type:'module'}]);
 assert.deepEqual(chosen,[{src:'/mail-refresh.js',type:null},{src:'/app.js',type:null},{src:'/workbench/host.mjs',type:'module'}]);
});
test('only known same-origin clean script paths are accepted',()=>{
 assert.deepEqual(select([{src:'https://evil.test/app.js'},{src:'//evil.test/app.js'},{src:'/api/private'},{src:'/app.js?instrument=1'},{src:'/app.js#optional'},{src:'data:text/javascript,alert(1)'},{src:'https://james.test/calendar-sync.js'}]),[{src:'/calendar-sync.js',type:null}]);
});
test('every application script participates in the login handoff in actual document order',()=>{
 const index=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
 const body=index.slice(index.indexOf('<body'));
 const paths=[...body.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match=>match[1].replace(/^\//,''));
 const chosen=select(paths.map(src=>({src,type:src.endsWith('.mjs')?'module':null})));
 assert.deepEqual(chosen.map(x=>x.src),paths.map(x=>'/'+x));
 assert.equal(chosen.at(-1).type,'module');
});
test('retained login CSP still excludes external script origins',()=>{
 const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
 assert.match(csp,/script-src 'self' 'unsafe-inline';/);
 assert.ok(!csp.includes('vercel.live'));
});
