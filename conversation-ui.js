(function(root){
 'use strict';
 function mount({input,answer,askButton,stopInput=()=>{},navigate=async()=>true,chooseEndpoint=()=>'/api/fast',fetcher=fetch,requestTimeoutMs=30000,loadRuntime=async()=>[root.JamesConversationRuntime,root.JamesConversationRuntime]}){
  const doc=input.ownerDocument,endButton=doc.createElement('button'),status=doc.createElement('p');
  endButton.type='button';endButton.textContent='End conversation';status.setAttribute('role','status');status.textContent='Ready';
  askButton.parentNode.append(endButton);askButton.parentNode.after(status);
  let identity,bridge,loading,preparing,revision=0,history=[],scopeKey='',closure=null,ending=false;
  function clear(){history=[];scopeKey='';answer.textContent='';}
  async function bounded(operation,ms=requestTimeoutMs){let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('REQUEST_TIMEOUT')),ms)})]);}finally{clearTimeout(timer)}}
  async function requestJSON(url,options,limit=requestTimeoutMs){
   const controller=new AbortController(),upstream=options?.signal;let timer;
   const abort=()=>controller.abort();if(upstream?.aborted)abort();else upstream?.addEventListener('abort',abort,{once:true});
   
   try{
    return await Promise.race([(async()=>{
     const response=await fetcher(url,{...options,signal:controller.signal});
     const data=await response.json();return {ok:response.ok,status:response.status,json:async()=>data};
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('REQUEST_TIMEOUT'));},limit)})]);
   }catch(error){throw error;}finally{clearTimeout(timer);upstream?.removeEventListener('abort',abort);}
  }
  const identityFetch=(url,options)=>requestJSON(url,options,8000);
  async function runtime(){
   if(!loading)loading=loadRuntime().then(([ownerModule,bridgeModule])=>{
    identity=ownerModule.createConversationIdentityOwner({fetch:identityFetch,newOperationId:()=>crypto.randomUUID()});
    bridge=bridgeModule.createConversationBridge({identityOwner:identity,newId:()=>crypto.randomUUID(),navigate,capabilities:{ask:async({text,signal})=>{
     const response=await requestJSON(chooseEndpoint(text),{method:'POST',credentials:'same-origin',cache:'no-store',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({question:['Recent conversation:',...history.map(x=>`${x.role}: ${x.text}`),`User: ${text}`].join('\n'),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})});
     const data=await bounded(response.json());
     if(!response.ok){if([502,503].includes(response.status)&&['FAST_MODEL_UNAVAILABLE','FAST_MODEL_NOT_CONFIGURED'].includes(data?.error))return {ok:false,error:'FAST_MODEL_UNAVAILABLE'};if([401,403].includes(response.status)){++revision;bridge.revoke();identity.revoke();clear();stopInput();status.textContent='Sign in to continue';}throw Error(data?.error==='FAST_MODEL_UNAVAILABLE'?'MODEL_UNAVAILABLE':'REQUEST_FAILED');}if(!data.ok)throw Error('REQUEST_FAILED');
     return data;
    }}});
   }).catch(error=>{loading=null;throw error});
   await bounded(loading,10000);
  }
  async function ask(){
   const text=input.value.trim();if(!text||ending)return;
   const ticket=++revision;status.textContent='Connecting to James…';
   try{
    await runtime();if(ticket!==revision)return;
    if(closure){const result=await closure.retry?.();if(result?.status!=='ended')throw Error('END_UNCONFIRMED');closure=null;}
    status.textContent='Opening conversation…';preparing=identity.start();const scope=await preparing;preparing=null;
    if(ticket!==revision)return;
    const key=JSON.stringify(scope);if(scopeKey&&scopeKey!==key)clear();scopeKey=key;
    status.textContent='Checking conversation…';const verified=await bridge.verifyIdentity();if(ticket!==revision)return;if(verified.status!=='ready')throw Error('IDENTITY_UNAVAILABLE');
    bridge.interruptReply();
    status.textContent='James is thinking…';const result=await bridge.submitTurn({origin:'typed',action:'ask',text});
    if(ticket!==revision||result.status==='superseded')return;
    if(result.status!=='completed'||!result.isCurrent())throw Error('REQUEST_FAILED');
    const checked=await bridge.verifyIdentity();if(ticket!==revision)return;if(checked.status!=='ready'||!result.isCurrent())throw Error('IDENTITY_UNAVAILABLE');
    const data=result.result;if(data?.error==='FAST_MODEL_UNAVAILABLE')throw Error('MODEL_UNAVAILABLE');const reply=data.answer||data.final_recommendation?.recommendation;if(!reply)throw Error('EMPTY_ANSWER');
    answer.textContent=reply;
    if(data.final_recommendation?.confidence){const confidence=doc.createElement('p'),value=data.final_recommendation.confidence;confidence.textContent=`Confidence: ${Number.isFinite(value.score)?Math.round(value.score*100)+'%':''} ${value.label||''}`;answer.append(confidence);}
    if(data.final_recommendation){for(const [key,label] of [['reasons','Why'],['key_facts','Key facts'],['risks','Risks'],['what_would_change_the_answer','What would change the answer']]){
     const values=data.final_recommendation[key];if(!Array.isArray(values)||!values.length)continue;
     const title=doc.createElement('h5'),list=doc.createElement('ul');title.textContent=label;
     for(const value of values){const item=doc.createElement('li');item.textContent=typeof value==='string'?value:String(value?.fact||value?.text||value?.title||'');list.append(item);}answer.append(title,list);
    }}
    history.push({role:'User',text},{role:'James',text:reply});history=history.slice(-8);
    if(input.value.trim()===text)input.value='';status.textContent='Ready';
   }catch(error){if(ticket===revision){if(identity&&!identity.current())clear();status.textContent=closure?'End is not confirmed. Try End conversation again.':error?.message==='MODEL_UNAVAILABLE'?"James's configured model is unavailable. Your draft is still here.":'James could not complete this request. Your draft is still here.';}}
  }
  async function end(){
   if(ending)return;ending=true;const ticket=++revision;stopInput();bridge?.end();clear();status.textContent='Ending conversation…';
   try{
    if(preparing)try{await preparing}catch{}
    if(!identity){if(ticket===revision)status.textContent='No conversation has started on this screen.';return;}
    let result=closure?.retry?await closure.retry():await identity.end();
    if(result?.status==='closed'){
     // An absent local identity is not proof of server closure. Recover a
     // possibly committed start whose response was lost, then close it.
     await identity.snapshotIdentity();
     result=await identity.end();
    }
    if(ticket!==revision)return;
    closure=result?.status==='ended'?null:(result?.retry?result:{retry:()=>identity.end()});
    status.textContent=closure?'End is not confirmed. Try End conversation again.':'Conversation ended';
   }catch{if(ticket===revision){closure=closure||{retry:()=>identity.end()};status.textContent='End is not confirmed. Try End conversation again.';}}finally{ending=false;}
  }
  askButton.onclick=ask;endButton.onclick=end;
  return {ask,end,async navigate(door){if(bridge?.snapshot().identity)return bridge.navigate(door);return {status:'unavailable'};},revoke(){++revision;stopInput();bridge?.revoke();identity?.revoke();clear();status.textContent='Sign in to continue';}};
 }
 root.JamesConversationUI={mount};
})(typeof window==='undefined'?globalThis:window);
