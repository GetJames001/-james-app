'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {render}=require('../../lib/travel/mail-trip.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
const candidate={id:hash('synthetic-booking'),at:1,values:{title:'Chicago interview',start:'2026-12-03',end:'2026-12-04',destination:'Chicago',flights:['Dec 3 · AA 3015 · LAS 2:09 PM → ORD 7:58 PM','Dec 4 · AA 3081 · ORD 3:00 PM → LAS 5:16 PM']}};
function fixture(){
 const files=new Map();
 function seed(trip,name){const bytes=Buffer.from(JSON.stringify(trip)),type='application/json',lastModified=0,id=createHash('sha256').update(JSON.stringify([name,type,lastModified])).update(bytes).digest('hex');files.set(id,JSON.stringify({id,name,type,lastModified,size:bytes.length}));files.set('bytes:'+id,bytes.toString('base64'));return id;}
 const chicago=seed(render(candidate.values),'itinerary.james-trip.json');
 const oregon=seed({title:'Las Vegas to Eugene',start:'2026-11-22',end:'2026-11-23',stops:['Las Vegas','Overnight in Reno','Eugene']},'oregon.james-trip.json');
 const command=async([op,...args])=>{if(op==='HGET')return files.get(args[1])??null;if(op==='HKEYS')return [...files.keys()];assert.equal(op,'EVAL');const [,,key,id,old,next,content,expected]=args;if((files.get(id)||'')!==old||(expected&&(files.get('bytes:'+id)||'')!==expected))return -1;files.set(id,next);files.set('bytes:'+id,content);return 1;};
 return {files,seed,chicago,oregon,command};
}
module.exports={fixture,candidate};
