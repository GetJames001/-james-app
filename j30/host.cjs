'use strict';
const {createShoppingCapability}=require('./shopping.cjs');
// Internal adapter for the isolated research runtime. Capability selection is server-owned.
function createHostHandler({authorize,ownerIdentity,conversationStore,checkpoints,provider,enabled=false,researchFactory=createShoppingCapability}){
 if(typeof researchFactory!=='function')throw Error('HOST_DEPENDENCIES_REQUIRED');
 return async(req,res)=>{
  if(!authorize(req,res,{csrf:true}))return;
  res.setHeader('Cache-Control','private, no-store');
  if(!enabled)return res.status(503).json({ok:false,error:'J30_EXECUTION_DISABLED'});
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({ok:false,error:'JSON_REQUIRED'});
  let body;try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(raw)>3000)throw Error();body=JSON.parse(raw);if(!body||Object.keys(body).sort().join('|')!=='conversationId|generation|taskId|text')throw Error()}catch{return res.status(400).json({ok:false,error:'INVALID_REQUEST'})}
  const owner=ownerIdentity();if(!owner)return res.status(503).json({ok:false,error:'OWNER_UNAVAILABLE'});
  let scope;try{const head=await conversationStore.execute(owner);if(head?.status!=='ready'||head.conversationId!==body.conversationId||head.generation!==body.generation)throw Error();const {accountId,conversationId,generation}=head;scope={accountId,conversationId,generation}}catch{return res.status(409).json({ok:false,error:'CONVERSATION_UNCONFIRMED'})}
  const controller=new AbortController();req.on?.('aborted',()=>controller.abort());
  const research=researchFactory({checkpoints,provider,verifyScope:async current=>{const head=await conversationStore.execute(owner);return head?.status==='ready'&&['accountId','conversationId','generation'].every(k=>head[k]===current[k])}});
  try{const result=await research({text:body.text,taskId:body.taskId,scope,signal:controller.signal,isCurrent:()=>!controller.signal.aborted});return res.status(200).json({ok:true,result})}
  catch(error){const safe=['ACTION_NOT_AUTHORIZED','REQUEST_INVALID','SCOPE_INVALID','TASK_INTERRUPTED','TASK_BUSY_OR_INTERRUPTED','RECONCILE_BEFORE_RETRY','TASK_REQUEST_MISMATCH','SESSION_BUDGET_EXHAUSTED','DISCOVERY_DISABLED','DISCOVERY_NOT_CONFIGURED','FREE_SEARCH_ALLOWANCE_UNVERIFIED','DISCOVERY_REQUEST_UNSUPPORTED'];return res.status(409).json({ok:false,error:safe.includes(error.message)?error.message:'TASK_UNCONFIRMED'})}
 };
}
module.exports={createHostHandler};
