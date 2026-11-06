(function(root){
 'use strict';
 function mount({fetcher=fetch,onCreated=()=>{}}={}){
  const dialog=document.createElement('dialog');dialog.className='appointment-review';dialog.setAttribute('aria-label','Review appointment');
  const heading=document.createElement('h2');heading.textContent='Review appointment';
  const details=document.createElement('dl'),status=document.createElement('p');status.setAttribute('role','status');
  const consent=document.createElement('button');consent.type='button';consent.textContent='Enable appointment saving';consent.hidden=true;
  const check=document.createElement('button');check.type='button';check.textContent='Check connection';check.hidden=true;
  const save=document.createElement('button');save.type='button';save.textContent='Create appointment';save.disabled=true;
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
  const note=document.createElement('p');note.textContent='Saves to your connected Google calendar. No invitations are sent. Review the location, date, time and duration before creating it.';
  dialog.append(heading,details,note,status,consent,check,save,cancel);document.body.append(dialog);
  let token=null,revision=0,current={status:'none'},connected=false,saving=false;
  const errors={CALENDAR_PERMISSION_REQUIRED:'Appointment saving needs your Google permission. Calendar reading is unchanged.',REVIEW_EXPIRED:'This review expired. Prepare it again before saving.',CALENDAR_SAVE_UNCONFIRMED:'Saving could not be confirmed. Retry this same review to check safely; do not make a second draft.',CALENDAR_EVENT_CONFLICT:'This review conflicts with an existing saved event. Check Calendar before preparing another.',APPOINTMENT_TIME_REQUIRED:'Please provide a future start time and an end time after it.'};
  const format=(date,zone)=>new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'short',timeZone:zone}).format(new Date(date));
  async function request(body){const response=await fetcher('/api/james/appointments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error||'APPOINTMENT_SERVICE_UNAVAILABLE');return data;}
  async function connection(){try{const response=await fetcher('/api/james/appointments',{cache:'no-store'}),data=await response.json();connected=response.ok&&data.createConnected===true;}catch{connected=false;}
   consent.hidden=check.hidden=connected;save.disabled=!connected||!token||saving;if(!connected)status.textContent='Enable appointment saving once. This preserves your existing Calendar reading connection.';
  }
  async function prepare(input){
   if(saving)return {status:'busy',message:'Finish the current save before preparing another appointment.'};
   const generation=++revision;token=null;save.disabled=true;current={status:'preparing'};
   try{
    const data=await request({action:'prepare',details:input});if(generation!==revision)return {status:'cancelled'};
    if(data.status!=='review_required'||!data.details||typeof data.reviewToken!=='string')throw Error();
    token=data.reviewToken;current={status:'review_required',details:data.details,expiresAt:data.expiresAt};details.replaceChildren();
    for(const [label,value] of [['Appointment',data.details.title],['Location',data.details.location],['Starts',format(data.details.start,data.details.timeZone)],['Ends',format(data.details.end,data.details.timeZone)],['Time zone',data.details.timeZone]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;details.append(dt,dd);}
    status.textContent='Review these details, then choose Create appointment.';save.hidden=false;cancel.textContent='Cancel';if(!dialog.open)dialog.showModal();await connection();
    return {...current,message:'The review card is open. The appointment has not been saved. Michael must click Create appointment.'};
   }catch(error){if(generation===revision){current={status:'failed'};status.textContent=errors[error.message]||'The appointment review could not be prepared. Check the details and try again.';if(!dialog.open)dialog.showModal();}return {...current,message:status.textContent};}
  }
  save.onclick=async()=>{
   if(!token||saving||!connected)return;saving=true;save.disabled=true;cancel.disabled=true;status.textContent='Saving appointment…';
   try{const result=await request({action:'confirm',reviewToken:token});if(result.status!=='created')throw Error();current=result;token=null;save.hidden=true;status.textContent='Appointment saved to Google Calendar.';cancel.textContent='Done';await onCreated(result.event);}
   catch(error){status.textContent=errors[error.message]||'Saving is unavailable. Your appointment has not been confirmed.';if(error.message==='REVIEW_EXPIRED')token=null;if(error.message==='CALENDAR_PERMISSION_REQUIRED'){connected=false;consent.hidden=check.hidden=false;}}
   finally{saving=false;save.disabled=!token||!connected;cancel.disabled=false;}
  };
  consent.onclick=async()=>{consent.disabled=true;try{const response=await fetcher('/api/google/appointments/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),data=await response.json();if(!response.ok)throw Error();const url=new URL(data.authorizationUrl);if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw Error();root.location.assign(url.href);}catch{status.textContent='Appointment permission could not be opened. Existing Calendar reading is unchanged.';}finally{consent.disabled=false;}};
  check.onclick=connection;
  cancel.onclick=()=>{if(saving)return;revision++;token=null;if(current.status!=='created')current={status:'cancelled'};dialog.close();};
  dialog.addEventListener('cancel',event=>{if(saving){event.preventDefault();return;}revision++;token=null;current={status:'cancelled'};});
  root.addEventListener('pagehide',()=>{revision++;token=null;current={status:'none'};});
  async function setup(){if(saving)return;revision++;token=null;current={status:'none'};details.replaceChildren();save.hidden=true;save.disabled=true;cancel.textContent='Done';status.textContent='Checking appointment saving permission…';if(!dialog.open)dialog.showModal();await connection();if(connected)status.textContent='Appointment saving is connected. Ask James to prepare an appointment; you will review it before saving.';}
  return {prepare,setup,read:()=>JSON.parse(JSON.stringify(current))};
 }
 root.JamesAppointments={mount};
})(typeof window==='undefined'?globalThis:window);
