import {createDemoStore, createMemoryStorage} from '../../workbench/core.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
const validId=v=>typeof v==='string'&&v.length>0&&v.length<=200;
const revision=v=>Number.isSafeInteger(v)&&v>=0;
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';

// James requireAuth/configuredIdentity supplies owner server-side.
// Request headers and JSON cannot select the authenticated owner.
export async function workbenchRoute(request,env,owner){
 if(!validId(owner))return json({error:'Sign in required.'},401);
 if(request.method==='GET')return json({accountId:owner});
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Invalid origin.'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required.'},415);
 const bytes=await request.arrayBuffer();
 if(bytes.byteLength>262144)return json({error:'Project too large.'},413);
 let q;try{q=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'Invalid JSON.'},400);}
 if(q&&typeof q.accountId==='string'&&q.accountId!==owner)return json({error:'Authenticated account changed.'},403);
 if(!q||q.accountId!==owner||!revision(q.accountGeneration)||!['list','load','save'].includes(q.action))return json({error:'Invalid scope or action.'},400);
 if(q.action==='load'&&!validId(q.id))return json({error:'Invalid project.'},400);
 if(q.action==='save'&&(!validId(q.operationId)||!validId(q.project?.id)||q.project.accountId!==owner||!revision(q.expectedRevision)||!revision(q.expectedRevision+1)||q.project.revision!==q.expectedRevision))return json({error:'Invalid save.'},400);
 const scope={accountId:owner,accountGeneration:q.accountGeneration};
 if(!env.store)return json({error:'Storage unavailable.'},503);
 try{
  // Single-row compare-and-swap commits the project and receipt together.
  // A losing writer reloads and revalidates; it never overwrites a newer row.
  for(let attempt=0;attempt<8;attempt++){
   const row=await env.store.load(owner);
   const state=row?JSON.parse(row.document):{projects:[],receipts:[]};
   if(q.action==='list')return json({...scope,projects:state.projects});
   if(q.action==='load')return json({...scope,project:state.projects.find(p=>p.id===q.id)??null});
   const payload=canonical({project:q.project,expectedRevision:q.expectedRevision});
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))),b=>b.toString(16).padStart(2,'0')).join('');
   const receipt=state.receipts.find(r=>r.id===q.operationId);
   if(receipt){if(receipt.digest!==digest)return json({error:'Operation identity reused.'},409);return json({...receipt.outcome,...scope});}
   const previous=state.projects.find(p=>p.id===q.project.id)??null;
   let result;
   if((previous?.revision??0)!==q.expectedRevision)result={status:'conflict',currentProject:previous};
   else {
    // Run the unchanged Project validator AND history transformation. Merely
    // validating and incrementing revision would omit authoritative editHistory.
    const storage=createMemoryStorage();
    if(previous)storage.setItem('server:'+encodeURIComponent(owner)+':project:'+encodeURIComponent(previous.id),JSON.stringify(previous));
    const store=createDemoStore({storage,accountId:owner,keyPrefix:'server'});
    result=store.save(q.project,{expectedRevision:q.expectedRevision});
   }
   if(result.status==='succeeded'&&new TextEncoder().encode(JSON.stringify(result.project)).byteLength>196608)result={status:'failed',errorCode:'project_size_limit'};
   const outcome=result.status==='succeeded'?{operationId:q.operationId,status:'succeeded',project:result.project}:{operationId:q.operationId,status:result.status,commitState:'not_committed',...(result.currentProject===undefined?{}:{currentProject:result.currentProject})};
   if(result.status==='succeeded')state.projects=[...state.projects.filter(p=>p.id!==q.project.id),result.project];
   state.receipts.push({id:q.operationId,digest,outcome});
   const document=JSON.stringify(state);
   // Fail closed instead of expiring receipts and risking duplicate operations.
   if(new TextEncoder().encode(document).byteLength>1500000)return json({error:'Workspace storage limit reached.'},507);
   if(await env.store.commit(owner,row,document))return json({...outcome,...scope});
  }
  return json({error:'Storage busy. Retry the same operation.'},503);
 }catch{return json({error:'Save outcome unavailable. Retry the same operation.'},503);}
}
