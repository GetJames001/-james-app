'use strict';
// CI-only red/green check. Restore the candidate before running its full suite.
const fs=require('node:fs'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const file='customer-activity-ui.js',candidate=fs.readFileSync(file,'utf8');
const fix="  if(busy||savingAll||uncertain||!doc)return;\n  remember();\n  const draft=companyDrafts.get(selected);";
assert.equal(candidate.split(fix).length,2,'expected one focused company-save fix');
const before=candidate.replace(fix,"  const draft=companyDrafts.get(selected);");
assert.equal(require('node:crypto').createHash('sha256').update(before).digest('hex'),'e13b99ef065bebce16237fee91860fdc0861213edbebb54ce7f6edd66388300c','baseline must equal the accepted source');
try{
 fs.writeFileSync(file,before);
 const result=spawnSync(process.execPath,['--test','--test-name-pattern=Company details save captures autofill', 'tests/customer-activity.browser.test.js'],{encoding:'utf8',timeout:60000});
 const output=(result.stdout||'')+(result.stderr||'');
 assert.equal(result.status,1,'baseline must fail with the expected regression');
 assert.match(output,/company autofill must be read before the save payload is built/,'failure must be the targeted stale-value assertion');
 console.log('Confirmed baseline loses autofilled company values; restored candidate for full tests.');
}finally{fs.writeFileSync(file,candidate);}
