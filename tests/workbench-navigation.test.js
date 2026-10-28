const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(identity){
 const events={},calls={mounted:0,shown:[],navigation:[]};
 const elements={workbenchRoot:{hidden:true},workbenchStatus:{textContent:''},workbench:{classList:{contains:()=>true}},workbenchExit:{}};
 const context={document:{hidden:false,getElementById:id=>elements[id],addEventListener:(name,fn)=>events[name]=fn},window:{jamesPageNow:id=>calls.shown.push(id),jamesConversationUI:{snapshotWorkspaceIdentity:identity,end(){}},fetch(){},addEventListener:(name,fn)=>events[name]=fn},setInterval(){},mountAsyncWorkbench(){},createWorkbenchAccountLifecycle(){calls.mounted++;return{}},createWorkbenchDoor(){return{navigate:async(id)=>{calls.navigation.push(id);return true},revoke(){}}},createIdentityObserver(){return{check:async()=>({status:'verified'}),dispose(){}}}};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(require.resolve('../workbench/host.mjs'),'utf8').replace(/^import .*;\n/gm,''),context);
 return {events,calls,elements,navigate:context.window.jamesWorkbenchNavigate};
}
for(const event of ['james-conversation-ended','pagehide'])test(`Workbench pending identity cannot mount after ${event}`,async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const h=fixture(()=>pending);
 const opening=h.navigate('workbench');h.events[event]();resolve({conversationId:'old',generation:1});
 assert.equal(await opening,false);assert.equal(h.calls.mounted,0);assert.equal(h.elements.workbenchRoot.hidden,true);assert.deepEqual(h.calls.navigation,[]);
});
test('Workbench ordinary navigation before entry leaves conversation and lifecycle untouched',async()=>{
 let identityCalls=0;const h=fixture(async()=>{identityCalls++;return{conversationId:'current',generation:1}});
 assert.equal(await h.navigate('briefing'),true);assert.equal(identityCalls,0);assert.equal(h.calls.mounted,0);assert.deepEqual(h.calls.shown,['briefing']);
});
test('Workbench unavailable identity cannot mount or report success',async()=>{
 const h=fixture(async()=>{throw Error('unavailable')});
 assert.equal(await h.navigate('workbench'),false);assert.equal(h.calls.mounted,0);assert.equal(h.elements.workbenchRoot.hidden,true);assert.match(h.elements.workbenchStatus.textContent,/could not verify/);
});
