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
 function mount(container,{refresh,review,draft,readSaved,saveReview,decide,onCount=()=>{}}){
  const doc=container.ownerDocument;
  let checking=false,checkFlight=null,undoItem=null,undoTimer=null,savedRevision=0;
  let items=[],checkedAt=null,scanned=0,connected=false,stale=false,loading=false,savedItems=[],handledItems=[],savedAt=null,savedSources=null,hasSaved=false,version=0,notice='';
  function node(tag,text){const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  async function decision(item,action){
   if(loading||!decide||!item?.reviewKey)return;
   const generation=version;loading=true;notice='';render();
   try{await decide(item.reviewKey,action);if(generation!==version)return;
    const restored=await restore();if(generation!==version)return;
    if(undoTimer)root.clearTimeout(undoTimer);undoItem=action==='handled'?item:null;undoTimer=undoItem?root.setTimeout(()=>{if(generation!==version)return;undoItem=null;undoTimer=null;render();},10000):null;
    notice=restored?(action==='handled'?'Marked handled. Your email and tasks are unchanged.':'Suggestion restored.'):'Decision saved. Refresh the review to see the updated list.';}
   catch{if(generation===version)notice='Could not save that change. Refresh the review and try again.';}
   finally{if(generation===version){loading=false;render();}}
  }
  function render(){
   const focused=container.contains(doc.activeElement)?{action:doc.activeElement.dataset.reviewAction,id:doc.activeElement.dataset.reviewId}:null;
   const openDetails=[...container.querySelectorAll('details')].filter(d=>d.open).map(d=>d.dataset.reviewDetails);
   const heading=node('h2','From connected Mail'),status=node('p');status.setAttribute('role','status');
   status.textContent=loading?'Updating mail review…':savedSources?(stale?'Latest mail check failed. Saved items may be out of date. ':'')+Object.entries(savedSources).map(([name,source])=>name+': '+(!source?'not checked':source.stale?'latest check failed; saved items retained':source.checkedAt?'checked '+new Date(source.checkedAt).toLocaleString():'not checked')).join(' · '):stale?'Mail refresh failed. Any previously found items may be out of date.':!checkedAt?(connected?'Recent Inbox mail has not been checked.':'Mail has not been checked yet.'):`${scanned} loaded Inbox messages checked · ${new Date(checkedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`;
   const help=node('p','These are email suggestions, not saved tasks. Updates automatically while James is open. Review the email, draft a task if action remains, or mark it handled.');help.className='action-help';
   const button=node('button',(loading||checking)?'Updating…':'Check recent mail');button.type='button';button.disabled=loading||checking;button.dataset.reviewAction='refresh';
   button.onclick=()=>void check();
   const list=node('div');list.className='mail-review-list';
   // Once saved state exists it is authoritative. Live Inbox refreshes must not
   // bring a handled suggestion back without a new saved message version.
   const displayed=new Map((hasSaved?savedItems:items).map(item=>[item.id,item]));
   for(const item of displayed.values()){
    const article=node('article'),title=node('h3',item.subject),sender=node('p',(item.id.startsWith('gmail:')?'Gmail · ':'Hotmail · ')+item.sender),reason=node('p',item.reasons.join(' · ')),preview=node('p',item.preview),open=node('button','Review in Mail'),task=node('button','Draft a task');
    open.type=task.type='button';open.dataset.reviewAction='review';task.dataset.reviewAction='draft';open.dataset.reviewId=task.dataset.reviewId=item.id;open.onclick=()=>review(item.id);task.onclick=()=>draft(item);article.append(title,sender,reason,preview,open,task);
    if(decide){const handled=node('button','Mark handled');handled.type='button';handled.dataset.reviewAction='handled';handled.dataset.reviewId=item.id;handled.disabled=loading||!item.reviewKey;handled.title=item.reviewKey?'Remove this suggestion from Needs attention; keep the email and tasks.':'Check recent mail first to save this suggestion.';handled.onclick=()=>void decision(item,'handled');article.append(handled);}
    list.append(article);
   }
   onCount(displayed.size);
   if((checkedAt||savedAt)&&!displayed.size)list.append(node('p',stale?'No retained review suggestions. The latest scan failed.':'No suggestions need your review from the mail checked.'));
   const message=node('p',notice);message.setAttribute('role','status');
   const undo=node('button','Undo');undo.type='button';undo.disabled=loading;undo.dataset.reviewAction='undo';undo.onclick=()=>void decision(undoItem,'undo');
   const details=node('details');details.className='action-help';details.dataset.reviewDetails='help';details.open=openDetails.includes('help');details.append(node('summary','How this review works'));
   details.append(node('p',savedAt?'Saved review available across devices · last check '+new Date(savedAt).toLocaleString()+'.':'Checking connected mail automatically…'));
   details.append(node('p','Checks up to 25 returned Inbox messages each from Hotmail and connected Gmail. James does not yet reconcile replies or actions taken in regular mail. Mark handled records your decision for this saved message version; changed message content may appear again. It does not delete email or complete a task. Handled suggestions leave this screen immediately, with Undo for 10 seconds. Older folders, Sent review, full semantic review and closed-app monitoring are not connected here.'));
   container.replaceChildren(heading,help,status,button,message,list,...(undoItem?[undo]:[]),details);
   if(focused?.action){const target=[...container.querySelectorAll('[data-review-action]')].find(n=>n.dataset.reviewAction===focused.action&&n.dataset.reviewId===focused.id);target?.focus({preventScroll:true});}
  }
  function check({automatic=false}={}){
   if(checkFlight)return checkFlight;
   if(loading)return Promise.resolve(false);
   const generation=version;checking=true;if(!automatic){loading=true;notice='';}render();
   let flight;
   flight=(async()=>{try{await refresh();if(generation!==version)return false;if(saveReview){await saveReview();if(generation!==version)return false;return await restore();}return true;}
    catch(error){if(generation===version){await restore();if(generation===version&&!error?.conflict)fail();}return false;}
    finally{if(generation===version){checking=false;if(!automatic)loading=false;render();}if(checkFlight===flight)checkFlight=null;}})();
   checkFlight=flight;return flight;
  }
  function update(messages){items=candidates(messages);scanned=messages.length;checkedAt=new Date().toISOString();connected=true;if(!hasSaved)stale=false;render();}
  function fail(){stale=true;render();}
  async function restore(){if(!readSaved)return false;const generation=version;try{const result=await readSaved();if(generation!==version)return false;if(result){if(Number.isSafeInteger(result.revision)&&result.revision<savedRevision)return false;if(Number.isSafeInteger(result.revision))savedRevision=result.revision;if(!Array.isArray(result.items)||!Number.isFinite(Date.parse(result.checkedAt))||(result.handledItems!==undefined&&!Array.isArray(result.handledItems)))throw Error();savedItems=result.items;handledItems=result.handledItems||[];savedAt=result.checkedAt;savedSources=result.sources||null;hasSaved=true;stale=result.stale===true;}render();return true;}catch{if(generation===version)fail();return false;}}
  function clear(){++version;if(undoTimer)root.clearTimeout(undoTimer);undoTimer=null;undoItem=null;savedRevision=0;checkFlight=null;checking=false;savedItems=[];handledItems=[];savedAt=null;savedSources=null;hasSaved=false;loading=false;notice='';items=[];checkedAt=null;scanned=0;connected=false;stale=false;render();}
  render();void restore();return {update,fail,clear,restore,check};
 }
 async function connectGmail(form,{fetchImpl=root.fetch.bind(root),navigate=url=>root.location.assign(url)}={}){
  const button=form.querySelector('button'),status=form.querySelector('[data-gmail-status]');
  button.disabled=true;status.textContent='Opening Google…';
  try{
   const response=await fetchImpl('/api/google/gmail/connect',{method:'POST',credentials:'same-origin',headers:{Accept:'application/json'},redirect:'error'});
   if(!response.ok)throw Error();
   const data=await response.json(),url=new URL(data.authorizationUrl);
   if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw Error();
   navigate(url.href);
  }catch{status.textContent='Gmail connection could not open. Refresh James and try again. Existing Calendar access is unchanged.';button.disabled=false;}
 }
 if(root.document)root.document.addEventListener('submit',event=>{
  if(event.target?.id!=='gmailReadConnect')return;
  event.preventDefault();void connectGmail(event.target);
 });
 const api={candidates,mount,connectGmail};if(typeof module!=='undefined')module.exports=api;else root.JamesMailAttention=api;
})(typeof window==='undefined'?globalThis:window);
