'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Exercise the actual session health check with controlled track/stats metadata.
const source=fs.readFileSync(require.resolve('../voice-session'),'utf8');
const checkSource=source.slice(source.indexOf('  async function checkInput(s){'),source.indexOf('  function context(s)'));
function fixture({heardSpeech=true,packets=120,muted=false,ended=false}={}){
 const messages=[],report={},track={enabled:true,muted,readyState:ended?'ended':'live'};
 const session={ready:true,heardSpeech,phase:'listening',readyAt:Date.now()-30000,stream:{getAudioTracks:()=>[track]},pc:{getStats:async()=>new Map([['out',{type:'outbound-rtp',kind:'audio',packetsSent:packets}]])}};
 const check=vm.runInNewContext(checkSource+';checkInput',{current:s=>s===session,close:m=>messages.push(m),state:(_s,m)=>messages.push(m),connectionReport:report,diagnostic:s=>({speechDetected:s.heardSpeech,audioPackets:s.audioPackets}),Date,JSON});
 return {session,messages,report,run:()=>check(session)};
}
test('RTP diagnostics continue after speech_started without claiming no speech was detected',async()=>{const f=fixture();await f.run();assert.equal(f.session.audioPackets,120);assert.equal(JSON.parse(f.report.textContent).speechDetected,true);assert.deepEqual(f.messages,[]);});
test('transient muted input after speech_started does not close an established session',async()=>{const f=fixture({muted:true});await f.run();assert.deepEqual(f.messages,[]);assert.equal(f.session.audioPackets,120);});
test('before first speech the original no-input check is retained',async()=>{const f=fixture({heardSpeech:false,muted:true});await f.run();assert.match(f.messages[0],/no audio is reaching/);});
test('ended input after speech_started is reported without requesting a reply',async()=>{const f=fixture({ended:true});await f.run();assert.match(f.messages[0],/microphone stopped/);});
test('no speech guidance is retained only for sessions without speech',async()=>{const f=fixture({heardSpeech:false});await f.run();assert.match(f.messages[0],/has not detected speech/);});
