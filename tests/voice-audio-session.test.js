'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={};vm.runInNewContext(fs.readFileSync('voice-session.js','utf8'),context);
const {acquireDuplexAudioSession}=context.JamesVoiceSession;
test('optional duplex session restores previous type exactly once after close',()=>{const writes=[];let type='auto';const audioSession={get type(){return type},set type(value){writes.push(value);type=value}};const release=acquireDuplexAudioSession({audioSession});assert.equal(type,'play-and-record');release();release();assert.equal(type,'auto');assert.deepEqual(writes,['play-and-record','auto']);});
test('overlapping owners do not restore audio mode while a newer session is active',()=>{const audioSession={type:'ambient'};const a=acquireDuplexAudioSession({audioSession}),b=acquireDuplexAudioSession({audioSession});a();assert.equal(audioSession.type,'play-and-record');b();assert.equal(audioSession.type,'ambient');});
test('cleanup preserves a later external audio-session choice',()=>{const audioSession={type:'auto'},release=acquireDuplexAudioSession({audioSession});audioSession.type='playback';release();assert.equal(audioSession.type,'playback');});
test('unsupported or throwing audio-session APIs do not block voice',()=>{for(const navigator of [undefined,{}, {get audioSession(){throw Error('unsupported')}},{audioSession:{get type(){return 'auto'},set type(_){throw Error('unsupported')}}}])assert.doesNotThrow(()=>acquireDuplexAudioSession(navigator)());});
