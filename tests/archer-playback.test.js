'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={AbortController};vm.runInNewContext(fs.readFileSync('voice-session.js','utf8'),context);
const {createArcherPlayback}=context.JamesVoiceSession;
const scope={accountId:'fixture',conversationId:'fixture-conversation',generation:1};
function harness(fetcher){
 let played=0,ended=0,speaking=0,errors=[],revoked=[],active=true,created=0,paused=0,removed=0;
 const audio={muted:true,pause(){paused++;},removeAttribute(){removed++;},async play(){played++;}};
 const playback=createArcherPlayback({audio,fetcher,scope,isCurrent:()=>active,onSpeaking:()=>speaking++,onEnded:()=>ended++,onError:error=>errors.push(error),urlAPI:{createObjectURL:()=>{created++;return 'blob:fixture';},revokeObjectURL:url=>revoked.push(url)}});
 return {audio,playback,read:()=>({played,ended,speaking,errors,revoked,created,paused,removed}),end:()=>{active=false;playback.cancel();}};
}
test('Archer speaks the exact completed reply with its current conversation and releases audio',async()=>{
 let request;const h=harness(async(url,options)=>{request={url,options};return {ok:true,blob:async()=>({})};});
 await h.playback.play('Use 6 cups of chicken broth.');
 assert.equal(request.url,'/api/james/speech');assert.deepEqual(JSON.parse(request.options.body),{scope,text:'Use 6 cups of chicken broth.'});
 assert.equal(h.read().played,1);assert.equal(h.audio.muted,false);h.audio.onended();assert.equal(h.read().ended,1);assert.equal(h.read().revoked.length,1);
});
test('interrupting Archer rejects a late audio response and new turn remains usable',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);const h=harness(async()=>pending);
 const play=h.playback.play('Old instruction');h.playback.cancel();release({ok:true,blob:async()=>({})});await play;
 assert.equal(h.read().played,0);assert.equal(h.read().created,0);
 await h.playback.play('New instruction');assert.equal(h.read().played,1);
 h.end();assert.equal(h.audio.onended,null);assert.equal(h.read().revoked.length,1);
});
test('late decoded audio after End does not play, and failed speech never switches to another voice',async()=>{
 let release;const h=harness(async()=>({ok:true,blob:()=>new Promise(resolve=>release=resolve)}));
 const task=h.playback.play('Old recipe');await new Promise(resolve=>setImmediate(resolve));h.end();release({});await task;assert.equal(h.read().played,0);
 const failure=harness(async()=>({ok:false,json:async()=>({error:'ARCHER_ACCESS_REQUIRED'})}));await failure.playback.play('Reply');assert.equal(failure.read().played,0);assert.deepEqual(failure.read().errors,['ARCHER_ACCESS_REQUIRED']);
});

test('idle Archer cancellation never pauses or resets the browser audio element',()=>{const h=harness(async()=>{throw Error('No fetch expected')});h.playback.cancel();h.playback.cancel();assert.equal(h.read().paused,0);assert.equal(h.read().removed,0);assert.equal(h.read().created,0);});
test('speech onset while TTS is fetching cancels work without touching idle audio',async()=>{let release,signal;const h=harness(async(_url,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve)});const task=h.playback.play('Pending');assert.equal(h.read().paused,0);h.playback.cancel();assert.equal(signal.aborted,true);release({ok:true,blob:async()=>({})});await task;assert.equal(h.read().paused,0);assert.equal(h.read().removed,0);assert.equal(h.read().played,0);});
test('interrupting real Archer playback still pauses and releases media exactly once',async()=>{const h=harness(async()=>({ok:true,blob:async()=>({})}));await h.playback.play('Audible');assert.equal(h.read().paused,0);h.playback.cancel();h.playback.cancel();assert.equal(h.read().paused,1);assert.equal(h.read().removed,1);assert.equal(h.read().revoked.length,1);});
