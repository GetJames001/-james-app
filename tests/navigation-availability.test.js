const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const code=source.slice(source.indexOf('function page(id)'),source.indexOf('function panel('));
function harness({storageFails=false}={}){
 const effects=[];const nodes=['briefing','personalMail','attention','tasks'].map(id=>({id,active:id==='briefing',classList:{toggle(k,v){nodes.find(n=>n.id===id).active=v;}}}));
 const ctx={$$:q=>q==='.page'?nodes:[],sessionStorage:{setItem(k,v){if(storageFails)throw Error('storage denied');effects.push(['save',v]);}},openAttentionSavedView:()=>effects.push(['attention']),clearAttentionSavedView:()=>effects.push(['clear']),scheduleCalendarRelayout:()=>{},renderAppointmentView:()=>{},personalMailRefreshController:{pageChanged:()=>effects.push(['mail'])},calendarRefreshController:{pageChanged:()=>effects.push(['calendar'])}};
 vm.createContext(ctx);vm.runInContext(code,ctx);return {open:ctx.page,nodes,effects};
}
test('unmounted wardrobe and Workbench doors do not clear or navigate current page',()=>{const h=harness();for(const name of ['wardrobe','workbench','saved_looks','missing',null,{}]){assert.equal(h.open(name).status,'unavailable');assert.equal(h.nodes.find(n=>n.active).id,'briefing');}assert.deepEqual(h.effects,[]);});
test('available Attention and Mail doors report success only after page selection',()=>{const h=harness();assert.equal(h.open('attention').status,'opened');assert.equal(h.nodes.find(n=>n.active).id,'attention');assert.equal(h.open('personalMail').status,'opened');assert.equal(h.nodes.find(n=>n.active).id,'personalMail');assert.equal(h.effects.filter(x=>x[0]==='mail').length,2);});
test('storage denial cannot prevent valid navigation',()=>{const h=harness({storageFails:true});assert.equal(h.open('tasks').status,'opened');assert.equal(h.nodes.find(n=>n.active).id,'tasks');});
test('failed door request preserves current Attention session',()=>{const h=harness();h.open('attention');const before=h.effects.length;assert.equal(h.open('wardrobe').status,'unavailable');assert.equal(h.nodes.find(n=>n.active).id,'attention');assert.equal(h.effects.length,before);});
