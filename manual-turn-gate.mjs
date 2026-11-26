// Local control contract. Caller must own the exact active session, use a
// dedicated VAD-disabled reliable/ordered control channel, and gate the real track
// before attaching it. No microphone, DOM, network, or automatic retry here.
export function createManualTurnGate({
  setMic, send, onCommitted, onFailure = () => {},
  now = () => performance.now(), arm = setTimeout, disarm = clearTimeout,
  clearMs = 1000, commitMs = 2000, minHoldMs = 350, maxHoldMs = 20000,
} = {}) {
  if (![setMic, send, onCommitted, onFailure, now, arm, disarm].every(x=>typeof x==='function') ||
      ![clearMs,commitMs,minHoldMs,maxHoldMs].every(x=>Number.isInteger(x)&&x>0) || maxHoldMs<=minHoldMs)
    throw TypeError('Invalid manual-turn dependencies');
  let phase='unready', gesture=null, timer=null, generation=0, start=0, deadline=0;
  const items=new Set(), clearEvents=new Set();
  function clearTimer(){generation++;if(timer!==null){disarm(timer);timer=null;}}
  function schedule(delay,expired){
    clearTimer(); const ticket=generation;
    deadline=now()+delay; timer=arm(()=>{if(ticket===generation)expired();},delay);
  }
  function shut(next,reason){
    if(phase==='closed'||phase==='failed')return false;
    phase=next;gesture=null;clearTimer();
    try{setMic(false);}catch{}
    if(reason)try{onFailure(reason);}catch{}
    return false;
  }
  const fail=reason=>shut('failed',reason);
  function frame(type){try{if(send({type})===false)return fail('control_send_failed');}catch{return fail('control_send_failed');}return phase!=='failed'&&phase!=='closed';}
  function clearDiscard(){
    phase='discarding';
    schedule(clearMs,()=>fail('clear_timeout'));
    return frame('input_audio_buffer.clear');
  }
  function endCapture(commit){
    clearTimer();gesture=null;
    try{setMic(false);}catch{return fail('mic_gate_failed');}
    if(!commit)return clearDiscard();
    phase='committing';schedule(commitMs,()=>fail('commit_timeout'));
    return frame('input_audio_buffer.commit');
  }
  try{setMic(false);}catch{fail('mic_gate_failed');}
  return {
    ready({vadDisabled,channelOrdered,channelReliable}={}){
      if(phase!=='unready')return false;
      if(vadDisabled!==true||channelOrdered!==true||channelReliable!==true)return fail('manual_mode_not_verified');
      phase='idle';return true;
    },
    press(token){
      if(phase!=='idle'||token===null||token===undefined)return false;
      gesture=token;phase='clearing';schedule(clearMs,()=>fail('clear_timeout'));
      return frame('input_audio_buffer.clear');
    },
    release(token){
      if(gesture===null||token!==gesture)return false;
      if(phase==='clearing'){gesture=null;phase='discarding';return true;}
      if(phase!=='capturing')return false;
      const duration=now()-start;
      return endCapture(duration>=minHoldMs&&duration<maxHoldMs);
    },
    cancel(token){
      if(gesture===null||token!==gesture)return false;
      if(phase==='clearing'){gesture=null;phase='discarding';return true;}
      if(phase==='capturing')return endCapture(false);
      return false;
    },
    receive(event){
      if(phase==='failed'||phase==='closed'||!event)return false;
      switch(event.type){
        case 'input_audio_buffer.speech_started':
        case 'input_audio_buffer.speech_stopped':
          return fail('unexpected_vad_in_manual_mode');
        case 'input_audio_buffer.cleared':
          if(typeof event.event_id!=='string'||!event.event_id||event.event_id.length>128)return fail('invalid_clear_ack');
          if(clearEvents.has(event.event_id))return false;
          if(phase!=='clearing'&&phase!=='discarding')return false;
          if(now()>=deadline)return fail('clear_timeout');
          if(clearEvents.size>=1024)return fail('session_clear_cap');
          clearEvents.add(event.event_id);
          clearTimer();
          if(phase==='discarding'){phase='idle';return true;}
          phase='capturing';start=now();
          try{setMic(true);}catch{return fail('mic_gate_failed');}
          schedule(maxHoldMs,()=>endCapture(false));return true;
        case 'input_audio_buffer.committed': {
          const id=event.item_id;
          if(typeof id!=='string'||!id||id.length>128)return fail('invalid_commit_ack');
          if(items.has(id))return false;
          if(phase!=='committing'||now()>=deadline)return fail(phase==='committing'?'commit_timeout':'unexpected_commit');
          if(items.size>=256)return fail('session_turn_cap');
          items.add(id);clearTimer();phase='idle';
          try{onCommitted(id);}catch{return fail('commit_delivery_failed');}return true;
        }
        case 'error':
          // Only pass errors correlated to the manual input control exchange here.
          // Other provider errors are handled by the existing session coordinator.
          return fail('manual_control_error');
        default:return false;
      }
    },
    close(){shut('closed');},
    state(){return phase;},
  };
}