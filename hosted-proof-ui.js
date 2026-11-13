(() => {
 'use strict';
 const $=id=>document.getElementById(id),endpoint='/api/james/hosted-proof';
 let state=null,busy=false;
 function buttons(){
  const available=state&&!busy,active=available&&Date.now()>=state.window.start&&Date.now()<state.window.end;
  $('arm').disabled=!active||state.armed||state.stopped;
  $('resume').disabled=!active||!state.armed||state.stopped||!state.tasks.some(t=>t.status==='blocked');
  $('stop').disabled=!available;
  $('refresh').disabled=busy;
 }
 function list(id,rows,empty){$(id).replaceChildren(...(rows.length?rows:[empty]).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));}
 function render(){
  $('state').textContent=state.stopped?'Tasks stopped. Hosted scheduler shutdown still needs verification.':Date.now()>=state.window.end?'The check window has ended.':state.armed?'Ready for scheduled work. You can close this page.':'Ready to start the fictional check.';
  list('tasks',state.tasks.map(t=>(t.kind==='agenda_fixture'?'Agenda':'Follow-up')+': '+(t.outcome==='prepared'?'prepared':t.status==='blocked'?'waiting for a fictional customer detail':t.status)), 'No task has started.');
  list('notices',state.notifications.map(n=>n.state==='queued'?'Update queued; delivery has not been tested.':n.state==='cancelled'?'Update cancelled.':n.state==='delivered'&&n.hasReceipt?'Delivery receipt recorded.':n.state==='unknown'?'Delivery outcome unknown.':'Update '+n.state+'.'),'No update queued.');
  buttons();
 }
 async function request(action){
  busy=true;buttons();$('error').textContent='';
  try{
   if(action){
    const changed=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
    if(!changed.ok)throw Error('Action could not be confirmed. Check results before retrying.');
    $('message').textContent=action==='stop'?'Stop recorded. Checking cancellation results…':action==='resume'?'Fictional detail supplied. Waiting for the next scheduled run.':'Check registered. Waiting for the scheduled run.';
   }
   const response=await fetch(endpoint,{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Results are unavailable. Any previous results remain below.');
   const next=await response.json();if(!next||!next.window||!Array.isArray(next.tasks)||!Array.isArray(next.notifications))throw Error('Results are unavailable.');
   state=next;render();
  }catch(error){$('error').textContent=error.message;}
  finally{busy=false;buttons();}
 }
 for(const action of ['arm','resume','stop'])$(action).addEventListener('click',()=>request(action));
 $('refresh').addEventListener('click',()=>request());
 // Reads only; no timer, page lifecycle event or browser client dispatches work.
 request();
})();
