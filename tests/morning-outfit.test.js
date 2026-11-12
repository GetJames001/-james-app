'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root={};vm.runInNewContext(fs.readFileSync(require.resolve('../voice-session'),'utf8'),{window:root});
const {createMorningOutfitOffer}=root.JamesVoiceSession;
function fixture(){let current=new Date('2026-11-12T16:00:00Z');const memory=new Map(),storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)},scope={accountId:'fictional-owner'},context={timezone:'America/Los_Angeles'},briefing=()=>({calendar:{google:{hasData:true,state:'fresh',complete:true,fetchedAt:current.toISOString()}}});return {storage,scope,context,briefing,now:()=>current,setTime:value=>current=new Date(value),memory,policy:()=>createMorningOutfitOffer({storage,now:()=>current})};}
test('morning offer uses local time and needs a fresh verified calendar, not merely a page visit',()=>{
 const f=fixture(),p=f.policy();assert.ok(p.candidate(f.scope,f.context,f.briefing()));
 for(const calendar of [{hasData:false,state:'loading'}, {hasData:true,state:'stale',complete:true,fetchedAt:f.now().toISOString()}, {hasData:true,state:'partial',complete:false,fetchedAt:f.now().toISOString()}, {hasData:true,state:'fresh',complete:true,fetchedAt:new Date(+f.now()-900001).toISOString()}])assert.equal(p.candidate(f.scope,f.context,{calendar:{google:calendar}}),null);
 assert.equal(p.candidate(f.scope,{timezone:'invalid-zone'},f.briefing()),null);assert.equal(p.candidate({},f.context,f.briefing()),null);
 f.setTime('2026-11-12T21:00:00Z');assert.equal(p.candidate(f.scope,f.context,f.briefing()),null);
 f.setTime('2026-11-12T10:00:00Z');assert.equal(p.candidate(f.scope,f.context,f.briefing()),null);
});
test('preparing or interrupting an offer does not consume it; completed delivery survives reconnect/reload',()=>{
 const f=fixture(),p=f.policy(),candidate=p.candidate(f.scope,f.context,f.briefing());assert.ok(p.candidate(f.scope,f.context,f.briefing()));assert.equal(f.memory.size,0);
 p.markDelivered(candidate);assert.equal(p.candidate(f.scope,f.context,f.briefing()),null);assert.equal(f.policy().candidate(f.scope,f.context,f.briefing()),null);assert.equal([...f.memory.values()][0],'2026-11-12');
});
test('different owners and the next local morning keep independent offer state',()=>{
 const f=fixture(),p=f.policy();p.markDelivered(p.candidate(f.scope,f.context,f.briefing()));assert.ok(p.candidate({accountId:'second-fictional-owner'},f.context,f.briefing()));
 f.setTime('2026-11-13T16:00:00Z');assert.ok(p.candidate(f.scope,f.context,f.briefing()));assert.doesNotMatch(JSON.stringify([...f.memory]),/email|coordinates|clothes|secret/);
});
test('storage failures retain once-only protection for this mounted conversation',()=>{
 const f=fixture(),p=createMorningOutfitOffer({now:f.now,storage:{getItem(){throw Error();},setItem(){throw Error();}}});p.markDelivered(p.candidate(f.scope,f.context,f.briefing()));assert.equal(p.candidate(f.scope,f.context,f.briefing()),null);
});
