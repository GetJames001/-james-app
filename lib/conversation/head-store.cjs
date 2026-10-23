'use strict';
const {createHash,randomUUID}=require('node:crypto');
const valid=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(v);
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join('|')===keys.sort().join('|');
const identity=(accountId,row,status)=>({accountId,conversationId:row.id,generation:row.generation,status});
// Account-selected lifecycle metadata. Atomic CAS is required across devices.
function createHeadStore({read,compareAndSwap,newId=()=>`conversation-${randomUUID()}`}){
 async function execute(owner,command){
  if(typeof owner!=='string'||!owner.trim())throw Error('OWNER_REQUIRED');
  if(command!==undefined&&!(exact(command,['action'])&&command.action==='ensure')&&!(exact(command,['action','conversationId','generation','operationId'])&&command.action==='end'&&valid(command.conversationId)&&Number.isSafeInteger(command.generation)&&command.generation>=1&&valid(command.operationId)))throw Error('INVALID_COMMAND');
  const accountId='account-'+createHash('sha256').update(owner).digest('hex');
  const key=`james:conversation:v1:${accountId}`;
  for(let attempt=0;attempt<8;attempt++){
   const raw=await read(key);let row=null;
   if(raw!==null){
    row=JSON.parse(raw);
    if(!exact(row,['version','id','generation','state','lastEnd'])||row.version!==1||!valid(row.id)||!Number.isSafeInteger(row.generation)||row.generation<1||!['active','ended'].includes(row.state)||!(row.lastEnd===null||(exact(row.lastEnd,['operationId','id','generation'])&&valid(row.lastEnd.operationId)&&valid(row.lastEnd.id)&&Number.isSafeInteger(row.lastEnd.generation)&&row.lastEnd.generation>=1)))throw Error('CORRUPT_HEAD');
   }
   if(command===undefined)return row?identity(accountId,row,row.state==='active'?'ready':'ended'):null;
   let next;
   if(command.action==='ensure'){
    if(row?.state==='active')return identity(accountId,row,'ready');
    if(row?.generation===Number.MAX_SAFE_INTEGER)throw Error('GENERATION_EXHAUSTED');
    const id=newId();if(!valid(id)||id===row?.id)throw Error('INVALID_NEW_ID');
    next={version:1,id,generation:(row?.generation||0)+1,state:'active',lastEnd:row?.lastEnd||null};
   }else{
    if(row?.lastEnd?.operationId===command.operationId){
     if(row.lastEnd.id!==command.conversationId||row.lastEnd.generation!==command.generation)throw Error('OPERATION_REUSED');
     return identity(accountId,row.lastEnd,'ended');
    }
    if(!row||row.id!==command.conversationId||row.generation!==command.generation||row.state!=='active')throw Error('SUPERSEDED');
    next={...row,state:'ended',lastEnd:{operationId:command.operationId,id:row.id,generation:row.generation}};
   }
   if(await compareAndSwap(key,raw,JSON.stringify(next)))return identity(accountId,next,next.state==='active'?'ready':'ended');
  }
  throw Error('BUSY_RECONCILE');
 }
 return {execute};
}
module.exports={createHeadStore};
