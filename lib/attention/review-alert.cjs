'use strict';
const crypto=require('node:crypto');
const push=require('web-push');
const {projectReview}=require('./mail-review.cjs');
const {boundedJson}=require('./storage-response.cjs');
const host='james-app-git-fix-calendar-refresh-diagnosis-fe3b3a-james-cb7a.vercel.app';
const duration=86400000;
const enabled=(req,env=process.env)=>env.VERCEL_ENV==='preview' && env.VERCEL_GIT_COMMIT_REF==='fix/calendar-refresh-diagnosis-20261031' && env.VERCEL_PROJECT_ID==='prj_SeUz2jQJ2KqxZFMALQsKloLicijw' && req.headers.host===host;
const fail=code=>{throw Object.assign(Error(code),{code});};
const cas="if (redis.call('GET',KEYS[1]) or '')~=ARGV[1] then return 0 end; if ARGV[2]=='' then redis.call('DEL',KEYS[1]) else redis.call('SET',KEYS[1],ARGV[2],'PXAT',ARGV[3]) end; return 1";
async function command(parts){
  const response=await fetch(process.env.KV_REST_API_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{Authorization:'Bearer '+process.env.KV_REST_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(parts)});
  if(!response.ok)fail('STORE_UNAVAILABLE');
  const data=await boundedJson(response);
  if(data.error||!Object.hasOwn(data,'result'))fail('STORE_UNAVAILABLE');
  return data.result;
}
function subscription(input){
  if(typeof input?.endpoint!=='string'||typeof input?.keys?.p256dh!=='string'||typeof input?.keys?.auth!=='string')fail('INVALID_SUBSCRIPTION');
  if(!/^https:\/\/fcm\.googleapis\.com\/(?:fcm\/send|wp)\/[A-Za-z0-9_:-]{16,2048}$/.test(input?.endpoint)||! /^(?:[A-Za-z0-9_-]{87})$/.test(input?.keys?.p256dh)||! /^[A-Za-z0-9_-]{22}$/.test(input?.keys?.auth))fail('INVALID_SUBSCRIPTION');
  const pub=Buffer.from(input.keys.p256dh,'base64url');
  try{crypto.ECDH.convertKey(pub,'prime256v1');}catch{fail('INVALID_SUBSCRIPTION');}
  return {endpoint:input.endpoint,keys:{p256dh:input.keys.p256dh,auth:input.keys.auth}};
}
async function transmit(state,key){
  const request=push.generateRequestDetails(state.subscription,JSON.stringify({kind:'saved-mail-review',key}),{
    TTL:300,vapidDetails:{subject:'https://getjames.ai',...state.keys}
  });
  const response=await fetch(request.endpoint,{method:'POST',headers:request.headers,body:request.body,redirect:'error',signal:AbortSignal.timeout(6500)});
  return response.status===201?'accepted':'rejected';
}
function create(owner,{secret=process.env.JAMES_SESSION_SECRET,redis=command,send=transmit,now=Date.now}={}){
  if(!owner||!secret||Buffer.byteLength(secret)<32)fail('NOT_CONFIGURED');
  const key='james:review-alert:v1:'+crypto.createHash('sha256').update(host+'|'+owner).digest('hex');
  const cipherKey=crypto.hkdfSync('sha256',secret,key,'saved-review-enrollment',32);
  function seal(value){
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',cipherKey,iv);
    const body=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');
  }
  function open(raw){
    if(raw===null)return null;
    const b=Buffer.from(raw,'base64url'),d=crypto.createDecipheriv('aes-256-gcm',cipherKey,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]));
  }
  async function update(fn){
    for(let attempt=0;attempt<4;attempt++){
      const raw=await redis(['GET',key]),old=open(raw),next=fn(old);
      if(old===next)return old;
      if(await redis(['EVAL',cas,1,key,raw??'',next?seal(next):'',String(next?.expires??0)])===1)return next;
    }
    fail('RETRY');
  }
  const status=s=>({state:s?.state??'off',receipt:s?.receipt??null,expires:s?.expires??null});
  return {
    async status(){return status(open(await redis(['GET',key])));},
    async prepare(){
      const s=await update(old=>old??{state:'pairing',expires:now()+duration,keys:push.generateVAPIDKeys()});
      if(s.state!=='pairing')fail('ALREADY_ENROLLED');
      return {publicKey:s.keys.publicKey};
    },
    async pair(input,publicKey){
      const sub=subscription(input);
      return status(await update(old=>{
        if(old?.state==='armed'&&old.subscription.endpoint===sub.endpoint&&old.keys.publicKey===publicKey)return old;
        if(old?.state!=='pairing'||old.keys.publicKey!==publicKey)fail('RETRY');
        return {...old,state:'armed',since:now(),subscription:sub};
      }));
    },
    async stop(){await update(()=>null);return {state:'off'};},
    async acknowledge(key,receipt){
      if(!/^[a-f0-9]{64}$/.test(key)||!['shown','opened'].includes(receipt))fail('INVALID_RECEIPT');
      return status(await update(old=>{
        if(old?.reviewKey!==key||!['sending','accepted','unconfirmed'].includes(old.state))return old;
        return old.receipt==='opened'||old.receipt===receipt?old:{...old,receipt};
      }));
    },
    async deliver(snapshot){
      const token=crypto.randomUUID();
      const s=await update(old=>{
        if(old?.state!=='armed'||old.expires<=now())return old;
        const review=projectReview(snapshot);
        const item=review?.items.find(i=>{
          const provider=review.sources?.[i.id.startsWith('gmail:')?'gmail':'hotmail'];
          return provider&&!provider.stale&&Date.parse(i.received)>=old.since&&Date.parse(i.received)<=now();
        });
        return item?{...old,state:'sending',token,reviewKey:item.reviewKey}:old;
      });
      if(s?.token!==token)return;
      let state='unconfirmed';
      try{state=await send(s,s.reviewKey);}catch{/* An ambiguous send cannot safely be repeated. */}
      await update(old=>old?.token===token?{state,expires:old.expires,reviewKey:old.reviewKey,receipt:old.receipt}:old);
    }
  };
}
module.exports={create,enabled,subscription,transmit};
