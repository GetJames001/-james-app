'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectChecks,verifyChecks}=require('../lib/attention/mail-reconcile.cjs');
const {collectReview,projectReview}=require('../lib/attention/mail-review.cjs');
const at='2026-11-06T18:00:00.000Z',save=x=>({accountId:'owner',revision:1,...x});
const mail=id=>({id,subject:'Payment due',preview:'Verify statement'});
test('absence from newest page preserves suggestion; explicit verified absence removes it',()=>{
 let snapshot=save(collectReview(null,'owner',[mail('a'),mail('b')],at));
 snapshot=save(collectReview(snapshot,'owner',[],at));assert.equal(projectReview(snapshot).items.length,2);
 snapshot=save(collectReview(snapshot,'owner',[],at,'microsoft',null,{removedIds:['a'],messages:[],cursor:'a'}));
 assert.deepEqual(projectReview(snapshot).items.map(i=>i.id),['b']);assert.equal(snapshot.state.reminderLedger.length,0);
});
test('checks rotate across known items and never select another provider',()=>{
 let snapshot=save(collectReview(null,'owner',Array.from({length:25},(_,i)=>mail('a'+String(i).padStart(2,'0'))),at));
 snapshot=save(collectReview(snapshot,'owner',Array.from({length:25},(_,i)=>mail('b'+String(i).padStart(2,'0'))),at));
 const first=selectChecks(snapshot,'microsoft',[]);assert.equal(first.ids.length,25);assert.equal(first.cursor,'a24');
 snapshot.provenance[0].reconcileCursor=first.cursor;
 const next=selectChecks(snapshot,'microsoft',[]);assert.equal(next.cursor,'b24');assert.equal(next.ids[0],'b00');
 assert.deepEqual(selectChecks(snapshot,'gmail',[]).ids,[]);
 assert.equal(selectChecks(snapshot,'microsoft',next.ids).ids[0],'a00');
});
test('partial verification error rejects whole reconciliation; no false deletion',async()=>{
 await assert.rejects(verifyChecks(['a','b'],async id=>{if(id==='a')return {absent:true};throw Error('private provider details');}),/MAIL_RECONCILIATION_UNAVAILABLE/);
 assert.deepEqual(await verifyChecks(['a','b'],async id=>id==='a'?{absent:true}:{message:mail(id)}),{removedIds:['a'],messages:[mail('b')]});
});
test('verified existing old mail refreshes metadata without creating a task',()=>{
 let snapshot=save(collectReview(null,'owner',[mail('a')],at));
 snapshot=save(collectReview(snapshot,'owner',[],at,'microsoft',null,{removedIds:[],messages:[{...mail('a'),preview:'Changed statement'}],cursor:'a'}));
 assert.equal(projectReview(snapshot).items[0].preview,'Changed statement');assert.equal(snapshot.state.scans[0].pages.flat().length,1);
});
