import {mountAsyncWorkbench} from './async-app.js';
import {createWorkbenchAccountLifecycle} from './account-lifecycle.mjs';
import {createWorkbenchDoor} from './host-door.mjs';
import {createIdentityObserver} from './identity-observer.mjs';
const root=document.getElementById('workbenchRoot'),status=document.getElementById('workbenchStatus');
let screen,lifecycle,door,observer,busy=false,epoch=0,requesting=false,suspending=false;
const retainedLifecycles=[];
function revoke(){epoch++;observer?.dispose();door?.revoke();if(lifecycle)retainedLifecycles.push(lifecycle);door=null;lifecycle=null;screen=null;root.hidden=true;}
function show(id){window.jamesPageNow(id);}
window.jamesWorkbenchNavigate=async id=>{
 if(busy)return false;busy=true;const ticket=epoch;const current=()=>ticket===epoch;
 try{
  if(!door&&id!=='workbench'){show(id);return true;}
  if(!door){
   status.textContent='Checking James conversation and account…';show('workbench');
   // Reuse the current owner. An ended conversation is never silently restarted.
   let scope=await window.jamesConversationUI.snapshotWorkspaceIdentity();
   if(!current())return false;
   lifecycle=createWorkbenchAccountLifecycle({fetch:async(url,options)=>{const verified=await window.jamesConversationUI.snapshotWorkspaceIdentity();if(!current()||verified.conversationId!==scope.conversationId||verified.generation!==scope.generation||verified.accountId!==scope.accountId){if(requesting&&current()&&verified.accountId===scope.accountId)throw Error('Conversation transition pending');revoke();throw Error('Conversation changed');}return window.fetch(url,options);},root,conversationId:scope.conversationId,stopVoice:()=>{if(!suspending)return window.jamesConversationUI.end(scope)},mount:(target,options)=>(screen=mountAsyncWorkbench(target,{...options,remoteMode:true,onAsk:async(text,project)=>{const cancel=document.getElementById('workbenchCancelReply');if(cancel)cancel.hidden=false;requesting=true;try{const result=await window.jamesConversationUI.askWorkbench(text,project,next=>{if(current()&&next.accountId===scope.accountId)scope=next;});if(!current())return {status:'superseded'};const next=await window.jamesConversationUI.snapshotWorkspaceIdentity();if(!current()||next.accountId!==scope.accountId)return {status:'superseded'};scope=next;return result;}finally{requesting=false;if(cancel)cancel.hidden=true;if(current())await observer?.check();}}}))});
   door=createWorkbenchDoor({lifecycle,getScreen:()=>screen,root,render:show,home:()=>show('briefing')});
   observer=createIdentityObserver({lifecycle,root,isActive:()=>!document.hidden&&document.getElementById('workbench').classList.contains('active'),onChanged:()=>{revoke();status.textContent='Sign in again before reopening Workbench.';},onUnavailable:()=>{status.textContent='Account check unavailable. Your draft is retained. Retry Workbench.';}});
  }
  const moved=await door.navigate(id,{isCurrent:current});
  if(!current())return false;
  if(moved){status.textContent='';if(id==='workbench')await observer.check();if(!current())return false;}
  else status.textContent='Workbench could not finish navigation. Keep this tab open; your draft is retained.';
  return moved;
 }catch{if(!current())return false;status.textContent='Workbench could not verify the current conversation or account. Your projects have not been changed. Return to Briefing and retry.';return false;}
 finally{busy=false;}
};
document.getElementById('workbenchExit').onclick=()=>window.jamesWorkbenchNavigate('briefing');
window.addEventListener('james-conversation-ended',revoke);
window.addEventListener('pagehide',()=>{suspending=true;revoke();});
window.addEventListener('pageshow',event=>{suspending=false;if(event.persisted&&document.getElementById('workbench').classList.contains('active'))window.jamesWorkbenchNavigate('workbench');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)root.hidden=true;else observer?.check();});
window.addEventListener('focus',()=>observer?.check());
setInterval(()=>{if(!document.hidden)observer?.check();},30000);

const cancelReply=document.getElementById('workbenchCancelReply');if(cancelReply)cancelReply.onclick=()=>window.jamesConversationUI.cancelReply();
