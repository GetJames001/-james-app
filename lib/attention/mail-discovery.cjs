'use strict';
// Always inspect the newest page; advance one saved older-page cursor as well.
// A failed older read must not discard new mail or claim complete coverage.
async function discover(previous,collector,latest,readPage,at){
 const prior=previous?.provenance?.find(p=>p?.collector===collector)?.discovery;
 let cursor=latest.nextCursor||null,failed=false,older=[];
 if(prior?.cursor){
  try{const page=await readPage(prior.cursor);if(!Array.isArray(page.messages)||page.messages.length>25)throw Error();older=page.messages;cursor=page.nextCursor||null;}
  catch{failed=true;cursor=latest.nextCursor||null;}
 }
 const messages=[...new Map([...older,...latest.messages].map(message=>[message.id,message])).values()];
 return {...latest,messages,discovery:{cursor,failed,lastCompletedAt:!failed&&!cursor?at:prior?.lastCompletedAt||null}};
}
module.exports={discover};
