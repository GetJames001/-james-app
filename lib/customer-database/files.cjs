'use strict';
const {createHash}=require('node:crypto');
const MAX_BYTES=1024*1024,MAX_ROWS=500,MAX_COLUMNS=40;
function fail(code){throw Object.assign(new Error(code),{code});}
// Reuses the bounded quoted-field state machine from work-pilot.js (5e449209).
function csvRows(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>MAX_BYTES)fail('FILE_TOO_LARGE');
 text=text.replace(/^\uFEFF/,'');if(text.includes('\0'))fail('INVALID_CSV');
 const rows=[];let row=[],field='',state='start',touched=false;
 const cell=()=>{row.push(field);field='';state='start';if(row.length>MAX_COLUMNS)fail('TOO_MANY_COLUMNS');};
 const line=()=>{cell();if(!(row.length===1&&row[0]===''))rows.push(row);row=[];touched=false;if(rows.length>MAX_ROWS+1)fail('TOO_MANY_ROWS');};
 for(let i=0;i<text.length;i++){
  const c=text[i];if(state==='quoted'){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else state='closed';}else field+=c;continue;}
  if(c===','){cell();touched=true;continue;}if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;line();continue;}
  if(state==='closed')fail('INVALID_CSV');if(c==='"'){if(state!=='start')fail('INVALID_CSV');state='quoted';touched=true;}else{field+=c;state='bare';touched=true;}
 }
 if(state==='quoted')fail('INVALID_CSV');if(touched||row.length||field.length||state==='closed')line();return rows;
}
function inspectZip(data){
 // Read the central directory before ExcelJS inflates anything. Reject ZIP64,
 // encryption, overlapping directory ranges and excessive advertised expansion.
 let end=-1;for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||end+22+data.readUInt16LE(end+20)!==data.length)fail('INVALID_XLSX');
 const count=data.readUInt16LE(end+10),size=data.readUInt32LE(end+12),offset=data.readUInt32LE(end+16);
 if(data.readUInt16LE(end+4)||data.readUInt16LE(end+6)||count!==data.readUInt16LE(end+8)||count>128||offset+size!==end||size===0xffffffff)fail('INVALID_XLSX');
 let at=offset,total=0;const names=new Set();
 for(let n=0;n<count;n++){
  if(at+46>end||data.readUInt32LE(at)!==0x02014b50)fail('INVALID_XLSX');
  const flags=data.readUInt16LE(at+8),method=data.readUInt16LE(at+10),expanded=data.readUInt32LE(at+24),compressed=data.readUInt32LE(at+20),len=data.readUInt16LE(at+28),extra=data.readUInt16LE(at+30),comment=data.readUInt16LE(at+32),local=data.readUInt32LE(at+42);
  const name=data.subarray(at+46,at+46+len).toString('utf8');total+=expanded;
  if(flags&1||![0,8].includes(method)||expanded>10*1024*1024||total>20*1024*1024||local+30+compressed>offset||at+46+len+extra+comment>end||names.has(name)||/\\|(^|\/)\.\.(\/|$)/.test(name)||/vbaProject|externalLinks/i.test(name))fail('UNSUPPORTED_XLSX');
  if(data.readUInt32LE(local)!==0x04034b50||data.readUInt16LE(local+8)!==method||data.readUInt16LE(local+6)!==flags)fail('INVALID_XLSX');
  const localNameLength=data.readUInt16LE(local+26),localExtra=data.readUInt16LE(local+28),start=local+30+localNameLength+localExtra;
  if(start+compressed>offset||data.subarray(local+30,local+30+localNameLength).toString('utf8')!==name)fail('INVALID_XLSX');
  const packed=data.subarray(start,start+compressed);let actual;try{actual=method===0?packed:require('node:zlib').inflateRawSync(packed,{maxOutputLength:Math.min(10*1024*1024,20*1024*1024-total+expanded)});}catch{fail('UNSUPPORTED_XLSX');}
  if(actual.length!==expanded)fail('INVALID_XLSX');
  if(/\.xml$/i.test(name)){
   const xml=actual.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail('UNSUPPORTED_XLSX');
   if(/^xl\/worksheets\/[^/]+\.xml$/i.test(name)){
    const rowTags=xml.match(/<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*>/g)||[],cellTags=xml.match(/<(?:[A-Za-z_][\w.-]*:)?c\b[^>]*>/g)||[];
    if(rowTags.length>MAX_ROWS+1||cellTags.length>(MAX_ROWS+1)*MAX_COLUMNS)fail('SHEET_TOO_LARGE');
    for(const tag of rowTags){const r=/\br\s*=\s*["']([0-9]+)["']/.exec(tag);if(!r||Number(r[1])>MAX_ROWS+1||Number(r[1])<1)fail('SHEET_TOO_LARGE');}
    for(const tag of cellTags){const r=/\br\s*=\s*["']([A-Z]+)([0-9]+)["']/.exec(tag);if(!r)fail('UNSUPPORTED_XLSX');let col=0;for(const c of r[1])col=col*26+c.charCodeAt(0)-64;if(col>MAX_COLUMNS||Number(r[2])>MAX_ROWS+1)fail('SHEET_TOO_LARGE');}
   }
   if(name==='xl/sharedStrings.xml'&&(xml.match(/<(?:[A-Za-z_][\w.-]*:)?si\b/g)||[]).length>(MAX_ROWS+1)*MAX_COLUMNS)fail('SHEET_TOO_LARGE');
  }
  names.add(name);at+=46+len+extra+comment;
 }
 if(at!==end||!names.has('[Content_Types].xml'))fail('INVALID_XLSX');
}
function scalar(value){
 if(value==null)return '';if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return String(value);
 if(value instanceof Date)return value.toISOString().slice(0,10);
 // Never trust cached formula results or external hyperlink targets as facts.
 fail('UNSUPPORTED_CELL');
}
async function parseFile({name,base64}){
 if(typeof name!=='string'||name.length>180||!name||/[\x00-\x1f\/\\]/.test(name)||typeof base64!=='string'||base64.length>Math.ceil(MAX_BYTES/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))fail('INVALID_FILE');
 const data=Buffer.from(base64,'base64');if(!data.length||data.length>MAX_BYTES)fail('FILE_TOO_LARGE');
 let rows;
 if(/\.csv$/i.test(name)){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{fail('CSV_UTF8_REQUIRED');}rows=csvRows(text);}
 else if(/\.xlsx$/i.test(name)){
  inspectZip(data);const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(data);
  if(book.worksheets.length!==1)fail('SINGLE_SHEET_REQUIRED');const sheet=book.worksheets[0];if(sheet.rowCount>MAX_ROWS+1||sheet.columnCount>MAX_COLUMNS)fail('SHEET_TOO_LARGE');
  rows=[];sheet.eachRow(row=>{const cells=[];for(let i=1;i<=sheet.columnCount;i++)cells.push(scalar(row.getCell(i).value));rows.push(cells);});
 }else fail('CSV_OR_XLSX_REQUIRED');
 const headers=rows.shift()?.map(x=>x.trim());if(!headers?.length||headers.some(x=>!x||x.length>120)||new Set(headers).size!==headers.length||!rows.length)fail('INVALID_HEADER');
 if(rows.some(r=>r.length!==headers.length||r.some(x=>x.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x))))fail('INVALID_ROWS');
 return {name,base64,sha256:createHash('sha256').update(data).digest('hex'),headers,rows};
}
const spreadsheetSafe=value=>/^[\s]*[=+@\-\t\r]/.test(String(value))?"'"+value:String(value??'');
function toCSV(headers,rows){return '\uFEFF'+[headers,...rows].map(r=>r.map(x=>'"'+spreadsheetSafe(x).replace(/"/g,'""')+'"').join(',')).join('\r\n');}
async function toXLSX(headers,rows){const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Companies and contacts');sheet.addRow(headers);for(const row of rows)sheet.addRow(row.map(x=>String(x??'')));sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];return Buffer.from(await book.xlsx.writeBuffer());}
module.exports={parseFile,csvRows,inspectZip,toCSV,toXLSX,MAX_BYTES,MAX_ROWS};
