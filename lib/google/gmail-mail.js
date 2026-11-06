'use strict';
const {requireAuth,privateNoStore,configuredIdentity}=require('../auth.js');
const {tokenKey,SCOPE}=require('./gmail-connect.js');
const {boundedJson}=require('../attention/storage-response.cjs');
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(id);
function normalize(message){
 if(!validId(message?.id))throw Error('INVALID_MESSAGE');
 const headers=message.payload?.headers||[];
 const header=name=>String(headers.find(h=>String(h.name).toLowerCase()===name)?.value||'');
 const date=Number(message.internalDate);
 return {id:'gmail:'+message.id,subject:header('subject').slice(0,300)||'(No subject)',sender:header('from').slice(0,200)||'Unknown sender',preview:String(message.snippet||'').slice(0,1200),receivedDateTime:Number.isFinite(date)&&date>0&&date<8640000000000000?new Date(date).toISOString():null,importance:message.labelIds?.includes('IMPORTANT')?'high':'normal',flagStatus:message.labelIds?.includes('STARRED')?'flagged':'notFlagged'};
}
function plainBody(payload){
 let text='',visited=0;
 function walk(part,depth){if(!part||++visited>100||depth>10||text.length>=100000)return;
  if(part.mimeType==='text/plain'&&!part.filename&&typeof part.body?.data==='string'&&part.body.data.length<=150000)text+=Buffer.from(part.body.data,'base64url').toString('utf8').slice(0,100000-text.length)+'\n';
  for(const child of (Array.isArray(part.parts)?part.parts:[]).slice(0,100))walk(child,depth+1);
 }walk(payload,0);return text.trim();
}
function createReader({fetchImpl=(...args)=>fetch(...args),env=process.env,identity=configuredIdentity}={}){
 async function readBounded(url,options,deadline){const remaining=deadline-Date.now();if(remaining<=0)throw Error('GMAIL_READ_TIMEOUT');const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(Math.min(10000,remaining))});const data=await boundedJson(response);if(!response.ok)throw Error('GMAIL_READ_UNAVAILABLE');return data;}
 return async({messageId,previous}={})=>{
  const deadline=Date.now()+90000,read=(url,options)=>readBounded(url,options,deadline);
  const stored=await read(env.KV_REST_API_URL,{method:'POST',headers:{Authorization:'Bearer '+env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(['GET',tokenKey(env,identity())])});
  if(stored.error||!Object.hasOwn(stored,'result'))throw Error('GMAIL_STORE_UNAVAILABLE');
  if(stored.result===null)return {connected:false,messages:[]};
  if(typeof stored.result!=='string'||stored.result.length>16384)throw Error('INVALID_GMAIL_GRANT');
  const saved=JSON.parse(stored.result);
  if(saved.scope!==SCOPE||typeof saved.refreshToken!=='string'||!saved.refreshToken)throw Error('INVALID_GMAIL_GRANT');
  const token=await read('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:saved.refreshToken,grant_type:'refresh_token'})});
  if(typeof token.access_token!=='string'||!token.access_token)throw Error('GMAIL_REFRESH_UNAVAILABLE');
  if(typeof token.scope==='string'&&!token.scope.split(/\s+/).includes(SCOPE))throw Error('GMAIL_SCOPE_UNAVAILABLE');
  const headers={Authorization:'Bearer '+token.access_token},base='https://gmail.googleapis.com/gmail/v1/users/me/messages';
  if(messageId!==undefined){
   if(!validId(messageId))throw Error('INVALID_MESSAGE_ID');
   const message=await read(base+'/'+encodeURIComponent(messageId)+'?format=full',{headers});
   if(message.id!==messageId)throw Error('INVALID_MESSAGE');
   return {connected:true,message:{...normalize(message),bodyText:plainBody(message.payload)||String(message.snippet||'').slice(0,1200)},bodyLimited:true};
  }
  async function readPage(cursor=null){
   if(cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>4096))throw Error('INVALID_GMAIL_CURSOR');
   const url=new URL(base);url.searchParams.set('labelIds','INBOX');url.searchParams.set('maxResults','25');url.searchParams.set('includeSpamTrash','false');if(cursor)url.searchParams.set('pageToken',cursor);
   const list=await read(url.toString(),{headers});
   if(list.messages!==undefined&&!Array.isArray(list.messages))throw Error('INVALID_GMAIL_PAGE');
  const rows=list.messages||[];
  if(rows.length>25||rows.some(row=>!validId(row?.id))||new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('INVALID_GMAIL_PAGE');
  const messages=[];
  // Five concurrent reads per batch; fail the whole page rather than claim partial coverage.
  for(let index=0;index<rows.length;index+=5){
   const batch=await Promise.allSettled(rows.slice(index,index+5).map(async row=>{
    const message=await read(base+'/'+encodeURIComponent(row.id)+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From',{headers});
    if(message.id!==row.id)throw Error('INVALID_MESSAGE');return normalize(message);
   }));
   if(batch.some(result=>result.status==='rejected'))throw Error('GMAIL_PAGE_INCOMPLETE');
   messages.push(...batch.map(result=>result.value));
  }
   if(list.nextPageToken!==undefined&&(typeof list.nextPageToken!=='string'||!list.nextPageToken||list.nextPageToken.length>4096))throw Error('INVALID_GMAIL_CURSOR');
   const nextCursor=typeof list.nextPageToken==='string'&&list.nextPageToken.length<=4096&&list.nextPageToken?list.nextPageToken:null;
   return {messages,nextCursor};
  }
  async function finish(data){
   data=await require('../attention/mail-discovery.cjs').discover(previous,'gmail-inbox-review',data,readPage,new Date().toISOString());
   delete data.nextCursor;
   if(!previous)return data;
   const {selectChecks,verifyChecks}=require('../attention/mail-reconcile.cjs');
   const selected=selectChecks(previous,'gmail',data.messages.map(message=>message.id));
   const checked=await verifyChecks(selected.ids,async id=>{
    if(!id.startsWith('gmail:')||!validId(id.slice(6)))throw Error('INVALID_MESSAGE_ID');
    if(Date.now()>=deadline)throw Error('GMAIL_READ_TIMEOUT');
    const response=await fetchImpl(base+'/'+encodeURIComponent(id.slice(6))+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From',{headers,redirect:'error',signal:AbortSignal.timeout(Math.min(10000,deadline-Date.now()))});
    if(response.status===404)return {absent:true};
    if(!response.ok)throw Error('GMAIL_RECONCILIATION_UNAVAILABLE');
    const message=await boundedJson(response);
    if(message.id!==id.slice(6)||!Array.isArray(message.labelIds))throw Error('INVALID_MESSAGE');
    if(!message.labelIds.includes('INBOX'))return {absent:true};
    return {message:normalize(message)};
   });
   return {...data,reconciliation:{...checked,cursor:selected.cursor}};
  }
  const profile=await read('https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=historyId',{headers});
  const historyId=typeof profile?.historyId==='string'&&/^\d{1,30}$/.test(profile.historyId)?profile.historyId:null;
  const checkpoint=previous?.provenance?.find(p=>p?.collector==='gmail-inbox-review')?.checkpoint;
  if(historyId&&checkpoint?.historyId===historyId&&Array.isArray(checkpoint.messageIds)&&checkpoint.messageIds.length<=25&&(!checkpoint.hasMore||(typeof checkpoint.nextCursor==='string'&&checkpoint.nextCursor.length<=4096))){
   const known=new Map();
   for(const scan of previous?.state?.scans||[])if(JSON.stringify(scan.source)===JSON.stringify(['google','gmail-inbox-review']))for(const event of scan.pages.flat())if(event.mail){const old=known.get(event.mail.id);if(!old||event.at>=old.at)known.set(event.mail.id,event);}
   if(checkpoint.messageIds.every(id=>typeof id==='string'&&id.startsWith('gmail:')&&known.has(id)&&!known.get(id).mail.reviewHandled))return finish({connected:true,messages:checkpoint.messageIds.map(id=>known.get(id).mail),hasMore:checkpoint.hasMore===true,nextCursor:checkpoint.nextCursor||null,checkpoint,mailboxWide:false,semanticReviewComplete:false});
  }
  const page=await readPage();
  const hasMore=!!page.nextCursor;
  return finish({connected:true,...page,hasMore,checkpoint:historyId?{historyId,messageIds:page.messages.map(message=>message.id),hasMore,nextCursor:page.nextCursor}:null,mailboxWide:false,semanticReviewComplete:false});
 };
}
function createHandler({authorize=requireAuth,reader=createReader()}={}){
 return async(req,res)=>{privateNoStore(res);if(!authorize(req,res))return;
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  const query={...req.query};delete query.path;
  if(Object.keys(query).some(key=>key!=='messageId')||(query.messageId!==undefined&&!validId(query.messageId)))return res.status(400).json({error:'INVALID_GMAIL_REQUEST'});
  try{const data=await reader(query);const {checkpoint,discovery,reconciliation,nextCursor,...publicData}=data;return res.status(200).json(publicData);}catch{return res.status(503).json({error:'GMAIL_READ_UNAVAILABLE'});}
 };
}
module.exports=createHandler();module.exports.createReader=createReader;module.exports.createHandler=createHandler;module.exports.normalize=normalize;
