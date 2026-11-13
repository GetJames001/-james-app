'use strict';
const {requireAuth,configuredIdentity,privateNoStore}=require('../auth.js');
const {createLedger}=require('../task-execution/ledger.cjs');
const {createStorage}=require('../task-execution/storage.cjs');
const BRANCH='work/agent-systems-first-proof-20261112';
const ownerCommands=new Set(['create','resume','pause','cancel']);
const preparations=new Set(['agenda_fixture','followup_fixture']);
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(value);
// Only status/result information is returned; not internal leases, approval
// records, operation history, raw inputs, storage keys or server identity.
function publicTask(task){
 return {id:task.id,kind:task.kind,objective:task.objective,status:task.status,revision:task.revision,inputVersion:task.inputVersion,createdAt:task.createdAt,updatedAt:task.updatedAt,blockedReason:task.blockedReason,checkpoint:task.checkpoint?.step||null,result:task.result};
}
function createHandler({ledger,authorize=requireAuth,identity=configuredIdentity,enabled=false}){
 return async(req,res)=>{
  privateNoStore(res);
  if(!authorize(req,res,{csrf:req.method!=='GET'}))return;
  if(!enabled)return res.status(404).json({error:'NOT_ENABLED'});
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  const allowed=req.method==='GET'?['path','taskId']:['path'];
  if(Object.keys(req.query||{}).some(key=>!allowed.includes(key))||req.query?.taskId!==undefined&&!validId(req.query.taskId))return res.status(400).json({error:'INVALID_REQUEST'});
  const owner=identity();if(!owner)return res.status(503).json({error:'OWNER_UNAVAILABLE'});
  try{
   if(req.method==='GET'){
    const snapshot=await ledger.snapshot(owner);
    if(req.query?.taskId){const task=snapshot.tasks.find(t=>t.id===req.query.taskId);return task?res.status(200).json({task:publicTask(task)}):res.status(404).json({error:'NOT_FOUND'});}
    return res.status(200).json({revision:snapshot.revision,tasks:snapshot.tasks.map(publicTask)});
   }
   if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
   let command;
   try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(typeof raw!=='string')throw Error();if(Buffer.byteLength(raw)>16384)return res.status(413).json({error:'REQUEST_TOO_LARGE'});command=JSON.parse(raw);}
   catch{return res.status(400).json({error:'INVALID_REQUEST'});}
   if(!command||typeof command!=='object'||Array.isArray(command))return res.status(400).json({error:'INVALID_REQUEST'});
   if(!ownerCommands.has(command.type))return res.status(403).json({error:'COMMAND_NOT_ALLOWED'});
   // This Preview pilot is strictly fictional preparation. There is no user
   // endpoint for worker leases, completion, paid work or consequential approval.
   if(command.type==='create'&&(!preparations.has(command.kind)||command.requiresApproval!==false||command.budget?.maxCostMicros!==0))return res.status(403).json({error:'PREPARATION_ONLY'});
   const result=await ledger.execute(owner,command);
   const current=result.replayed?(await ledger.snapshot(owner)).tasks.find(t=>t.id===command.taskId):result.task;
   if(!current)throw Error('TASK_UNAVAILABLE');
   return res.status(command.type==='create'&&!result.replayed?201:200).json({replayed:result.replayed,operationTaskRevision:result.task.revision,task:publicTask(current)});
  }catch(error){
   const code=error?.code;
   if(code==='NOT_FOUND')return res.status(404).json({error:code});
   if(['INVALID_COMMAND','INVALID_INPUT','INVALID_BUDGET'].includes(code))return res.status(400).json({error:code});
   if(code==='INPUT_TOO_LARGE')return res.status(413).json({error:code});
   if(['REVISION_CONFLICT','OPERATION_REUSED','TASK_EXISTS','NOT_RESUMABLE','TERMINAL_TASK','CAPACITY_REACHED'].includes(code))return res.status(409).json({error:code});
   return res.status(503).json({error:'TASKS_UNAVAILABLE'});
  }
 };
}
module.exports=(req,res)=>createHandler({ledger:createLedger(createStorage({url:process.env.KV_REST_API_URL,token:process.env.KV_REST_API_TOKEN})),enabled:process.env.JAMES_TASK_EXECUTION_PREVIEW_ENABLED==='true'&&process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF===BRANCH})(req,res);
module.exports.createHandler=createHandler;
