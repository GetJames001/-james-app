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
   if(/\b(?:itinerary|e-ticket|boarding pass|flight confirmation|hotel confirmation|reservation confirmed|booking confirmation)\b/i.test(text)&&!/\b(?:special offer|sale|save \d|discount|deals)\b/i.test(subject))reasons.push('Possible itinerary or reservation — review before adding to Travel or Calendar');
   if(!reasons.length)continue;
   result.push({id:message.id,subject,sender:String(message.sender||'Unknown sender').slice(0,200),received:message.receivedDateTime||null,preview,reasons});
  }
  return result;
 }
 function mount(container,{refresh,review,draft,readSaved,saveReview}){
  const doc=container.ownerDocument;let items=[],checkedAt=null,scanned=0,connected=false,stale=false,loading=false,savedItems=[],savedAt=null,inventoryCount=0,version=0;
  function node(tag,text){const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  function render(){
   const heading=node('h2','From connected Mail'),status=node('p');status.setAttribute('role','status');
   status.textContent=loading?'Checking recent Inbox mail…':stale?'Mail refresh failed. Any previously found items may be out of date.':!checkedAt?(connected?'Recent Inbox mail has not been checked.':'Mail has not been checked yet.'):`${scanned} loaded Inbox messages checked · ${new Date(checkedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`;
   const savedStatus=node('p',savedAt?`Saved review available across devices · ${inventoryCount} message identities inventoried · last check ${new Date(savedAt).toLocaleString()}. Suggestions still require review; later replies are not reconciled.`:'Recent suggestions have not been saved to your account yet.');savedStatus.className='action-help';
   const coverage=node('p','Checks the latest personal Hotmail Inbox page (up to 25 messages) and retains previously saved review candidates. Gmail, older mailbox coverage, Junk, Deleted and Sent review are not connected here. This is not complete semantic review. No background monitoring or timed notifications are running.');coverage.className='action-help';
   const button=node('button',loading?'Checking…':'Check recent mail');button.type='button';button.disabled=loading;button.onclick=async()=>{const generation=version;loading=true;render();try{await refresh();if(generation!==version)return;if(saveReview){await saveReview();if(generation!==version)return;await restore();}}catch{if(generation===version)fail();}finally{if(generation===version){loading=false;render();}}};
   const list=node('div');list.className='mail-review-list';
   const displayed=new Map(savedItems.map(item=>[item.id,item]));for(const item of items)displayed.set(item.id,item);
   for(const item of displayed.values()){
    const article=node('article'),title=node('h3',item.subject),sender=node('p',item.sender),reason=node('p',item.reasons.join(' · ')),preview=node('p',item.preview),open=node('button','Review in Mail'),task=node('button','Draft a task');
    open.type=task.type='button';open.onclick=()=>review(item.id);task.onclick=()=>draft(item);article.append(title,sender,reason,preview,open,task);list.append(article);
   }
   if((checkedAt||savedAt)&&!displayed.size)list.append(node('p',stale?'No retained review suggestions. The latest scan failed.':'No review signals found in these loaded messages. This does not establish that your whole mailbox is clear.'));
   container.replaceChildren(heading,status,button,savedStatus,coverage,list);
  }
  function update(messages){items=candidates(messages);scanned=messages.length;checkedAt=new Date().toISOString();connected=true;stale=false;render();}
  function fail(){stale=true;render();}
  async function restore(){if(!readSaved)return;const generation=version;try{const result=await readSaved();if(generation!==version)return;if(result){if(!Array.isArray(result.items)||!Number.isFinite(Date.parse(result.checkedAt)))throw Error();savedItems=result.items;savedAt=result.checkedAt;inventoryCount=result.inventoryCount;stale=result.stale===true;}render();}catch{if(generation===version)fail();}}
  function clear(){++version;savedItems=[];savedAt=null;inventoryCount=0;loading=false;items=[];checkedAt=null;scanned=0;connected=false;stale=false;render();}
  render();void restore();return {update,fail,clear,restore};
 }
 const api={candidates,mount};if(typeof module!=='undefined')module.exports=api;else root.JamesMailAttention=api;
})(typeof window==='undefined'?globalThis:window);
