'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const scope={accountId:'account-fixture',conversationId:'conversation-fixture',generation:1,status:'ready'};
function fixture({storage=new Map(),research}={}){
 const requests=[],nodes=[];const node=()=>({ownText:'',children:[],attrs:{},get textContent(){return this.ownText+this.children.map(n=>n.textContent).join('')},set textContent(v){this.ownText=v;this.children=[]},value:'',setAttribute(k,v){this.attrs[k]=v},append(...items){this.children.push(...items)},after(){}});const doc={createElement(){const n=node();n.tag=arguments[0];nodes.push(n);return n}};
 const input={...node(),ownerDocument:doc},answer=node(),askButton={...node(),parentNode:node()};
 const sandbox={console,crypto:webcrypto,AbortController,URL,setTimeout,clearTimeout,Intl,Event,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
 vm.createContext(sandbox);
 // Use actual host identity + bridge implementation; no independent assistant.
 const root=fs.existsSync(path.join(__dirname,'../conversation-runtime.js'))?path.join(__dirname,'..'):path.join(__dirname,'../../james-work');
 vm.runInContext(fs.readFileSync(path.join(root,'conversation-runtime.js'),'utf8'),sandbox);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../conversation-ui.js'),'utf8'),sandbox);
 const fetcher=async(url,options)=>{const body=options?.body?JSON.parse(options.body):null;requests.push({url,body});let data;
  if(url==='/api/james/conversation')data=scope;
  else if(url==='/api/james/research')data=research?await research(body):{ok:true,result:{status:'completed',comparisonVerified:true,message:'Fixture evidence only',products:[{name:'Synthetic lamp',price:10,currency:'USD',url:'https://www.ikea.com/us/en/p/synthetic/',observedAt:'2026-10-28T20:00:00Z'}]}};
  else data={ok:true,answer:'Normal James reply'};
  return {ok:true,status:200,json:async()=>data};};
 const ui=sandbox.JamesConversationUI.mount({input,answer,askButton,fetcher});return {ui,input,answer,requests,storage,nodes};
}
test('natural pilot uses existing verified scope and displays receipts without model calls',async()=>{const f=fixture();f.input.value='Compare desk lamps under $50';assert.equal((await f.ui.ask()).status,'completed');const calls=f.requests.filter(r=>r.url==='/api/james/research');assert.equal(calls.length,1);assert.equal(calls[0].body.conversationId,scope.conversationId);assert.equal(calls[0].body.generation,1);assert.equal(calls[0].body.accountId,undefined);assert.match(f.answer.textContent,/Synthetic lamp/);assert.match(f.answer.textContent,/No purchase made/);assert.ok(!f.requests.some(r=>r.url==='/api/fast'))});
test('reload and repeated request reuse saved task; revoke clears client pointer',async()=>{const a=fixture();a.input.value='Compare desk lamps under $50';await a.ui.ask();const first=a.requests.find(r=>r.url==='/api/james/research').body.taskId;const b=fixture({storage:a.storage});b.input.value=a.requests.find(r=>r.url==='/api/james/research').body.text;await b.ui.ask();assert.equal(b.requests.find(r=>r.url==='/api/james/research').body.taskId,first);b.ui.revoke();assert.equal(b.storage.has('james:j30-task:v1'),false)});
test('cancel suppresses late research and retains draft and retry task ID',async()=>{let release,entered;const start=new Promise(r=>entered=r);const f=fixture({research:body=>new Promise(r=>{release=r;entered()})});f.input.value='Compare desk lamps under $50';const pending=f.ui.ask();await start;f.ui.cancelReply();release({ok:true,result:{status:'completed',comparisonVerified:true,message:'Late',products:[]}});await pending;assert.equal(f.answer.textContent,'');assert.equal(f.input.value,'Compare desk lamps under $50');assert.equal(f.storage.has('james:j30-task:v1'),true)});
test('ordinary and project questions retain existing model path',async()=>{const f=fixture();f.input.value='Tell me about our project';await f.ui.ask();await f.ui.askWorkbench('Compare desk lamps under $50',{title:'Synthetic Windows',versions:[]});assert.equal(f.requests.filter(r=>r.url==='/api/fast').length,2);assert.equal(f.requests.filter(r=>r.url==='/api/james/research').length,0)});
test('incomplete comparison is never presented as verified',async()=>{const f=fixture({research:async()=>({ok:true,result:{status:'blocked',comparisonVerified:false,message:'Insufficient verified evidence',error:'CLEANUP_UNCONFIRMED',products:[]}})});f.input.value='Compare desk lamps under $50';await f.ui.ask();assert.match(f.answer.textContent,/not complete/);assert.match(f.answer.textContent,/CLEANUP_UNCONFIRMED/);assert.doesNotMatch(f.answer.textContent,/Verified public product comparison/)});
test('punctuation and case retries reuse the canonical task',async()=>{const f=fixture();f.input.value='Compare desk lamps under $50.';await f.ui.ask();f.input.value='compare desk lamps under $50';await f.ui.ask();const calls=f.requests.filter(r=>r.url==='/api/james/research');assert.equal(calls[0].body.taskId,calls[1].body.taskId);assert.equal(calls[0].body.text,'Compare desk lamps under $50')});
test('unavailable or silently failing task storage cannot start research',async()=>{const broken={get(){return undefined},set(){},delete(){}};const f=fixture({storage:broken});f.input.value='Compare desk lamps under $50';assert.equal((await f.ui.ask()).status,'failed');assert.equal(f.requests.filter(r=>r.url==='/api/james/research').length,0);assert.equal(f.input.value,'Compare desk lamps under $50')});

test('comparison renders cards and collapses diagnostics without unsafe product links',async()=>{
 const f=fixture({research:async()=>({ok:true,result:{status:'completed',comparisonVerified:true,products:[{name:'<img onerror=alert(1)>',price:19.99,currency:'USD',url:'javascript:alert(1)',observedAt:'fixture'}],searchEvidence:{deniedResources:['technical fixture']}}})});
 f.input.value='Compare desk lamps under $50';await f.ui.ask();
 assert.equal(f.nodes.filter(n=>n.tag==='article').length,1);
 assert.equal(f.nodes.filter(n=>n.tag==='a').length,0);
 const details=f.nodes.find(n=>n.tag==='details');assert.ok(details);assert.equal(details.attrs.open,undefined);
 assert.match(details.textContent,/technical fixture/);assert.match(f.answer.textContent,/IKEA only/);
 assert.match(f.answer.children[0].textContent,/I found 1 IKEA/);assert.doesNotMatch(f.answer.children[0].textContent,/technical fixture/);
});

test('visible summary preserves verified product receipts in follow-up conversation context',async()=>{const f=fixture();f.input.value='Compare desk lamps under $50';await f.ui.ask();f.input.value='Which lamps did you find?';await f.ui.ask();const call=f.requests.find(r=>r.url==='/api/fast');assert.match(call.body.question,/Synthetic lamp/);assert.match(call.body.question,/USD 10/);assert.match(call.body.question,/https:\/\/www.ikea.com/);assert.doesNotMatch(call.body.question,/Blocked resources/)});

test('fresh-search button creates a new task only after completed result and preserves old cards while pending',async()=>{
 let release,calls=0;const f=fixture({research:async body=>{calls++;if(calls===2)return new Promise(r=>release=r);return {ok:true,result:{status:'completed',comparisonVerified:true,resultSource:'saved',taskId:body.taskId,products:[{name:'Synthetic lamp',price:10,currency:'USD',url:'https://www.ikea.com/us/en/p/synthetic/',observedAt:'fixture'}]}}}});
 f.input.value='Compare desk lamps under $50';await f.ui.ask();assert.match(f.answer.textContent,/Saved result/);
 const first=f.requests.find(r=>r.url==='/api/james/research').body.taskId;
 const again=f.nodes.find(n=>n.textContent==='Check these again');assert.ok(again);
 const pending=again.onclick();while(!release)await new Promise(r=>setTimeout(r,0));
 assert.match(f.answer.textContent,/Synthetic lamp/);
 assert.notEqual(f.requests.filter(r=>r.url==='/api/james/research')[1].body.taskId,first);
 release({ok:true,result:{status:'completed',comparisonVerified:true,resultSource:'fresh',products:[]}});await pending;assert.match(f.answer.textContent,/New research attempt/);
});
test('uncertain or incomplete research never offers a fresh-task bypass',async()=>{
 const f=fixture({research:async()=>({ok:true,result:{status:'blocked',comparisonVerified:false,error:'CLEANUP_UNCONFIRMED',products:[]}})});
 f.input.value='Compare desk lamps under $50';await f.ui.ask();assert.equal(f.nodes.some(n=>n.textContent==='Check these again'),false);
});

test('old fresh-search button cannot clear a new uncertain task after failure',async()=>{
 let calls=0;const f=fixture({research:async body=>{calls++;if(calls>1)throw Error('uncertain request');return {ok:true,result:{taskId:body.taskId,status:'completed',comparisonVerified:true,products:[]}}}});
 f.input.value='Compare desk lamps under $50';await f.ui.ask();const again=f.nodes.find(n=>n.textContent==='Check these again');
 await again.onclick();const current=f.storage.get('james:j30-task:v1');await again.onclick();
 assert.equal(calls,2);assert.equal(f.storage.get('james:j30-task:v1'),current);assert.equal(again.disabled,true);
});

test('successful recheck explicitly distinguishes unchanged prices from changed prices',async()=>{
 for(const changed of [false,true]){
 let count=0;const f=fixture({research:async body=>({ok:true,result:{taskId:body.taskId,status:'completed',comparisonVerified:true,resultSource:++count===1?'saved':'fresh',products:[{name:'Fixture lamp',price:changed&&count>1?12:10,currency:'USD',url:'https://www.ikea.com/us/en/p/fixture/',observedAt:'2026-10-28T20:00:00Z'}]}})});
 f.input.value='Compare desk lamps under $50';await f.ui.ask();await f.nodes.find(n=>n.textContent==='Check these again').onclick();
 assert.match(f.answer.children[0].textContent,changed?/prices changed/:/unchanged observed prices/);
 assert.doesNotMatch(f.answer.textContent,/Checked: 2026-10-28T/);
 }
});
