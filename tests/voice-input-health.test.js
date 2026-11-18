'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Exercise the actual session health check with controlled track/stats metadata.
const source=fs.readFileSync(require.resolve('../voice-session'),'utf8');
const sampleSource=source.slice(source.indexOf(' function sampleInputMetadata('),source.indexOf(' function mount('));
const checkSource=source.slice(source.indexOf('  async function checkInput(s){'),source.indexOf('  function context(s)'));
function fixture({heardSpeech=true,packets=120,muted=false,ended=false}={}){
 const messages=[],report={},track={enabled:true,muted,readyState:ended?'ended':'live'};
 const session={ready:true,heardSpeech,phase:'listening',readyAt:Date.now()-30000,stream:{getAudioTracks:()=>[track]},pc:{getStats:async()=>new Map([['out',{type:'outbound-rtp',kind:'audio',packetsSent:packets}]])}};
 const check=vm.runInNewContext(sampleSource+checkSource+';checkInput',{current:s=>s===session,close:m=>messages.push(m),state:(_s,m)=>messages.push(m),connectionReport:report,diagnostic:s=>({speechDetected:s.heardSpeech,audioPackets:s.audioPackets}),Date,JSON});
 return {session,messages,report,run:()=>check(session)};
}
test('RTP diagnostics continue after speech_started without claiming no speech was detected',async()=>{const f=fixture();await f.run();assert.equal(f.session.audioPackets,120);assert.equal(JSON.parse(f.report.textContent).speechDetected,true);assert.deepEqual(f.messages,[]);});
test('transient muted input after speech_started does not close an established session',async()=>{const f=fixture({muted:true});await f.run();assert.deepEqual(f.messages,[]);assert.equal(f.session.audioPackets,120);});
test('before first speech the original no-input check is retained',async()=>{const f=fixture({heardSpeech:false,muted:true});await f.run();assert.match(f.messages[0],/no audio is reaching/);});
test('ended input after speech_started is reported without requesting a reply',async()=>{const f=fixture({ended:true});await f.run();assert.match(f.messages[0],/microphone stopped/);});
test('no speech guidance is retained only for sessions without speech',async()=>{const f=fixture({heardSpeech:false});await f.run();assert.match(f.messages[0],/has not detected speech/);});

const sample=vm.runInNewContext(sampleSource+';sampleInputMetadata',{Date,Number,Math});
const stats=(packets,duration,energy,level=0.1)=>new Map([['rtp',{type:'outbound-rtp',kind:'audio',packetsSent:packets,trackIdentifier:'never-copy'}],['source',{type:'media-source',kind:'audio',totalSamplesDuration:duration,totalAudioEnergy:energy,audioLevel:level,label:'never-copy'}]]);
test('metadata gives deltas, not an unqualified stalled-stream diagnosis',()=>{const s={readyAt:0};sample(s,stats(100,5,0.1),5000);assert.equal(s.inputProgress.packetDelta,null);sample(s,stats(110,10,0.12),10000);assert.equal(s.inputProgress.packetDelta,10);assert.equal(s.inputProgress.captureSecondsDelta,5);assert.equal(s.inputProgress.audioEnergyDelta,0.02);sample(s,stats(110,10,0.12),15000);assert.equal(s.inputProgress.packetDelta,0);assert.equal(s.inputProgress.captureSecondsDelta,0);assert.doesNotMatch(JSON.stringify(s),/never-copy/);});
test('unsupported stats and counter resets remain unknown, never negative progress',()=>{const s={};sample(s,stats(100,5,0.1),5000);sample(s,stats(1,1,0.01),10000);assert.equal(s.inputProgress.packetDelta,null);assert.equal(s.inputProgress.captureSecondsDelta,null);sample(s,undefined,15000);assert.equal(s.audioPackets,null);assert.equal(s.inputProgress.audioLevel,null);assert.equal(s.inputProgress.packetDelta,null);});
test('invalid metrics cannot leak arbitrary strings or nonfinite values',()=>{const s={};sample(s,stats('secret',NaN,Infinity,9),1);assert.equal(s.audioPackets,null);assert.equal(s.inputProgress.audioLevel,null);assert.doesNotMatch(JSON.stringify(s),/secret|NaN|Infinity/);});

test('mixed-validity multi-row metrics remain unknown instead of partial totals',()=>{const s={};const rows=stats(100,5,0.1);rows.set('out2',{type:'outbound-rtp',kind:'audio'});rows.set('source2',{type:'media-source',kind:'audio'});sample(s,rows,5000);assert.equal(s.audioPackets,null);assert.equal(s.inputProgress.audioLevel,null);rows.get('rtp').packetsSent=200;rows.get('source').totalSamplesDuration=10;sample(s,rows,10000);assert.equal(s.inputProgress.packetDelta,null);assert.equal(s.inputProgress.captureSecondsDelta,null);assert.equal(s.inputProgress.audioEnergyDelta,null);});
