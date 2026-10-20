const crypto=require('node:crypto');
const {requireAuth}=require('../lib/auth.js');
const {bridgeKeys}=require('../lib/wardrobe/signing-key.cjs');
const siteOrigin='https://aaru-working-review.aglow-ox-8353.chatgpt.site';
module.exports=async function(req,res){
 const session=requireAuth(req,res);if(!session)return;
 if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
 const query={...(req.query||{})};delete query.path;
 if(Object.keys(query).some(k=>!['photo','bridgeKey'].includes(k))||('photo'in query&&(typeof query.photo!=='string'||!/^[a-f0-9]{64}$/.test(query.photo))))return res.status(400).json({error:'INVALID_WARDROBE_READ'});
 if('bridgeKey' in query&&(query.bridgeKey!=='1'||'photo'in query))return res.status(400).json({error:'INVALID_WARDROBE_READ'});
 res.setHeader('Cache-Control','private, no-store');
 try{
  // This app authorizes a single configured owner; callers cannot choose the map.
  const owner='james-single-owner-v1';
  const keys=bridgeKeys(process.env.JAMES_WARDROBE_BRIDGE_SECRET);
  if(query.bridgeKey==='1'){if(req.method==='HEAD')return res.status(200).end();return res.status(200).json({protocol:'james-wardrobe-read-ed25519-v2',owner,publicKey:keys.publicKey});}
  const {createReadRequest}=await import('../lib/wardrobe/read-bridge.mjs');
  const signed=await createReadRequest({siteOrigin,path:query.photo?'/api/rue/wardrobe/photos/'+query.photo:'/api/rue/wardrobe',owner,sign:bytes=>crypto.sign(null,bytes,keys.privateKey),serviceToken:process.env.JAMES_WARDROBE_SERVICE_TOKEN,issuedAt:Date.now(),nonce:crypto.randomBytes(16).toString('hex')});
  const upstream=await fetch(signed,{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!upstream.ok)return res.status(502).json({error:'WARDROBE_UNAVAILABLE'});
  // Read is bounded; no raw server/provider error body is exposed.
  let size=0;const chunks=[],reader=upstream.body.getReader();
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>24*1024*1024){await reader.cancel();throw Error('Response too large');}chunks.push(Buffer.from(value));}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(req.method==='HEAD')return res.status(200).end();
  return res.status(200).json(value);
 }catch{return res.status(503).json({error:'WARDROBE_UNAVAILABLE'});}
};
