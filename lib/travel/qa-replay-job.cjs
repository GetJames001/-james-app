'use strict';
const {qaConfiguration,createPinnedReader}=require('./qa-replay-reader.cjs');
const {createStore}=require('./mail-trip-store.cjs');
const {createQueue}=require('./pending-queue.cjs');
function createReplay({env=process.env,readGmail,command,queueFactory=createQueue,storeFactory=createStore}){
 const config=qaConfiguration(env);
 if(!config)return null;
 const read=createPinnedReader({...config,readGmail});
 const queue=queueFactory({command,environment:'preview'});
 const store=storeFactory({command,environment:'preview'});
 const stage='fetch';
 const scope=req=>req?.headers?.host===env.JAMES_TRAVEL_QA_BRANCH_URL;
 return {
  async prepare(owner,req){
   if(!scope(req))return;
   await queue.enqueue(owner,stage,[{provider:'gmail',messageId:config.messageId}]);
  },
  async sync(owner,_snapshot,req){
   if(!scope(req))return {status:'not_enabled'};
   const result=await queue.drain(owner,stage,async job=>{await store.upsert(owner,await read(job));},{limit:1});
   const outstanding=await queue.status(owner,stage);
   return {status:outstanding.blocked?'blocked':(outstanding.pending||outstanding.running)?'pending':'checked',completed:result.completed};
  }
 };
}
module.exports={createReplay};
