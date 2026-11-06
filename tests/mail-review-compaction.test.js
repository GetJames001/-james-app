'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectReview,projectReview,decideReview}=require('../lib/attention/mail-review.cjs');
const at='2026-11-06T18:00:00.000Z';
const save=next=>({accountId:'owner',revision:1,...next});
test('repeated provider metadata versions do not exhaust inventory',()=>{
 let snapshot=null;
 for(let n=0;n<350;n++)snapshot=save(collectReview(snapshot,'owner',[{id:'same',subject:'Payment due',preview:'Version '+n}],at));
 assert.equal(snapshot.state.scans[0].pages.flat().length,1);
 assert.equal(projectReview(snapshot).items[0].preview,'Version 349');
});
test('new version is reviewable but unchanged handled version stays suppressed',()=>{
 const mail={id:'same',subject:'Payment due',preview:'Initial'};
 let snapshot=save(collectReview(null,'owner',[mail],at));
 snapshot=save(decideReview(snapshot,projectReview(snapshot).items[0].reviewKey,'handled',at));
 snapshot=save(collectReview(snapshot,'owner',[mail],at));
 assert.equal(projectReview(snapshot).items.length,0);
 snapshot=save(collectReview(snapshot,'owner',[{...mail,preview:'Updated amount'}],at));
 assert.equal(projectReview(snapshot).items.length,1);
 assert.equal(snapshot.state.scans[0].pages.flat().length,1);
});
