// Host integration seam only: never opens a microphone, chooses a model,
// authenticates a client-supplied owner or creates a conversation identity.
const plain = v => v && Object.getPrototypeOf(v) === Object.prototype;
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(v);
const doors = new Set(['briefing', 'calendar', 'wardrobe', 'finance', 'health', 'growth', 'tasks', 'files', 'workbench']);
const keys = (v, allowed) => plain(v) && Object.keys(v).every(k => allowed.includes(k));
function context(value = {}) {
  if (!keys(value, ['projectId','outfitId','versionId','garmentId']) || !Object.values(value).every(id)) throw Error('Invalid selection');
  return Object.freeze({...value});
}
function scope(value) {
  if (!keys(value, ['accountId','conversationId','generation']) || !id(value.accountId) || !id(value.conversationId) || !Number.isSafeInteger(value.generation) || value.generation < 0) throw Error('Verified host scope required');
  return Object.freeze({...value});
}
export function createConversationBridge({identityOwner, navigate, capabilities, newId, timing = null, capacity = 128}) {
  if (typeof identityOwner?.snapshotIdentity !== 'function' || typeof navigate !== 'function' || !plain(capabilities) || !Object.values(capabilities).every(fn=>typeof fn==='function') || typeof newId !== 'function' || !Number.isInteger(capacity) || capacity<1 || capacity>1024) throw Error('Host dependencies required');
  let identity = null, epoch = 0, voice = null, unsubscribe = null, door = 'briefing', selection = context(), navRevision = 0, replyRevision = 0;
  let verification = 0, sequence = 0, timingGeneration = 0;
  const pending = new Map(), usedIds = new Set(), listeners = new Set(), selections = new Map(), presentations = new Map();
  const measure = (method, value) => {try {return timing?.[method]?.(value)} catch {return false}};
  const emit = (stage, turnId) => {const event = Object.freeze({stage, ...(turnId ? {turnId} : {}), sequence:++sequence});for(const fn of listeners)try{fn(event)}catch{}};
  function abortTurns(status) {
    for (const turn of pending.values()) {turn.abort.abort();measure('close',{turnId:turn.id,generation:turn.timingGeneration,status});}
    pending.clear();
    for(const turn of presentations.values())measure('close',{turnId:turn.id,generation:turn.timingGeneration,status});
    presentations.clear();
  }
  function detachVoice(stop) {
    const prior = voice;voice = null;
    try {unsubscribe?.()} catch {} unsubscribe = null;
    if (stop && prior) try {prior.end()} catch {}
  }
  function invalidate(stage) {
    const reservedEpoch = ++epoch;verification++;navRevision++;replyRevision++;
    identity = null;selection = context();selections.clear();door = 'briefing';abortTurns(stage==='ended'?'ended':'interrupted');usedIds.clear();
    detachVoice(true);measure('rotate',++timingGeneration);emit(stage);return reservedEpoch;
  }
  async function verifyIdentity() {
    const check = ++verification;
    let next;
    try {next = scope(await identityOwner.snapshotIdentity())} catch {
      if(check!==verification)return {status:'superseded'};
      invalidate('revoked');return {status:'unavailable'};
    }
    if(check!==verification)return {status:'superseded'};
    if(identity && identity.accountId===next.accountId && identity.conversationId===next.conversationId && identity.generation===next.generation)return {status:'ready'};
    const reservedEpoch = invalidate('revoked');
    if(epoch!==reservedEpoch)return {status:'superseded'};
    identity = next;emit('ready');return {status:identity===next?'ready':'superseded'};
  }
  const current = (turn) => identity===turn.identity && epoch===turn.epoch && !turn.abort.signal.aborted;
  async function submitTurn(input) {
    if (!identity) return {status:'unavailable'};
    if (!keys(input,['origin','action','text']) || !['typed','voice'].includes(input.origin) || typeof input.action!=='string' || !Object.hasOwn(capabilities,input.action) || typeof input.text!=='string' || !input.text.trim() || input.text.length>8192)return {status:'invalid'};
    if (usedIds.size>=capacity)return {status:'capacity'};
    const turnId = newId();if(!id(turnId)||usedIds.has(turnId))return {status:'invalid_id'};
    const turn = {id:turnId,identity,epoch,replyRevision,door,selection,workspaceSelections:Object.freeze(Object.fromEntries(selections)),timingGeneration,abort:new AbortController()};
    usedIds.add(turnId);pending.set(turnId,turn);
    measure('begin',{turnId,generation:turn.timingGeneration});measure('mark',{turnId,generation:turn.timingGeneration,event:'request_start'});emit('turn_started',turnId);
    if(!current(turn))return {status:'superseded',turnId};
    let result;
    try {
      // The registered adapter MUST authorize each server operation. This
      // copied scope correlates requests; it is not a permission grant.
      result = await capabilities[input.action]({text:input.text,origin:input.origin,turnId,scope:turn.identity,workspace:turn.door,selection:turn.selection,workspaceSelections:turn.workspaceSelections,signal:turn.abort.signal,isCurrent:()=>current(turn)});
    } catch {
      if(!current(turn))return {status:'superseded',turnId};
      pending.delete(turnId);measure('close',{turnId,generation:turn.timingGeneration,status:'failed'});emit('turn_failed',turnId);return {status:'failed',turnId};
    }
    if(!current(turn))return {status:'superseded',turnId};
    pending.delete(turnId);measure('mark',{turnId,generation:turn.timingGeneration,event:'response_decoded'});
    if(turn.replyRevision===replyRevision)presentations.set(turnId,turn);
    emit('capability_completed',turnId); // output is not complete yet
    // Caller must gate delayed presentation with isCurrent(). A navigation
    // changes no conversation identity and does not reinterpret this turn.
    return {status:'completed',turnId,result,mayReply:current(turn)&&turn.replyRevision===replyRevision,isCurrent:()=>current(turn)&&turn.replyRevision===replyRevision,observePresentation:event=>observePresentation(turn,event)};
  }
  // Trusted host hook. A provider response.done or capability result is not
  // evidence of speaker audibility, meaningful content or full presentation.
  function observePresentation(turn,event) {
    if(!['text_painted','audible_start_observed','meaningful_answer_observed','answer_complete_observed'].includes(event)||!current(turn)||turn.replyRevision!==replyRevision||presentations.get(turn.id)!==turn)return false;
    measure('mark',{turnId:turn.id,generation:turn.timingGeneration,event});
    if(event==='answer_complete_observed'){
      measure('close',{turnId:turn.id,generation:turn.timingGeneration,status:'completed'});
      presentations.delete(turn.id);
    }
    return true;
  }
  function attachVoice(adapter) {
    if (!identity || voice || typeof adapter?.subscribeTurn!=='function' || typeof adapter?.end!=='function' || typeof adapter?.interruptReply!=='function')return false;
    const at = epoch;voice = adapter;
    try {
      const detach = adapter.subscribeTurn(input => voice===adapter && epoch===at ? submitTurn({...input,origin:'voice'}) : Promise.resolve({status:'superseded'}));
      if(typeof detach!=='function')throw Error('Unsubscribe required');
      if(voice!==adapter || epoch!==at){try{detach()}catch{}return false;}
      unsubscribe = detach;
    } catch {detachVoice(false);return false;}
    return true;
  }
  async function navigateTo(nextDoor, nextSelection) {
    if(!identity || !doors.has(nextDoor))return {status:'unavailable'};
    let selected;try{selected=context(nextSelection ?? selections.get(nextDoor) ?? {})}catch{return {status:'invalid'}};
    const ticket = ++navRevision, at = epoch, owner = identity;
    const isCurrent = ()=>ticket===navRevision && at===epoch && owner===identity;
    let result;try {result=await navigate(nextDoor,{selection:selected,scope:owner,isCurrent})}catch{result=false}
    if(!isCurrent())return {status:'superseded'};
    if(result!==true)return {status:'blocked'};
    door=nextDoor;selection=selected;selections.set(door,selected);emit('navigated');return {status:'ready'};
  }
  function interruptReply() {
    if(!identity)return false;
    replyRevision++;
    for(const turn of [...pending.values(),...presentations.values()])measure('close',{turnId:turn.id,generation:turn.timingGeneration,status:'interrupted'});
    presentations.clear();
    try{voice?.interruptReply()}catch{}emit('reply_interrupted');return true;
  }
  function end() {const active=!!identity;invalidate('ended');return {status:active?'ended':'closed'};}
  return {
    verifyIdentity,submitTurn,attachVoice,navigate:navigateTo,interruptReply,end,
    revoke:()=>invalidate('revoked'),
    snapshot:()=>({identity:identity?{...identity}:null,workspace:door,selection:{...selection},workspaceSelections:Object.fromEntries([...selections].map(([key,value])=>[key,{...value}])),pending:pending.size,voiceAttached:!!voice}),
    subscribeEvents(fn){if(typeof fn!=='function')throw Error('Observer required');listeners.add(fn);return ()=>listeners.delete(fn)}
  };
}
