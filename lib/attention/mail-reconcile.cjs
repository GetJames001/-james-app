'use strict';
// Only provider-confirmed absence can remove an Inbox suggestion. A message
// falling off the newest page, being read, or receiving a reply is not absence.
function selectChecks(previous,provider,currentIds,limit=25){
 const source=provider==='gmail'?['google','gmail-inbox-review']:['microsoft','personal-inbox-review'];
 const known=new Map();
 for(const scan of previous?.state?.scans||[])if(JSON.stringify(scan.source)===JSON.stringify(source))for(const event of scan.pages.flat())if(event.mail)known.set(event.mail.id,event.mail);
 const current=new Set(currentIds),ids=[...known.keys()].filter(id=>!current.has(id)).sort();
 const prior=previous?.provenance?.find(p=>p.collector===source[1])?.reconcileCursor;
 const start=typeof prior==='string'?ids.findIndex(id=>id>prior):0;
 const ordered=start<0?ids:[...ids.slice(start),...ids.slice(0,start)];
 const selected=ordered.slice(0,limit);
 return {ids:selected,cursor:selected.at(-1)||null};
}
async function verifyChecks(ids,verify){
 const removedIds=[],messages=[];
 for(let n=0;n<ids.length;n+=5){
  const results=await Promise.allSettled(ids.slice(n,n+5).map(async id=>({id,result:await verify(id)})));
  if(results.some(r=>r.status==='rejected'))throw Error('MAIL_RECONCILIATION_UNAVAILABLE');
  for(const {value:{id,result}} of results){if(result.absent===true)removedIds.push(id);else if(result.message?.id===id)messages.push(result.message);else throw Error('MAIL_RECONCILIATION_UNAVAILABLE');}
 }
 return {removedIds,messages};
}
module.exports={selectChecks,verifyChecks};
