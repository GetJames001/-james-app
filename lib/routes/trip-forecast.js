'use strict';
const {requireAuth,privateNoStore}=require('../auth.js');
const fields=['weather_code','temperature_2m_max','temperature_2m_min','precipitation_probability_max','precipitation_sum','snowfall_sum','wind_speed_10m_max','wind_gusts_10m_max'];
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const normal=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function localDay(now,timeZone){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 return ['year','month','day'].map(key=>parts.find(p=>p.type===key).value).join('-');
}
function createHandler({authorize=requireAuth,fetchImpl=fetch,now=()=>new Date()}={}){
 return async(req,res)=>{
  privateNoStore(res);
  if(!authorize(req,res))return;
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end();}
  const {location,country,date}=req.query||{};
  if(typeof location!=='string'||location.trim().length<2||location.length>120||/[\u0000-\u001f]/.test(location)||typeof country!=='string'||! /^[A-Z]{2}$/.test(country)||!day(date))return res.status(400).json({status:'invalid_request'});
  const output=value=>res.status(200).json(value);
  try{
   const query=new URL('https://geocoding-api.open-meteo.com/v1/search');
   query.search=new URLSearchParams({name:location.trim(),countryCode:country,count:'10',language:'en',format:'json'});
   const geo=await fetchImpl(query,{signal:AbortSignal.timeout(7000)});
   if(!geo.ok)throw Error();
   const data=await geo.json();
   if(data.results!==undefined&&!Array.isArray(data.results))throw Error();
   const results=(data.results||[]).slice(0,10).filter(p=>p.country_code===country&&normal(p.name)===normal(location.split(',')[0])&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180&&typeof p.timezone==='string');
   if(!results.length)return output({status:'location_not_found',location,date});
   if(results.length!==1)return output({status:'ambiguous_location',location,date,matches:results.slice(0,4).map(p=>({name:p.name,region:p.admin1,country:p.country_code})),nextStep:'Specify the city and state/region.'});
   const place=results[0],today=localDay(now(),place.timezone),ahead=(Date.parse(date)-Date.parse(today))/86400000;
   const basis={location:{name:place.name,region:place.admin1||null,country:place.country_code},date,timezone:place.timezone,source:'Open-Meteo',sourceUrl:'https://open-meteo.com/',coverage:'daily city forecast; not arrival-hour, road, pass or closure conditions'};
   if(ahead<0||ahead>15)return output({...basis,status:'outside_forecast_horizon'});
   const url=new URL('https://api.open-meteo.com/v1/forecast');
   url.search=new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),timezone:place.timezone,start_date:date,end_date:date,daily:fields.join(','),temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'inch'});
   const response=await fetchImpl(url,{signal:AbortSignal.timeout(7000)});
   if(!response.ok)throw Error();
   const forecast=await response.json();
   if(forecast.timezone!==place.timezone||forecast.daily?.time?.[0]!==date||!Number.isInteger(forecast.daily?.weather_code?.[0]))throw Error();
   const values={},units={},missing=[];
   for(const name of fields){
    const value=forecast.daily?.[name]?.[0],unit=forecast.daily_units?.[name];
    if(Number.isFinite(value)&&typeof unit==='string'&&unit.length<=16){values[name]=value;units[name]=unit;}
    else missing.push(name);
   }
   if(!Number.isFinite(values.temperature_2m_max)||!Number.isFinite(values.temperature_2m_min)||units.temperature_2m_max!=='°F'||units.temperature_2m_min!=='°F')throw Error();
   return output({...basis,status:missing.length?'partial':'ready',retrievedAt:now().toISOString(),values,units,missing});
  }catch{return res.status(502).json({status:'unavailable',message:'Trip forecast could not be retrieved.'});}
 };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
