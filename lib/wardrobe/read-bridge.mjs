// Ed25519 read-only bridge. Receiver holds only a pinned public verification key.
const encoder=new TextEncoder();
const plainHeaders={'Cache-Control':'private, no-store','Content-Type':'application/json'};
const json=(error,status)=>new Response(JSON.stringify({error}),{status,headers:plainHeaders});
function route(path){return path==='/api/rue/wardrobe'||/^\/api\/rue\/wardrobe\/photos\/[a-f0-9]{64}$/.test(path);}
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
function unhex(text){if(!/^[a-f0-9]{128}$/.test(text))throw Error('Invalid signature');return Uint8Array.from(text.match(/../g),x=>parseInt(x,16));}
function payload({path,owner,issuedAt,nonce}){return JSON.stringify(['james-wardrobe-read-ed25519-v2','GET',path,owner,issuedAt,nonce]);}
function verificationKey(publicKey){if(typeof publicKey!=='string'||!/^[a-f0-9]{64}$/.test(publicKey))throw Error('Bridge not configured');return crypto.subtle.importKey('raw',Uint8Array.from(publicKey.match(/../g),x=>parseInt(x,16)),'Ed25519',false,['verify']);}
export async function createReadRequest({siteOrigin,path,owner,sign,serviceToken,issuedAt,nonce}){
 const origin=new URL(siteOrigin);
 if(origin.protocol!=='https:'||origin.origin!==siteOrigin||origin.username||origin.password||!route(path)||typeof owner!=='string'||!owner.trim()||!Number.isSafeInteger(issuedAt)||! /^[a-f0-9]{32}$/.test(nonce)||typeof sign!=='function'||typeof serviceToken!=='string'||!serviceToken)throw Error('Invalid bridge request');
 const signature=hex(await sign(encoder.encode(payload({path,owner,issuedAt,nonce}))));
 return new Request(siteOrigin+'/api/james/wardrobe-bridge?resource='+encodeURIComponent(path),{method:'GET',redirect:'error',headers:{'OAI-Sites-Authorization':'Bearer '+serviceToken,'X-James-Owner':owner,'X-James-Issued-At':String(issuedAt),'X-James-Nonce':nonce,'X-James-Signature':signature}});
}
export function createReadBridge({siteOrigin,ownerNamespace,wardrobeUserId,publicKey,wardrobeRead,photoRead,nowMs}){
 if(typeof ownerNamespace!=='string'||!ownerNamespace.trim()||typeof wardrobeUserId!=='string'||!wardrobeUserId.trim()||typeof nowMs!=='function'||typeof wardrobeRead!=='function'||typeof photoRead!=='function')throw Error('Explicit owner mapping required');
 if(typeof publicKey!=='string'||!/^[a-f0-9]{64}$/.test(publicKey))throw Error('Bridge not configured');
 let pinnedKey;
 return async function(request,env){
  if(request.method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET','Cache-Control':'private, no-store'}});
  const u=new URL(request.url);
  if(u.origin!==siteOrigin||u.pathname!=='/api/james/wardrobe-bridge'||[...u.searchParams.keys()].length!==1||u.searchParams.getAll('resource').length!==1)return json('INVALID_BRIDGE_REQUEST',400);
  const path=u.searchParams.get('resource');if(!route(path))return json('UNSUPPORTED_RESOURCE',400);
  const owner=request.headers.get('X-James-Owner'),stamp=request.headers.get('X-James-Issued-At'),nonce=request.headers.get('X-James-Nonce'),signature=request.headers.get('X-James-Signature');
  if(owner!==ownerNamespace||!/^\d{1,16}$/.test(stamp||'')||! /^[a-f0-9]{32}$/.test(nonce||''))return json('BRIDGE_UNAUTHORIZED',401);
  const issuedAt=Number(stamp),now=nowMs();
  if(!Number.isSafeInteger(issuedAt)||!Number.isSafeInteger(now)||Math.abs(now-issuedAt)>60000)return json('BRIDGE_EXPIRED',401);
  try{if(!await crypto.subtle.verify('Ed25519',await (pinnedKey??=verificationKey(publicKey)),unhex(signature||''),encoder.encode(payload({path,owner,issuedAt,nonce}))))return json('BRIDGE_UNAUTHORIZED',401);}catch{return json('BRIDGE_UNAUTHORIZED',401);}
  // Fixed server-owned target. No external visitor identity/header is trusted.
  const internal=new Request(siteOrigin+path,{method:'GET',headers:{'oai-authenticated-user-id':wardrobeUserId}});
  try{
   const result=await (path==='/api/rue/wardrobe'?wardrobeRead:photoRead)(internal,env);
   const headers=new Headers(result.headers);headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff');
   return new Response(result.body,{status:result.status,headers});
  }catch{return json('WARDROBE_UNAVAILABLE',503);}
 };
}
