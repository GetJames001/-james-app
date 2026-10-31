'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const files=require('../lib/customer-database/files.cjs');
test('customer XLSX uses document API without loading unsupported streaming readers/writers',async()=>{
 const headers=['company_name','contact_name','notes'];
 const rows=[['QA Cobalt Acorn','Avery Example','Quoted, Unicode — café'],['QA Blue Bench','Jordan Example','Line one\nLine two']];
 const bytes=await files.toXLSX(headers,rows);
 const reloaded=await files.parseFile({name:'fictional.xlsx',base64:bytes.toString('base64')});
 assert.deepEqual(reloaded.headers,headers);assert.deepEqual(reloaded.rows,rows);
 assert.equal(Object.keys(require.cache).some(p=>/exceljs[/\\]lib[/\\]stream[/\\]xlsx/.test(p)),false);
});
