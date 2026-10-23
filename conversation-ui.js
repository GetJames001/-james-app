(function(root){
 'use strict';
 function mount({input,answer,askButton,stopInput=()=>{},navigate=async()=>true,chooseEndpoint=()=>'/api/fast',fetcher=fetch,loadRuntime=()=>Promise.all([import('/conversation-identity.mjs'),import('/conversation-bridge.mjs')])}){
  const doc=input.ownerDocument,endButton=doc.createElement('button'),status=doc.createElement('p');
  endButton.type='button';endButton.textContent='End conversation';status.setAttribute('role','status');status.textContent='Ready';
  askButton.parentNode.append(endButton);askButton.parentNode.after(status);
  let identity,bridge,loading,preparing,revision=0,history=[],scopeKey='',closure=null,ending=false;
  function clear(){history=[];scopeKey='';answer.textContent='';}
  async function runtime(){
   if(!loading)loading=loadRuntime().then(([ownerModule,bridgeModule])=>{
    identity=ownerModule.createConversationIdentityOwner({fetch:fetcher,newOperationId:()=>crypto.randomUUID()});
    bridge=bridgeModule.createConversationBridge({identityOwner:identity,newId:()=>crypto.randomUUID(),navigate,capabilities:{ask:async({text,signal})=>{
     const response=await fetcher(chooseEndpoint(text),{method:'POST',credentials:'same-origin',cache:'no-store',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({question:['Recent conversation:',...history.map(x=>`${x.role}: ${x.text}`),`User: ${text}`].join('\n'),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})});
     if(!response.ok){if([401,403].includes(response.status)){bridge.revoke();identity.revoke();clear();stopInput();}throw Error('REQUEST_FAILED');}const data=await response.json();if(!data.ok)throw Error('REQUEST_FAILED');
     return data;
    }}});
   }).catch(error=>{loading=null;throw error});
   await loading;
  }
  async function ask(){
   const text=input.value.trim();if(!text||ending)return;
   const ticket=++revision;status.textContent='James is thinking…';
   try{
    await runtime();if(ticket!==revision)return;
    if(closure){const result=await closure.retry?.();if(result?.status!=='ended')throw Error('END_UNCONFIRMED');closure=null;}
    preparing=identity.start();const scope=await preparing;preparing=null;
    if(ticket!==revision)return;
    const key=JSON.stringify(scope);if(scopeKey&&scopeKey!==key)clear();scopeKey=key;
    const verified=await bridge.verifyIdentity();if(ticket!==revision)return;if(verified.status!=='ready')throw Error('IDENTITY_UNAVAILABLE');
    bridge.interruptReply();
    const result=await bridge.submitTurn({origin:'typed',action:'ask',text});
    if(ticket!==revision||result.status==='superseded')return;
    if(result.status!=='completed'||!result.isCurrent())throw Error('REQUEST_FAILED');
    const checked=await bridge.verifyIdentity();if(ticket!==revision)return;if(checked.status!=='ready'||!result.isCurrent())throw Error('IDENTITY_UNAVAILABLE');
    const data=result.result,reply=data.answer||data.final_recommendation?.recommendation;if(!reply)throw Error('EMPTY_ANSWER');
    answer.textContent=reply;
    if(data.final_recommendation?.confidence){const confidence=doc.createElement('p'),value=data.final_recommendation.confidence;confidence.textContent=`Confidence: ${Number.isFinite(value.score)?Math.round(value.score*100)+'%':''} ${value.label||''}`;answer.append(confidence);}
    if(data.final_recommendation){for(const [key,label] of [['reasons','Why'],['key_facts','Key facts'],['risks','Risks'],['what_would_change_the_answer','What would change the answer']]){
     const values=data.final_recommendation[key];if(!Array.isArray(values)||!values.length)continue;
     const title=doc.createElement('h5'),list=doc.createElement('ul');title.textContent=label;
     for(const value of values){const item=doc.createElement('li');item.textContent=typeof value==='string'?value:String(value?.fact||value?.text||value?.title||'');list.append(item);}answer.append(title,list);
    }}
    history.push({role:'User',text},{role:'James',text:reply});history=history.slice(-8);
    if(input.value.trim()===text)input.value='';status.textContent='Ready';
   }catch{if(ticket===revision){if(identity&&!identity.current())clear();status.textContent=closure?'End is not confirmed. Try End conversation again.':'James could not complete this request. Your draft is still here.';}}
  }
  async function end(){
   if(ending)return;ending=true;++revision;stopInput();bridge?.end();clear();status.textContent='Ending conversation…';
   try{
    if(preparing)try{await preparing}catch{}
    if(!identity){status.textContent='Conversation ended';return;}
    const result=closure?.retry?await closure.retry():await identity.end();
    closure=result.status==='unconfirmed'?result:null;
    status.textContent=closure?'End is not confirmed. Try End conversation again.':'Conversation ended';
   }catch{status.textContent='End is not confirmed. Try End conversation again.';}finally{ending=false;}
  }
  askButton.onclick=ask;endButton.onclick=end;
  return {ask,end,async navigate(door){if(bridge?.snapshot().identity)return bridge.navigate(door);return {status:'unavailable'};},revoke(){++revision;stopInput();bridge?.revoke();identity?.revoke();clear();status.textContent='Sign in to continue';}};
 }
 root.JamesConversationUI={mount};
})(typeof window==='undefined'?globalThis:window);
