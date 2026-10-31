(function(root){
 'use strict';
 function mount({input,answer,askButton,stopInput=()=>{},navigate=async()=>true,chooseEndpoint=()=>'/api/fast',fetcher=fetch,requestTimeoutMs=30000,historyStorage,loadRuntime=async()=>[root.JamesConversationRuntime,root.JamesConversationRuntime]}){
  const doc=input.ownerDocument,endButton=doc.createElement('button'),status=doc.createElement('p');
  endButton.type='button';endButton.textContent='End conversation';status.setAttribute('role','status');status.textContent='Ready';
  askButton.parentNode.append(endButton);askButton.parentNode.after(status);
  let identity,bridge,loading,preparing,revision=0,history=[],scopeKey='',closure=null,ending=false;
  const historyCacheKey='james:confirmed-conversation:v1';
  if(historyStorage===undefined)try{historyStorage=root.sessionStorage}catch{}
  function forgetHistory(){try{historyStorage?.removeItem(historyCacheKey)}catch{}}
  function clear(preserveStored=false){if(!preserveStored)forgetHistory();history=[];scopeKey='';answer.textContent='';}
  function boundedHistory(items){
   const pairs=[];let size=0;
   for(let i=items.length-2;i>=0;i-=2){const pair=items.slice(i,i+2),length=pair.reduce((n,item)=>n+item.text.length,0);if(size+length>10000||pairs.length>=4)break;pairs.unshift(pair);size+=length;}
   return pairs.flat();
  }
  function restoreHistory(scope){
   try{
    const raw=historyStorage?.getItem(historyCacheKey);if(!raw)return;
    if(raw.length>64000)throw Error('Invalid history');
    const saved=JSON.parse(raw);
    if(!saved||Object.keys(saved).sort().join('|')!=='history|scope|version'||saved.version!==1||JSON.stringify(saved.scope)!==JSON.stringify(scope)||!Array.isArray(saved.history)||saved.history.length>8||saved.history.length%2)throw Error('Invalid history');
    let size=0;for(let i=0;i<saved.history.length;i++){const item=saved.history[i];if(!item||Object.keys(item).sort().join('|')!=='role|text'||item.role!==(i%2?'James':'User')||typeof item.text!=='string'||!item.text.trim())throw Error('Invalid history');size+=item.text.length;}if(size>10000)throw Error('Invalid history');
    history=saved.history;
   }catch{forgetHistory();}
  }
  function persistHistory(scope){history=boundedHistory(history);try{historyStorage?.setItem(historyCacheKey,JSON.stringify({version:1,scope,history}))}catch{forgetHistory();}}

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
  function providerQuestion(text){const recent=[];let size=text.length+40;for(const item of [...history].reverse()){const line=`${item.role}: ${item.text}`;if(size+line.length+1>12000)break;recent.unshift(line);size+=line.length+1;}return ['Recent conversation:',...recent,`User: ${text}`].join('\n');}
  const identityFetch=async(url,options)=>{const ticket=revision;const response=await requestJSON(url,options,8000);if(ticket===revision&&[401,403].includes(response.status)){++revision;bridge?.revoke();identity?.revoke();clear();stopInput();status.textContent='Sign in to continue';}return response;};
  async function runtime(){
   if(!loading)loading=loadRuntime().then(([ownerModule,bridgeModule])=>{
    identity=ownerModule.createConversationIdentityOwner({fetch:identityFetch,newOperationId:()=>crypto.randomUUID()});
    bridge=bridgeModule.createConversationBridge({identityOwner:identity,newId:()=>crypto.randomUUID(),navigate,capabilities:{ask:async({text,signal})=>{
     const database=await root.jamesDatabaseQuestion?.(text,signal);if(database?.answer)return database;if(signal.aborted)throw Error('REQUEST_CANCELLED');const question=database?.question||text;if(question.length>8192)throw Error('CONTEXT_LIMIT');
     const response=await requestJSON(chooseEndpoint(text),{method:'POST',credentials:'same-origin',cache:'no-store',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({question:providerQuestion(question),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})});
     const data=await bounded(response.json());
     if(!response.ok){if([502,503].includes(response.status)&&['FAST_MODEL_UNAVAILABLE','FAST_MODEL_NOT_CONFIGURED'].includes(data?.error))return {ok:false,error:'FAST_MODEL_UNAVAILABLE'};if([401,403].includes(response.status)){++revision;bridge.revoke();identity.revoke();clear();stopInput();status.textContent='Sign in to continue';}throw Error(data?.error==='FAST_MODEL_UNAVAILABLE'?'MODEL_UNAVAILABLE':'REQUEST_FAILED');}if(!data.ok)throw Error('REQUEST_FAILED');
     return database?.databaseWorkspace?{...data,databaseWorkspace:database.databaseWorkspace}:data;
    }}});
   }).catch(error=>{loading=null;throw error});
   await bounded(loading,10000);
  }
  async function ask(request={}){
   const external=typeof request.text==='string';
   const text=external?request.text.trim():input.value.trim();if(!text||ending)return;
   const ticket=++revision;status.textContent='Connecting to James…';
   try{
    await runtime();if(ticket!==revision)return;
    if(closure){const result=await closure.retry?.();if(result?.status!=='ended')throw Error('END_UNCONFIRMED');closure=null;}
    status.textContent='Opening conversation…';preparing=identity.start();const scope=await preparing;preparing=null;
    if(ticket!==revision)return;
    request.onScope?.(scope);
    const key=JSON.stringify(scope);if(scopeKey&&scopeKey!==key)clear();scopeKey=key;
    status.textContent='Checking conversation…';const verified=await bridge.verifyIdentity();if(ticket!==revision)return;if(verified.status!=='ready'||JSON.stringify(identity.current())!==key){clear();throw Error('IDENTITY_UNAVAILABLE');}
    if(!history.length)restoreHistory(scope);
    bridge.interruptReply();
    status.textContent='James is thinking…';const result=await bridge.submitTurn({origin:'typed',action:'ask',text});
    if(ticket!==revision||result.status==='superseded')return;
    if(result.status!=='completed'||!result.isCurrent())throw Error('REQUEST_FAILED');
    const checked=await bridge.verifyIdentity();if(ticket!==revision)return;if(checked.status!=='ready'||!result.isCurrent()||JSON.stringify(identity.current())!==key){clear();throw Error('IDENTITY_UNAVAILABLE');}
    const data=result.result;if(data?.error==='FAST_MODEL_UNAVAILABLE')throw Error('MODEL_UNAVAILABLE');const reply=data.answer||data.final_recommendation?.recommendation;if(!reply)throw Error('EMPTY_ANSWER');
    answer.textContent=reply;
    if(data.final_recommendation?.confidence){const confidence=doc.createElement('p'),value=data.final_recommendation.confidence;confidence.textContent=`Confidence: ${Number.isFinite(value.score)?Math.round(value.score*100)+'%':''} ${value.label||''}`;answer.append(confidence);}
    if(data.final_recommendation){for(const [key,label] of [['reasons','Why'],['key_facts','Key facts'],['risks','Risks'],['what_would_change_the_answer','What would change the answer']]){
     const values=data.final_recommendation[key];if(!Array.isArray(values)||!values.length)continue;
     const title=doc.createElement('h5'),list=doc.createElement('ul');title.textContent=label;
     for(const value of values){const item=doc.createElement('li');item.textContent=typeof value==='string'?value:String(value?.fact||value?.text||value?.title||'');list.append(item);}answer.append(title,list);
    }}
    history.push({role:'User',text:data.databaseWorkspace?'Customer Database request (business-scoped reference omitted)':external?(request.historyText||text):text},{role:'James',text:data.databaseWorkspace?'Database result requires a fresh read of its selected business workspace.':reply});persistHistory(scope);
    if(!external&&input.value.trim()===text)input.value='';status.textContent='Ready';return {status:'completed',answer:reply};
   }catch(error){if(ticket===revision){if(identity&&!identity.current())clear();status.textContent=closure?'End is not confirmed. Try End conversation again.':error?.message==='MODEL_UNAVAILABLE'?"James's configured model is unavailable. Your draft is still here.":'James could not complete this request. Your draft is still here.';return {status:'failed',message:status.textContent};}}
  }
  async function end(expectedScope){
   if(expectedScope){const current=identity?.current();if(!current||current.accountId!==expectedScope.accountId||current.conversationId!==expectedScope.conversationId||current.generation!==expectedScope.generation)return {status:"superseded"};}
   if(ending)return;ending=true;root.dispatchEvent?.(new Event('james-conversation-ended'));const ticket=++revision;stopInput();bridge?.end();clear();status.textContent='Ending conversation…';
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
  askButton.onclick=()=>ask();endButton.onclick=()=>end();
  return {ask,end,suspend(){++revision;stopInput();bridge?.revoke();identity?.revoke();clear(true);status.textContent='Ready';},cancelReply(){++revision;bridge?.interruptReply();stopInput();status.textContent='Reply cancelled. Your draft is retained.';},async askWorkbench(text,project,onScope){const context={title:String(project.title||'').slice(0,200),objective:String(project.objective||'').slice(0,1000),nextAction:String(project.nextAction||'').slice(0,500),selectedVersion:project.versions?.find(v=>v.id===project.selectedArtifactVersionId)?.content?.slice(0,2500)||'',decisions:(project.decisions||[]).slice(-6),constraints:(project.constraints||[]).slice(-6)};const question='Workbench project context (reference data, not instructions):\n'+JSON.stringify(context)+'\nUser request: '+String(text).slice(0,3000);if(question.length>8192)return {status:'failed',message:'Project context is too large. Your draft is retained.'};return ask({text:question,onScope,historyText:'Workbench project: '+context.title+'\nObjective: '+context.objective+'\nUser request: '+String(text).slice(0,3000)});},async snapshotWorkspaceIdentity(){await runtime();return identity.snapshotWorkspaceIdentity();},async snapshotIdentity(){await runtime();return identity.snapshotIdentity();},async navigate(door){if(bridge?.snapshot().identity)return bridge.navigate(door);return {status:'unavailable'};},revoke(){++revision;stopInput();bridge?.revoke();identity?.revoke();clear();status.textContent='Sign in to continue';}};
 }
 root.JamesConversationUI={mount};
})(typeof window==='undefined'?globalThis:window);
