'use strict';
// One-off, reviewed Preview build probe. No Search, session creation or DB writes.
const {createHash}=require('node:crypto');
const {scopeKey}=require('./checkpoints.cjs');
const {validGrant}=require('./search-allowance.cjs');
const {valueWithin}=require('./public-fetch.cjs');
const BRANCH='poc/j30-browserbase-shopping-20261028';
const PROJECT='prj_SeUz2jQJ2KqxZFMALQsKloLicijw';
const MARKER='J30: inspect included allowance';
const digest=value=>createHash('sha256').update(value).digest('hex');
async function smallJson(response){
 if(!response?.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||'')||!response.body?.getReader){try{await response?.body?.cancel()}catch{}throw Error('READ_UNCONFIRMED')}
 const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>16000))throw Error('READ_UNCONFIRMED');
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16000)throw Error('READ_UNCONFIRMED');chunks.push(Buffer.from(value))}}finally{try{await reader.cancel()}catch{}reader.releaseLock()}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function inspectIncludedAllowance({env=process.env,fetchImpl=fetch,now=Date.now}={}){
 const report={event:'j30.allowance_inspection',mode:'read_only',searchRequests:0,browserSessions:0,databaseWrites:0};
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==BRANCH||env.VERCEL_PROJECT_ID!==PROJECT||!String(env.VERCEL_GIT_COMMIT_MESSAGE||'').startsWith(MARKER))return {...report,status:'SKIPPED'};
 let grant;try{grant=JSON.parse(env.J30_FREE_SEARCH_GRANT||'null')}catch{}
 if(!validGrant(grant,now())||env.J30_BROWSERBASE_ENABLED!=='1'||env.J30_BROWSERBASE_USAGE_APPROVED!=='1'||!env.BROWSERBASE_API_KEY||!env.BROWSERBASE_PROJECT_ID||!env.KV_REST_API_URL||!env.KV_REST_API_TOKEN)return {...report,status:'CONFIGURATION_UNCONFIRMED'};
 try{const u=new URL(env.KV_REST_API_URL);if(u.protocol!=='https:'||u.username||u.password)throw Error()}catch{return {...report,status:'CONFIGURATION_UNCONFIRMED'}}
 const identity=digest('browserbase-project:'+env.BROWSERBASE_PROJECT_ID),scope={accountId:identity,conversationId:'included-search-usage',generation:1},taskId='search-grant-'+grant.grantId;
 const key='james:j30:v1:'+scopeKey(scope,taskId),fingerprint=digest(JSON.stringify(grant));
 const read=async(url,options)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{return await valueWithin(async()=>smallJson(await fetchImpl(url,{...options,redirect:'error',signal:controller.signal})),controller.signal)}finally{clearTimeout(timer);controller.abort()}};
 const [ledger,usage]=await Promise.allSettled([
  read(env.KV_REST_API_URL,{method:'POST',headers:{Authorization:'Bearer '+env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(['GET',key])}),
  read('https://api.browserbase.com/v1/projects/'+encodeURIComponent(env.BROWSERBASE_PROJECT_ID)+'/usage',{method:'GET',headers:{'X-BB-API-Key':env.BROWSERBASE_API_KEY,Accept:'application/json'}})
 ]);
 let pilotBudget={status:'UNCONFIRMED'},browserUsage={status:'UNCONFIRMED'};
 if(ledger.status==='fulfilled')try{
  const envelope=ledger.value;if(envelope.error||typeof envelope.result!=='string')throw Error();const state=JSON.parse(envelope.result),row=state.task;
  if(state.version!==1||state.lock!==null||!row||row.version!==1||row.kind!=='included-search-reservations'||JSON.stringify(row.scope)!==JSON.stringify(scope)||row.taskId!==taskId||row.grantFingerprint!==fingerprint||!Number.isInteger(row.reserved)||row.reserved<0||row.reserved>grant.maxCalls||!validGrant(grant,now()))throw Error();
  pilotBudget={status:row.reserved===grant.maxCalls?'LIMIT_REACHED':'AVAILABLE',callLimit:grant.maxCalls,reservedCalls:row.reserved,remainingPilotCalls:grant.maxCalls-row.reserved,planEvidence:'approved_free_grant',evidenceAgeSeconds:Math.floor((now()-Date.parse(grant.verifiedAt))/1000)};
 }catch{}
 if(usage.status==='fulfilled'){
  const value=usage.value;if(Number.isSafeInteger(value.browserMinutes)&&value.browserMinutes>=0&&Number.isSafeInteger(value.proxyBytes)&&value.proxyBytes>=0)browserUsage={status:'OBSERVED',browserMinutes:value.browserMinutes,proxyBytes:value.proxyBytes,browserSafetyLimitMinutes:55,withinBrowserSafetyLimit:value.browserMinutes<=55};
 }
 return {...report,status:pilotBudget.status==='UNCONFIRMED'||browserUsage.status==='UNCONFIRMED'?'READ_UNCONFIRMED':!browserUsage.withinBrowserSafetyLimit||browserUsage.proxyBytes>0?'USAGE_REVIEW_REQUIRED':pilotBudget.status==='LIMIT_REACHED'?'PILOT_LIMIT_REACHED':'APP_BUDGET_AVAILABLE',pilotBudget,browserUsage,providerSearchBalanceVerified:false};
}
if(require.main===module)inspectIncludedAllowance().then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(()=>process.stdout.write(JSON.stringify({event:'j30.allowance_inspection',mode:'read_only',status:'READ_UNCONFIRMED'})+'\n'));
module.exports={inspectIncludedAllowance,BRANCH,PROJECT,MARKER};
