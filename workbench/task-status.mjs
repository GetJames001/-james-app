// Read-only preparation status. Execution continues elsewhere; this view never
// dispatches work, changes approvals, or treats a refresh as a completion.
const labels={queued:'Queued',running:'Working',blocked:'Waiting for information',paused:'Paused',waiting_for_approval:'Needs your decision',cancelled:'Cancelled',completed:'Ready',failed:'Needs attention'};
function resultText(artifact){
 const lines=[];
 if(typeof artifact.title==='string')lines.push(artifact.title);
 if(typeof artifact.text==='string')lines.push(artifact.text);
 if(Array.isArray(artifact.items))for(const item of artifact.items){
  if(typeof item==='string')lines.push(item);
  else if(item&&typeof item==='object')lines.push([item.time,item.title].filter(value=>typeof value==='string').join(' · '));
 }
 return lines.filter(Boolean).join('\n');
}
export function mountTaskStatus(root,{request,document:doc=root.ownerDocument,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let disposed=false,generation=0,timer=null,abort=null,revision=-1,latest=null,expanded=false,disabled=false;
 const node=(tag,text,className)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
 function stop(){generation++;abort?.abort();abort=null;if(timer!==null)clearTimer(timer);timer=null;}
 function render(message=''){
  root.replaceChildren();root.hidden=!message&&!latest?.tasks.length;if(root.hidden)return;
  const heading=node('div',undefined,'task-status-heading');heading.append(node('h2','Work with James'),node('small','Preview'));root.append(heading);
  if(message){const notice=node('div',undefined,'task-status-notice'),text=node('p',message);text.setAttribute('role','status');const retry=node('button','Retry');retry.type='button';retry.onclick=()=>refresh();notice.append(text,retry);root.append(notice);}
  const tasks=latest?.tasks||[];
  for(const task of (expanded?tasks:tasks.slice(0,4))){
   const row=node('div',undefined,'task-status-row'),text=node('div',undefined,'task-status-copy');text.append(node('p',task.objective),node('small',labels[task.status]));row.append(text);
   const prepared=task.result?.outcome==='prepared'&&task.result.artifact?resultText(task.result.artifact):'';
   if(task.status==='completed'&&prepared){const details=node('details'),summary=node('summary','View result'),result=node('pre',prepared);details.append(summary,result);row.append(details);}
   root.append(row);
  }
  if(tasks.length>4){const more=node('button',expanded?'Show less':`Show all (${tasks.length})`);more.type='button';more.onclick=()=>{expanded=!expanded;render(message);};root.append(more);}
 }
 function valid(data){return data&&Number.isSafeInteger(data.revision)&&data.revision>=0&&Array.isArray(data.tasks)&&data.tasks.length<=50&&data.tasks.every(task=>task&&typeof task.objective==='string'&&task.objective.length<=1000&&Object.hasOwn(labels,task.status));}
 async function refresh(){
  if(disposed||disabled||doc.hidden)return;
  stop();const ticket=generation;abort=new AbortController();
  try{
   const response=await request('/api/james/task-execution',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:abort.signal});
   if(disposed||ticket!==generation||doc.hidden)return;
   if(response.status===404){disabled=true;latest=null;render();return;}
   if(response.status===401||response.status===403){latest=null;revision=-1;render('Sign in again to view work.');return;}
   if(!response.ok)throw Error('Unavailable');
   const data=await response.json();
   if(disposed||ticket!==generation||doc.hidden)return;
   if(!valid(data)||data.revision<revision)throw Error('Invalid status');
   revision=data.revision;latest=data;render();
  }catch{if(!disposed&&ticket===generation&&!doc.hidden)render(latest?'Work update unavailable. Showing the last checked status.':'Work status unavailable.');}
  finally{if(!disposed&&!disabled&&ticket===generation&&!doc.hidden)timer=setTimer(refresh,30000);}
 }
 function visibility(){stop();root.hidden=true;if(!doc.hidden){latest=null;revision=-1;refresh();}}
 root.hidden=true;root.classList.add('task-status');root.setAttribute('aria-label','Work with James');doc.addEventListener('visibilitychange',visibility);refresh();
 return {refresh,dispose(){if(disposed)return;disposed=true;stop();doc.removeEventListener('visibilitychange',visibility);latest=null;root.replaceChildren();root.hidden=true;}};
}
