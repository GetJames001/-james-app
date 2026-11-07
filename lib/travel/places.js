'use strict';
const {boundedJson}=require('../attention/storage-response.cjs');
function freshPoint(p,now=Date.now()){
 return p&&typeof p==='object'&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180&&Number.isFinite(p.accuracy)&&p.accuracy>=0&&p.accuracy<=1000&&Number.isFinite(p.observedAt)&&now-p.observedAt>=0&&now-p.observedAt<=300000;
}
async function searchPlaces({query,area='explicit',location},{env=process.env,fetchImpl=fetch,now=Date.now()}={}){
 if(typeof query!=='string'||query.trim().length<3||query.length>400||/[\x00-\x1f]/.test(query)||!['nearby','explicit'].includes(area))return {status:'unavailable',reason:'invalid_query',places:[]};
 if(area==='nearby'&&!freshPoint(location,now))return {status:'location_required',reason:'fresh_location_required',places:[],message:'Enable live location while James is open, or name the city to search. Do not infer a city from timezone, profile, home or weather.'};
  if(!env.GOOGLE_MAPS_API_KEY||env.JAMES_ROUTING_ENABLED!=='true')return ({status:'unavailable',reason:'maps_configuration_missing',places:[]});
  try{
   const response=await fetchImpl('https://places.googleapis.com/v1/places:searchText',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.businessStatus'},body:JSON.stringify({textQuery:query.trim(),pageSize:4,languageCode:'en',...(area==='nearby'?{locationBias:{circle:{center:{latitude:location.latitude,longitude:location.longitude},radius:25000}}}:{})})});
   if(!response.ok){await response.body?.cancel();return ({status:'unavailable',reason:response.status===403||response.status===401?'places_permission_required':response.status===429?'provider_limit':'provider_unavailable',places:[]});}
   const data=await boundedJson(response);if(data.places!==undefined&&!Array.isArray(data.places))throw Error();
   const clean=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\x00-\x1f]/.test(v)?v.trim():null;
   const places=(data.places||[]).slice(0,4).flatMap(p=>{
    const id=clean(p.id,300),name=clean(p.displayName?.text,200),address=clean(p.formattedAddress,600);if(!id||!name||!address||p.businessStatus==='CLOSED_PERMANENTLY')return [];
    let mapsUrl=null;try{const u=new URL(p.googleMapsUri);if(u.protocol==='https:'&&!u.username&&!u.password&&['maps.google.com','www.google.com','google.com'].includes(u.hostname))mapsUrl=u.href;}catch{}
    return [{id,name,address,mapsUrl,businessStatus:['OPERATIONAL','CLOSED_TEMPORARILY'].includes(p.businessStatus)?p.businessStatus:'not_supplied'}];
   });
   return ({status:places.length?'ready':'no_matches',places,source:'Google Maps',coverage:'up_to_four_ranked_matches_not_exhaustive',closestVerified:false,searchArea:area==='nearby'?'nearby_bias':'explicit_query',message:'Confirm the intended branch and exact address before preparing an appointment. No home or current location was inferred.'});
  }catch{return ({status:'unavailable',reason:'provider_unavailable',places:[]});}
}
module.exports={searchPlaces,freshPoint};
