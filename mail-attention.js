(function(root){
 'use strict';
 function candidates(messages){
  const seen=new Set(),result=[];
  for(const message of messages||[]){
   if(typeof message?.id!=='string'||!message.id||seen.has(message.id))continue;seen.add(message.id);
   const subject=String(message.subject||'(No subject)').slice(0,300),preview=String(message.preview||'').slice(0,1200),text=subject+' '+preview;
   const reasons=[];
   if(message.flagStatus==='flagged')reasons.push('Flagged in your mailbox');
   if(message.importance==='high')reasons.push('Sender marked this important');
   if(/\b(?:payment (?:is )?due|minimum payment|bill (?:is )?due|past due|payment reminder)\b/i.test(text)&&!/\b(?:pre.?approved|apply now|special offer)\b/i.test(subject))reasons.push('Possible bill or payment reminder — verify in the original message');
   if(/\b(?:interview|assessment|offer letter)\b/i.test(text)&&/\b(?:schedule|confirm|complete|invitation|deadline|expires|respond|action required)\b/i.test(text))reasons.push('Possible career response or deadline');
   if(/\b(?:action required|response required|please respond|rsvp required)\b/i.test(subject))reasons.push('Message explicitly requests a response');
   if(!reasons.length)continue;
   result.push({id:message.id,subject,sender:String(message.sender||'Unknown sender').slice(0,200),received:message.receivedDateTime||null,preview,reasons});
  }
  return result;
 }
 function mount(container,{refresh,review,draft}){
  const doc=container.ownerDocument;let items=[],checkedAt=null,scanned=0,connected=false,stale=false,loading=false;
  function node(tag,text){const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  function render(){
   const heading=node('h2','From connected Mail'),status=node('p');status.setAttribute('role','status');
   status.textContent=loading?'Checking recent Inbox mail…':stale?'Mail refresh failed. Any previously found items may be out of date.':!checkedAt?(connected?'Recent Inbox mail has not been checked.':'Mail has not been checked yet.'):`${scanned} loaded Inbox messages checked · ${new Date(checkedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`;
   const coverage=node('p','Review suggestions from personal Inbox messages loaded in this session only. This is not a complete mailbox, Spam or Trash scan. No background monitoring or timed notifications are running.');coverage.className='action-help';
   const button=node('button',loading?'Checking…':'Check recent mail');button.type='button';button.disabled=loading;button.onclick=async()=>{loading=true;render();try{await refresh();}catch{fail();}finally{loading=false;render();}};
   const list=node('div');list.className='mail-review-list';
   for(const item of items){
    const article=node('article'),title=node('h3',item.subject),sender=node('p',item.sender),reason=node('p',item.reasons.join(' · ')),preview=node('p',item.preview),open=node('button','Review in Mail'),task=node('button','Draft a task');
    open.type=task.type='button';open.onclick=()=>review(item.id);task.onclick=()=>draft(item);article.append(title,sender,reason,preview,open,task);list.append(article);
   }
   if(checkedAt&&!items.length)list.append(node('p',stale?'No retained review suggestions. The latest scan failed.':'No review signals found in these loaded messages. This does not establish that your whole mailbox is clear.'));
   container.replaceChildren(heading,status,button,coverage,list);
  }
  function update(messages){items=candidates(messages);scanned=messages.length;checkedAt=new Date().toISOString();connected=true;stale=false;render();}
  function fail(){stale=true;render();}
  function clear(){items=[];checkedAt=null;scanned=0;connected=false;stale=false;render();}
  render();return {update,fail,clear};
 }
 const api={candidates,mount};if(typeof module!=='undefined')module.exports=api;else root.JamesMailAttention=api;
})(typeof window==='undefined'?globalThis:window);
