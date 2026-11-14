'use strict';
const {SchedulesClient}=require('@vercel/schedules');
const BASE='https://vercel-schedules.com',PATH='/v1/schedules/james-fictional-proof';
const TIMEOUT_MS=4000,MAX_BYTES=32768;
const unknown=()=>({state:'unknown',activeUntil:null,bounded:false,verifiedAt:null});
const fail=()=>{throw Error('SCHEDULE_STATE_UNAVAILABLE');};

// The SDK uses this deployment's OIDC identity/environment. The only enable
// operation is finite and separately authorized by the owner transport.
function createSchedulePlatform({config,project,name,expression,fetchImpl=fetch,now=Date.now,clientFactory=options=>new SchedulesClient(options)}){
 function validate(s){
  if(!s||s.scheduleId!==config.scheduleId||s.projectId!==project||s.name!==name||s.namespace!=='default'||s.source!=='static'||s.expression?.type!=='cron'||s.expression.cron!==expression||s.timezone!=='UTC'||s.jitter!==1||s.target?.type!=='function'||s.target.function!=='api/proof-schedule'||s.target.service!==undefined||!['active','inactive'].includes(s.state))fail();
  if(s.activeUntil!==undefined&&(!Number.isSafeInteger(s.activeUntil)||s.activeUntil<0))fail();
  if(s.state==='inactive'&&s.activeUntil!==undefined)fail();
  return {state:s.state,activeUntil:s.activeUntil??null,bounded:s.state==='active'&&s.activeUntil===config.end&&s.activeUntil>now(),verifiedAt:now()};
 }
 async function operation(fn,{enable=false}={}){
  const controller=new AbortController();let count=0,timer;
  const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('SCHEDULE_STATE_UNAVAILABLE'));},TIMEOUT_MS);});
  try{const client=clientFactory({baseUrl:BASE,fetch:async(url,options)=>{
   const target=new URL(url);
   if(controller.signal.aborted||++count>3||target.origin!==BASE||target.username||target.password||target.search!=='?namespace=default'||target.hash||!((options.method==='GET'&&target.pathname===PATH)||(options.method==='POST'&&target.pathname===PATH+'/disable'&&options.body===undefined)||(enable&&options.method==='POST'&&target.pathname===PATH+'/enable'&&options.body===JSON.stringify({until:config.end})&&now()<config.end)))fail();
   const response=await fetchImpl(url,{...options,redirect:'error',signal:controller.signal});
   // Bound response bodies even when a Content-Length is absent or dishonest.
   const reader=response.body?.getReader();if(!reader)fail();let bytes=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
   try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES||controller.signal.aborted)fail();text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
   catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}
   if(!response.ok)fail();
   // SDK response parsing stays intact; upstream diagnostic text is never exposed.
   return new Response(text,{status:response.status,headers:{'content-type':'application/json'}});
  }});
   return await Promise.race([fn(client),deadline]);}catch{return unknown();}finally{clearTimeout(timer);controller.abort();}
 }
 const id={name,namespace:'default'};
 return {
  inspect:()=>operation(async client=>validate(await client.get(id))),
  enableBounded:()=>operation(async client=>{
   if(!Number.isSafeInteger(config.start)||!Number.isSafeInteger(config.end)||config.end<=config.start||config.end-config.start>1800000||now()<config.start||now()>=config.end)fail();
   const before=validate(await client.get(id));
   // Never extend an active schedule, even one with the expected expiry.
   if(before.state!=='inactive')fail();
   try{await client.enable({...id,until:config.end});}catch{}
   const after=validate(await client.get(id));
   return after.bounded?after:unknown();
  },{enable:true}),
  stop:()=>operation(async client=>{
   const before=validate(await client.get(id));
   if(before.state==='inactive')return before;
   // A successful POST alone is not proof. Lost replies are reconciled by GET.
   try{await client.disable(id);}catch{}
   return validate(await client.get(id));
  })
 };
}
module.exports={createSchedulePlatform,TIMEOUT_MS,MAX_BYTES};
