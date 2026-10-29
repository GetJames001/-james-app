// Navigation only; lifecycle owns identity, existing James owns voice.
export function createWorkbenchDoor({lifecycle,getScreen,root,render,home}) {
 let generation=0,busy=null,opened=false,checkpoint=null,accountId=null;
 async function navigate(key,{isCurrent=()=>true}={}) {
  if(busy||!isCurrent())return false;
  const ticket={generation};busy=ticket;
  const current=()=>generation===ticket.generation&&isCurrent();
  let pendingConnection=null;
  const ownsConnection=()=>generation===ticket.generation&&
   (pendingConnection?.isCurrent?.()??true);
  try {
   if(opened){
    if(key==='workbench')return true;
    const saved=getScreen().getCheckpoint();
    if(!current())return false;
    const result=await lifecycle.leave();
    if(generation!==ticket.generation||result.status!=='closed')return false;
    checkpoint=saved&&accountId?{...saved,accountId}:null;opened=false;accountId=null;
    // unmount has already committed the save and disposed the screen. An
    // interrupted voice request must not leave that disposed workspace selected.
    if(!current()){home();return false;}
   }
   if(!current())return false;
   if(key==='workbench'){
    const result=await lifecycle.connect();
    if(generation!==ticket.generation||result.status!=='ready')return false;
    pendingConnection=result;
    if(!ownsConnection()||!current())return false;
    // Only the verified owner may resume this in-memory selection. A stale or
    // unavailable project is optional: keep the newly loaded gallery usable.
    if(checkpoint?.accountId!==result.accountId)checkpoint=null;
    if(checkpoint?.selectedId){
     let resumed;
     try{resumed=await getScreen().openProject(checkpoint.selectedId)}catch{}
     if(!ownsConnection())return false;
     if(resumed?.opened!==true)checkpoint=null;
     if(!current())return false;
    }
    opened=true;accountId=result.accountId;pendingConnection=null;
   }
   if(!current())return false;
   if(key===null)home();else render(key);
   return true;
  }catch{return false}finally{
   // A cancelled entry must not leave a ready screen outside door ownership.
   // Use ordinary leave so a harmless retry does not stop shared James voice.
   if(pendingConnection&&ownsConnection()){
    let result;try{result=await lifecycle.leave()}catch{}
    if(ownsConnection()){
     if(result?.status==='closed'){root.hidden=true;accountId=null;}
     else if(result?.status!=='superseded'){
      // A loaded checkpoint may have unconfirmed work. Keep it visible and
      // owned rather than discarding it merely because navigation was cancelled.
      opened=true;accountId=pendingConnection.accountId;render('workbench');
     }
    }
   }
   if(busy===ticket)busy=null;
  }
 }
 function revoke(){generation++;busy=null;opened=false;checkpoint=null;accountId=null;root.hidden=true;return lifecycle.revoke()}
 return {navigate,revoke};
}
