'use strict';
const {requireAuth,privateNoStore}=require('../auth');
const {boundedJson}=require('../attention/storage-response.cjs');
function createHandler({authorize=requireAuth,env=process.env,fetchImpl=fetch}={}){
 return async(req,res)=>{
  privateNoStore(res);if(!authorize(req,res,{csrf:true}))return;
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
  if(!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||''))return res.status(415).json({error:'JSON_REQUIRED'});
  const query={...req.query};delete query.path;if(Object.keys(query).length)return res.status(400).json({error:'QUERY_NOT_SUPPORTED'});
  let body;try{const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(!raw||Buffer.byteLength(raw)>2048)throw Error();body=JSON.parse(raw);if(!body||Object.keys(body).join('|')!=='query'||typeof body.query!=='string'||body.query.trim().length<3||body.query.length>400||/[\x00-\x1f]/.test(body.query))throw Error();}catch{return res.status(400).json({error:'INVALID_PLACE_QUERY'});}
  if(!env.GOOGLE_MAPS_API_KEY||env.JAMES_ROUTING_ENABLED!=='true')return res.status(200).json({status:'unavailable',reason:'maps_configuration_missing',places:[]});
  try{
   const response=await fetchImpl('https://places.googleapis.com/v1/places:searchText',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.businessStatus'},body:JSON.stringify({textQuery:body.query.trim(),pageSize:4,languageCode:'en',regionCode:'US'})});
   if(!response.ok){await response.body?.cancel();return res.status(200).json({status:'unavailable',reason:response.status===403||response.status===401?'places_permission_required':response.status===429?'provider_limit':'provider_unavailable',places:[]});}
   const data=await boundedJson(response);if(data.places!==undefined&&!Array.isArray(data.places))throw Error();
   const clean=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\x00-\x1f]/.test(v)?v.trim():null;
   const places=(data.places||[]).slice(0,4).flatMap(p=>{
    const id=clean(p.id,300),name=clean(p.displayName?.text,200),address=clean(p.formattedAddress,600);if(!id||!name||!address||p.businessStatus==='CLOSED_PERMANENTLY')return [];
    let mapsUrl=null;try{const u=new URL(p.googleMapsUri);if(u.protocol==='https:'&&!u.username&&!u.password&&['maps.google.com','www.google.com','google.com'].includes(u.hostname))mapsUrl=u.href;}catch{}
    return [{id,name,address,mapsUrl,businessStatus:['OPERATIONAL','CLOSED_TEMPORARILY'].includes(p.businessStatus)?p.businessStatus:'not_supplied'}];
   });
   return res.status(200).json({status:places.length?'ready':'no_matches',places,source:'Google Maps',coverage:'up_to_four_ranked_matches_not_exhaustive',closestVerified:false,message:'Confirm the intended branch and exact address before preparing an appointment. No home or current location was inferred.'});
  }catch{return res.status(200).json({status:'unavailable',reason:'provider_unavailable',places:[]});}
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
