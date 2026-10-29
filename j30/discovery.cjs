'use strict';
// General discovery, separate from product verification and browser navigation.
const {isIP}=require('node:net');
const {scopeKey}=require('./checkpoints.cjs');
const fail=code=>{throw Error(code)};
function discoveryRequest(text){
 if(typeof text!=='string'||text.length>500||/[\x00-\x1f<>@]|https?:|www\.|\b(?:password|token|api.key|log.in|sign.in|connect|checkout|purchase|buy|send|email)\b/i.test(text))fail('DISCOVERY_REQUEST_UNSUPPORTED');
 let query=text.trim().replace(/\s+/g,' ').replace(/^James\b[, :]*/i,'').replace(/^(?:please\s+)?(?:go out and\s+)?(?:find|compare|research|show)\s+(?:(?:me|us)\s+)?/i,'').replace(/^(?:a|an|some)\s+/i,'').replace(/[.!?]+$/,'').trim();
 const budget=query.match(/\s+(?:under|below|up to)\s*\$\s*(\d+(?:\.\d{1,2})?)$/i);let maxPrice=null;
 if(budget){maxPrice=Number(budget[1]);if(!(maxPrice>0&&maxPrice<=10000))fail('DISCOVERY_REQUEST_UNSUPPORTED');query=query.slice(0,budget.index).trim()}
 if(query.length<3||query.length>160||!/[a-z]/i.test(query)||/\$|[{}[\]\\]|\b(?:and then|ignore|instructions|site:|http|internal)\b/i.test(query))fail('DISCOVERY_REQUEST_UNSUPPORTED');
 return {query,maxPrice,currency:'USD',searchQuery:query+' shopping product'+(maxPrice===null?'':' under $'+maxPrice)};
}
function candidateUrl(value){
 try{if(typeof value!=='string'||value.length>2000)return null;const u=new URL(value),host=u.hostname;
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||isIP(host)||host.startsWith('[')||host.includes('xn--')||!host.includes('.')||!/[a-z]{2,}$/i.test(host)||/(?:^|\.)(?:localhost|local|internal|test|example|invalid|onion)$/.test(host)||/\b(?:checkout|cart|login|signin|account|payment|oauth|authorize|redirect)\b/i.test(u.pathname))return null;
 if([...u.searchParams.keys()].some(k=>/token|password|secret|email|session|auth|redirect|url|return|callback/i.test(k)))return null;
 for(const key of [...u.searchParams.keys()])if(/^utm_|^(?:gclid|fbclid|msclkid)$/i.test(key))u.searchParams.delete(key);
 return u.href;}catch{return null}
}
function candidatesFromSearch(data,{now=()=>new Date().toISOString()}={}){
 if(!data||!Array.isArray(data.results)||data.results.length>25)fail('DISCOVERY_RESPONSE_INVALID');
 const candidates=[],seen=new Set(),hosts=new Map();
 for(const item of data.results){const url=candidateUrl(item?.url);if(!url||seen.has(url)||typeof item.title!=='string'||!item.title.trim()||item.title.length>500)continue;
  // Only confirmed retailer listing routes are excluded. Unknown retailers may
  // use /shop/, /browse/ or /category/ for real products and remain eligible.
  const destination=new URL(url),path=destination.pathname,hostname=destination.hostname.replace(/^www\./,'');
  if(hostname==='nordstromrack.com'&&/^\/shop\/(?:women|men|kids|home)(?:\/|$)/i.test(path))continue;
  if(hostname==='nordstrom.com'&&/^\/browse\/(?:women|men|kids|home)(?:\/|$)/i.test(path))continue;
  const host=new URL(url).hostname.replace(/^www\./,'');if((hosts.get(host)||0)>=2)continue;
  seen.add(url);hosts.set(host,(hosts.get(host)||0)+1);candidates.push({title:item.title.trim(),url,sourceHost:host,observedAt:now(),verification:'search_candidate_only',productVerified:false,navigationApproved:false});
  if(candidates.length===5)break;
 }
 return candidates;
}
async function boundedJson(response){
 const length=response.headers?.get?.('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>200000))fail('DISCOVERY_RESPONSE_INVALID');
 if(!response.body?.getReader)fail('DISCOVERY_RESPONSE_INVALID');const reader=response.body.getReader();let bytes=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>200000)fail('DISCOVERY_RESPONSE_INVALID');chunks.push(Buffer.from(value))}}finally{try{await reader.cancel()}catch{}}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail('DISCOVERY_RESPONSE_INVALID')}
}
function createBrowserbaseSearch({apiKey,enabled=false,usageApproved=false,reserveFreeCall,fetchImpl=fetch}){
 return {async search(plan,{signal,assertCurrent}={}){
  if(!enabled||!usageApproved)fail('DISCOVERY_DISABLED');if(typeof apiKey!=='string'||!apiKey||typeof reserveFreeCall!=='function'||typeof assertCurrent!=='function')fail('DISCOVERY_NOT_CONFIGURED');
  // Revalidate derived plan before reserving a call. Never forward arbitrary page instructions/body.
  if(typeof plan?.query!=='string'||!(plan.maxPrice===null||(typeof plan.maxPrice==='number'&&Number.isFinite(plan.maxPrice)&&plan.maxPrice>0&&plan.maxPrice<=10000)))fail('DISCOVERY_REQUEST_UNSUPPORTED');
  const trusted=discoveryRequest(plan.query+(plan.maxPrice===null?'':' under $'+plan.maxPrice));
  if(trusted.searchQuery!==plan?.searchQuery||plan?.currency!=='USD')fail('DISCOVERY_REQUEST_UNSUPPORTED');
  await assertCurrent();if(signal?.aborted)fail('TASK_INTERRUPTED');
  // Host supplies an atomic durable reservation against verified included allowance.
  // A failed/uncertain request still consumes its reservation. No retries or paid fallback.
  if(await reserveFreeCall()!==true)fail('FREE_SEARCH_ALLOWANCE_UNVERIFIED');
  await assertCurrent();if(signal?.aborted)fail('TASK_INTERRUPTED');let response;
  try{response=await fetchImpl('https://api.browserbase.com/v1/search',{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),headers:{'X-BB-API-Key':apiKey,'Content-Type':'application/json'},body:JSON.stringify({query:trusted.searchQuery,numResults:15})})}catch{fail(signal?.aborted?'TASK_INTERRUPTED':'DISCOVERY_REQUEST_UNCONFIRMED')}
  if(!response.ok)fail('DISCOVERY_REQUEST_REJECTED');return boundedJson(response);
 }};
}
function restoreReport(task,plan,taskId){
 const r=task.report;
 if(!r||r.taskId!==taskId||r.status!=='discovered'||r.query!==plan.query||r.maxPrice!==plan.maxPrice||r.comparisonVerified!==false||r.requiresProductVerification!==true||r.purchaseAuthorized!==false||r.accountConnections!==false||!Array.isArray(r.candidates)||r.candidates.length>5)fail('DISCOVERY_CHECKPOINT_INVALID');
 const seen=new Set();const candidates=r.candidates.map(c=>{
  if(!c||typeof c.url!=='string'||candidateUrl(c.url)!==c.url||seen.has(c.url)||typeof c.title!=='string'||!c.title.trim()||c.title.length>500||typeof c.observedAt!=='string'||!Number.isFinite(Date.parse(c.observedAt))||c.verification!=='search_candidate_only'||c.productVerified!==false||c.navigationApproved!==false)fail('DISCOVERY_CHECKPOINT_INVALID');
  const host=new URL(c.url).hostname.replace(/^www\./,'');if(c.sourceHost!==host)fail('DISCOVERY_CHECKPOINT_INVALID');seen.add(c.url);
  return {title:c.title,url:c.url,sourceHost:host,observedAt:c.observedAt,verification:'search_candidate_only',productVerified:false,navigationApproved:false};
 });
 return {taskId,status:'discovered',query:plan.query,maxPrice:plan.maxPrice,candidates,comparisonVerified:false,requiresProductVerification:true,purchaseAuthorized:false,accountConnections:false};
}
function createDiscoveryCapability({verifyScope,checkpoints,search,now=()=>new Date().toISOString()}){
 if(typeof verifyScope!=='function'||!checkpoints?.exclusive||typeof search?.search!=='function')fail('HOST_DEPENDENCIES_REQUIRED');
 return async function discover({text,scope,taskId,signal,isCurrent=()=>false}){
  scopeKey(scope,taskId);const plan=discoveryRequest(text);
  async function current(){if(signal?.aborted||!isCurrent()||!await verifyScope(scope)||signal?.aborted||!isCurrent())fail('TASK_INTERRUPTED')}
  await current();
  // Separate task IDs/namespace must be supplied by the host; never share a shopping checkpoint key.
  return checkpoints.exclusive(scope,taskId,async store=>{
   const existing=await store.read();await current();
   if(existing){if(existing.kind!=='public-product-discovery'||existing.request!==text)fail('TASK_REQUEST_MISMATCH');if(existing.status==='discovered')return {...restoreReport(existing,plan,taskId),resultSource:'saved'};if(existing.status!=='not_started')fail('RECONCILE_BEFORE_RETRY')}
   const task=existing||{version:1,kind:'public-product-discovery',scope,taskId,request:text,plan};task.status='running';await store.write(task);
   let data;try{await current();data=await search.search(plan,{signal,assertCurrent:current})}catch(error){task.status=['DISCOVERY_DISABLED','FREE_SEARCH_ALLOWANCE_UNVERIFIED','FREE_SEARCH_LIMIT_REACHED','DISCOVERY_NOT_CONFIGURED'].includes(error?.message)?'not_started':'unconfirmed';await store.write(task);throw Error(['TASK_INTERRUPTED','DISCOVERY_DISABLED','FREE_SEARCH_ALLOWANCE_UNVERIFIED','FREE_SEARCH_LIMIT_REACHED','DISCOVERY_NOT_CONFIGURED','DISCOVERY_REQUEST_REJECTED'].includes(error?.message)?error.message:'DISCOVERY_REQUEST_UNCONFIRMED')}
   await current();const candidates=candidatesFromSearch(data,{now});
   const report={taskId,status:'discovered',query:plan.query,maxPrice:plan.maxPrice,candidates,comparisonVerified:false,requiresProductVerification:true,purchaseAuthorized:false,accountConnections:false};
   task.status='discovered';task.report=report;await store.write(task);await current();return {...report,resultSource:'fresh'};
  });
 };
}
module.exports={discoveryRequest,candidateUrl,candidatesFromSearch,createBrowserbaseSearch,createDiscoveryCapability};
