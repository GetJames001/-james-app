'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
function scopeKey(scope,taskId){if(!scope||Object.keys(scope).sort().join('|')!=='accountId|conversationId|generation'||!['accountId','conversationId'].every(k=>typeof scope[k]==='string'&&/^[\w-]{1,160}$/.test(scope[k]))||!Number.isSafeInteger(scope.generation)||scope.generation<1||typeof taskId!=='string'||!/^[\w-]{1,160}$/.test(taskId))throw Error('SCOPE_INVALID');return createHash('sha256').update(JSON.stringify([scope.accountId,scope.conversationId,scope.generation,taskId])).digest('hex');}
// Isolated development persistence. Never use ephemeral Vercel disk in a host integration.
function createFileCheckpoints(directory){
 async function prepare(){await fs.mkdir(directory,{recursive:true,mode:0o700})}
 return {async exclusive(scope,id,operation){await prepare();const filename=path.join(directory,scopeKey(scope,id)+'.json'),lock=filename+'.lock';let handle;try{handle=await fs.open(lock,'wx',0o600)}catch{throw Error('TASK_BUSY_OR_INTERRUPTED')}
  try{return await operation({async read(){try{const raw=await fs.readFile(filename,'utf8');if(raw.length>100000)throw Error('CHECKPOINT_INVALID');const row=JSON.parse(raw);if(JSON.stringify(row.scope)!==JSON.stringify(scope)||row.taskId!==id)throw Error('CHECKPOINT_INVALID');return row}catch(e){if(e.code==='ENOENT')return null;throw e}},async write(row){if(JSON.stringify(row.scope)!==JSON.stringify(scope)||row.taskId!==id)throw Error('CHECKPOINT_INVALID');const temp=filename+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(row),{mode:0o600,flag:'wx'});await fs.rename(temp,filename)}finally{await fs.rm(temp,{force:true})}}})}finally{await handle.close();await fs.rm(lock,{force:true})}
 }};
}
module.exports={scopeKey,createFileCheckpoints};
