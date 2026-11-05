import {createConversationBridge} from './conversation-bridge.mjs';
import {createTurnTiming} from './turn-timing.mjs';

const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
const same=(a,b)=>a&&b&&a.accountId===b.accountId&&a.conversationId===b.conversationId&&a.generation===b.generation;
// One existing WebRTC channel; this adapter never opens a microphone or calls an API.
// Spoken turns carry the provider's committed item ID, never a fabricated transcript.
export async function createRealtimeTurnCoordinator({identityOwner,scope,send,isActive,endTransport,navigate,newId,now,wantsAudio=()=>true,schedule=setTimeout,unschedule=clearTimeout,capacity=128}){
 if(typeof send!=='function'||typeof isActive!=='function'||typeof endTransport!=='function'||typeof navigate!=='function'||typeof identityOwner?.current!=='function')throw Error('Host transport required');
 scope=Object.freeze({...scope});
 let detached=false,pending=null,submitVoice=null,speechActive=false,lastReply=null,playback=null,requestedNavigation=null;
 const committed=new Set(),timing=createTurnTiming({enabled:true,now,capacity});
 const live=()=>!detached&&isActive()&&same(scope,identityOwner.current());
 const mark=(turn,event)=>{const trace=timing.snapshot().find(t=>t.turnId===turn.id);if(trace)timing.mark({turnId:turn.id,generation:trace.generation,event});};
 const frame=(event)=>{if(!live())throw Error('Transport unavailable');send(event);};
 const responseRequest=turn=>{turn.expectedRequest='request-'+turn.id+'-'+(++turn.requests);turn.sentEvents.add(turn.expectedRequest);return {type:'response.create',event_id:turn.expectedRequest,response:{metadata:{james_turn_id:turn.id,james_request_id:turn.expectedRequest},...(!wantsAudio()?{output_modalities:['text']}:{})}};};
 function rejectPending(){const old=pending;pending=null;if(old){unschedule(old.timer);old.signal.removeEventListener('abort',old.abort);old.reject(Error('Turn interrupted'));}lastReply=null;playback=null;}
 function requireLive(){if(live())return true;if(!detached){detached=true;rejectPending();bridge.end();endTransport();}return false;}
 const bridge=createConversationBridge({identityOwner,navigate:(door,options)=>{const request=requestedNavigation;return navigate(request?.workspace||door,{...options,isCurrent:()=>options.isCurrent()&&(!request?.guard||request.guard())});},newId,timing,capacity,capabilities:{realtime:q=>{
  if(!live()||pending||speechActive)throw Error('Transport unavailable');
  return new Promise((resolve,reject)=>{
   const turn={id:q.turnId,origin:q.origin,signal:q.signal,isCurrent:q.isCurrent,resolve,reject,responseId:null,done:new Set(),responses:new Set(),continuation:false,continuationRequested:false,calls:new Set(),remainingCalls:new Set(),requests:0,sentEvents:new Set(['input-'+q.turnId])};
   turn.abort=()=>{if(pending===turn)rejectPending()};pending=turn;q.signal.addEventListener('abort',turn.abort,{once:true});
   try{
    if(q.signal.aborted)throw Error('Turn interrupted');
    turn.timer=schedule(()=>{if(pending===turn){bridge.interruptReply();rejectPending();}},90000);
    if(q.origin==='typed')frame({type:'conversation.item.create',event_id:'input-'+q.turnId,item:{id:'item-'+q.turnId,type:'message',role:'user',content:[{type:'input_text',text:q.text}]}});
    frame(responseRequest(turn));
   }catch{if(pending===turn)rejectPending();}
  });
 }}});
 const ready=await bridge.verifyIdentity();
 if(ready.status!=='ready'||!live()){bridge.end();throw Error('Conversation identity unconfirmed');}
 bridge.attachVoice({subscribeTurn(fn){submitVoice=fn;return ()=>{submitVoice=null}},end(){if(!detached)endTransport()},interruptReply(){
  const turn=pending;
  if((turn||playback)&&live())try{if(turn&&(!turn.responseId||!turn.done.has(turn.responseId)))frame({type:'response.cancel',event_id:'cancel-'+turn.id,...(turn.responseId?{response_id:turn.responseId}:{})});frame({type:'output_audio_buffer.clear',event_id:'clear-'+(turn||playback).id});}catch{}
 }});
 async function submit(input){
  if(!requireLive())return {status:'unavailable'};
  if(pending||speechActive)return {status:'busy'};
  // A new input invalidates delayed presentation from the previous answer.
  bridge.interruptReply();lastReply=null;playback=null;
  const result=await bridge.submitTurn(input);
  if(result.status==='completed'&&result.isCurrent()&&live())lastReply=result;
  return result;
 }
 function interrupt(){bridge.interruptReply();rejectPending();}
 function receive(event){
  if(!event||typeof event.type!=='string'||!requireLive())return false;
  if(event.type==='input_audio_buffer.speech_started'){speechActive=true;interrupt();return true;}
  if(event.type==='input_audio_buffer.speech_stopped'){speechActive=false;return true;}
  if(event.type==='input_audio_buffer.committed'){
   if(!id(event.item_id)||committed.has(event.item_id)||committed.size>=capacity||pending||speechActive)return false;
   committed.add(event.item_id);bridge.interruptReply();lastReply=null;playback=null;
   // VAD commits the real audio item. Only its correlated response is requested here.
   submitVoice?.({action:'realtime',text:event.item_id}).then(result=>{if(result.status==='completed'&&result.isCurrent()&&live())lastReply=result;}).catch(()=>{});
   return true;
  }
  if(event.type==='error'){const ref=event.error?.event_id;if(ref&&(!pending||!pending.sentEvents.has(ref)))return false;interrupt();if(!ref){detached=true;bridge.end();endTransport();}return false;}
  if(event.type.startsWith('output_audio_buffer.')&&playback&&event.response_id===playback.responseId&&playback.isCurrent()){if(event.type==='output_audio_buffer.started')mark(playback,'provider_audio_started_event');return true;}
  const turn=pending,responseId=event.response_id||event.response?.id;
  if(event.type==='response.created'){
   if(!turn||!turn.isCurrent()||!id(responseId)||event.response?.metadata?.james_turn_id!==turn.id||event.response?.metadata?.james_request_id!==turn.expectedRequest||turn.responses.has(responseId)||turn.responses.size>=32||turn.responseId&&!turn.continuation)return false;
   turn.responses.add(responseId);turn.responseId=responseId;turn.continuation=false;mark(turn,'response_created_event');return true;
  }
  if(event.type.startsWith('response.')||event.type.startsWith('output_audio_buffer.')){
   if(!turn||!turn.isCurrent()||responseId!==turn.responseId||turn.done.has(responseId))return false;
   if(event.type==='output_audio_buffer.started')mark(turn,'provider_audio_started_event');
   if(event.type==='response.done'){
    turn.done.add(responseId);mark(turn,'response_done_event');
    if(event.response?.status!=='completed'){rejectPending();return false;}
    const calls=event.response?.output?.filter(item=>item.type==='function_call')||[];
    if(calls.length){if(calls.length>4||calls.some(call=>!id(call.call_id)||turn.calls.has(call.call_id))||new Set(calls.map(call=>call.call_id)).size!==calls.length){rejectPending();return false;}for(const call of calls){turn.calls.add(call.call_id);turn.remainingCalls.add(call.call_id);}turn.continuation=true;turn.continuationRequested=false;return true;}
    pending=null;playback=turn;unschedule(turn.timer);turn.signal.removeEventListener('abort',turn.abort);turn.resolve({status:'provider_completed'});
   }
   return true;
  }
  return true;
 }
 return Object.freeze({
  submitTyped:text=>typeof text==='string'&&text.trim()&&text.length<=8192?submit({origin:'typed',action:'realtime',text}):Promise.resolve({status:'invalid'}),
  receive,
  toolOutput(output){if(!live()||!pending?.continuation||!pending.isCurrent()||output?.type!=='conversation.item.create'||output.item?.type!=='function_call_output'||!pending.remainingCalls.has(output.item.call_id)||typeof output.item.output!=='string'||output.item.output.length>65536)return false;try{frame(output);pending.remainingCalls.delete(output.item.call_id);return true}catch{interrupt();return false}},
  continueResponse(){if(!live()||!pending?.continuation||pending.continuationRequested||pending.remainingCalls.size||!pending.isCurrent())return false;try{pending.continuationRequested=true;frame(responseRequest(pending));return true}catch{interrupt();return false}},
  textUpdated(responseId){if(!live()||!pending||pending.responseId!==responseId||pending.done.has(responseId))return false;mark(pending,'text_dom_updated');return true;},
  navigate(workspace,options={}){requestedNavigation={workspace,guard:options.isCurrent};const door=['closet','saved_looks','styling'].includes(workspace)?'wardrobe':workspace;try{return bridge.navigate(door)}finally{requestedNavigation=null}},
  interrupt,
  detach(){if(detached)return;detached=true;rejectPending();bridge.end();},
  snapshot:()=>({active:live(),pending:!!pending,speechActive,conversation:bridge.snapshot(),timings:timing.snapshot()}),
  observePresentation:event=>live()&&lastReply?.observePresentation(event)===true
 });
}
