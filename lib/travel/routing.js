'use strict';
const {boundedJson}=require('../attention/storage-response.cjs');
function readiness(env=process.env){
 return {connected:env.JAMES_ROUTING_ENABLED==='true'&&Boolean(env.GOOGLE_MAPS_API_KEY),reason:!env.GOOGLE_MAPS_API_KEY?'configuration_missing':env.JAMES_ROUTING_ENABLED!=='true'?'disabled':'ready'};
}
function waypoint(value,now){
 if(!value||typeof value!=='object')throw Error('STARTING_POINT_REQUIRED');
 if(value.kind==='address'&&typeof value.address==='string'&&value.confirmed===true){
  const address=value.address.trim();if(address.length>=5&&address.length<=500&&!/[\x00-\x1f]/.test(address))return {address};
 }
 if(value.kind==='device'&&Number.isFinite(value.latitude)&&Math.abs(value.latitude)<=90&&Number.isFinite(value.longitude)&&Math.abs(value.longitude)<=180&&Number.isFinite(value.observedAt)&&now-value.observedAt>=0&&now-value.observedAt<=300000&&Number.isFinite(value.accuracy)&&value.accuracy>=0&&value.accuracy<=1000){
  return {location:{latLng:{latitude:value.latitude,longitude:value.longitude}}};
 }
 throw Error('STARTING_POINT_REQUIRED');
}
function seconds(value){
 if(typeof value!=='string'||!/^\d+(\.\d+)?s$/.test(value))throw Error('ROUTE_UNAVAILABLE');
 const n=Math.ceil(Number(value.slice(0,-1)));if(n<=0||n>604800)throw Error('ROUTE_UNAVAILABLE');return n;
}
async function estimate({origin,destination,appointmentStart,bufferMinutes=10},{env=process.env,fetchImpl=fetch,now=Date.now()}={}){
 if(!readiness(env).connected)return {status:'unavailable',reason:readiness(env).reason};
 let from;try{from=waypoint(origin,now);}catch{return {status:'unavailable',reason:'starting_point_required'};}
 if(typeof destination!=='string'||destination.trim().length<5||destination.length>500||/[\x00-\x1f]/.test(destination))return {status:'unavailable',reason:'destination_required'};
 const start=Date.parse(appointmentStart);
 if(!Number.isFinite(start)||start<=now||!Number.isInteger(bufferMinutes)||bufferMinutes<0||bufferMinutes>120)return {status:'unavailable',reason:'appointment_required'};
 try{
  const response=await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_MAPS_API_KEY,'X-Goog-FieldMask':'routes.duration,routes.staticDuration,routes.distanceMeters'},body:JSON.stringify({origin:from,destination:{address:destination.trim()},travelMode:'DRIVE',routingPreference:'TRAFFIC_AWARE',computeAlternativeRoutes:false})});
  if(!response.ok)return {status:'unavailable',reason:response.status===429?'provider_limit':response.status===401||response.status===403?'provider_configuration':'provider_unavailable'};
  const data=await boundedJson(response),route=data.routes?.[0];
  const driveSeconds=seconds(route?.duration),baselineSeconds=seconds(route?.staticDuration);
  if(!Number.isFinite(route.distanceMeters)||route.distanceMeters<0||route.distanceMeters>20000000)throw Error();
  return {status:'ready',observedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString(),trafficBasis:'current_at_request',driveSeconds,trafficDelaySeconds:Math.max(0,driveSeconds-baselineSeconds),distanceMeters:route.distanceMeters,bufferMinutes,estimatedLeaveBy:new Date(start-(driveSeconds+bufferMinutes*60)*1000).toISOString(),calendarChanged:false};
 }catch{return {status:'unavailable',reason:'provider_unavailable'};}
}
module.exports={readiness,waypoint,estimate};
