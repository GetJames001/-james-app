const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
test('Wardrobe launch saves Lifestyle first and sends only origin, not private query or path',()=>{
 const events=[];
 const context={URL,pageNow:id=>events.push(['page',id]),window:{location:{origin:'https://james.example',pathname:'/private',search:'?secret=hidden',assign:url=>events.push(['navigate',url])}}};
 vm.runInNewContext(source.slice(source.indexOf('function openWardrobe(){'),source.indexOf('function pageNow(id){'))+'\nopenWardrobe();',context);
 assert.equal(events[0][0],'page');assert.equal(events[0][1],'lifestyle');
 const target=new URL(events[1][1]);
 assert.equal(target.origin,'https://aaru-working-review.aglow-ox-8353.chatgpt.site');
 assert.equal(target.pathname,'/wardrobe');
 assert.equal(target.searchParams.get('returnTo'),'https://james.example/#lifestyle');
 assert.equal(events.length,2);
});
test('All main Wardrobe entry points use common direct navigation, never a new tab',()=>{
 assert.match(source,/if\(id === 'wardrobe'\)\{openWardrobe\(\);return;\}/);
 assert.match(html,/<button[^>]*class="mag-tile"[^>]*data-action-page="wardrobe"/);
 assert.match(html,/data-page="wardrobe"/);
 assert.doesNotMatch(html,/href="https:\/\/aaru-working-review[^\"]*\/wardrobe"/);
 assert.doesNotMatch(html,/Wardrobe <span>\(new tab\)/);
});
