const {requireAuth}=require('../auth.js');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(!requireAuth(req,res))return;
 if(req.method!=='GET')return res.status(405).end();
 const {latitude,longitude}=req.query;
 const valid=(s,max)=>typeof s==='string' && /^-?\d+(\.\d)?$/.test(s) && Math.abs(Number(s))<=max;
 if(!valid(latitude,90)||!valid(longitude,180))return res.status(400).end();
 const lat=Number(latitude),lon=Number(longitude);
 const lats=[],lons=[];
 for(let i=-8;i<=8;i++){
  lats.push(Math.max(-90,Math.min(90,lat+.07)).toFixed(3));
  lons.push((((lon+i*.014/Math.max(.1,Math.cos(lat*Math.PI/180))+540)%360)-180).toFixed(3));
 }
 try{
  const url=new URL('https://api.open-meteo.com/v1/elevation');
  url.search=new URLSearchParams({latitude:lats.join(','),longitude:lons.join(',')});
  const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error();
  const {elevation}=await response.json();
  if(!Array.isArray(elevation)||elevation.length!==17||!elevation.every(Number.isFinite))throw Error();
  return res.json({heights:elevation});
 }catch{return res.status(503).json({error:'Terrain unavailable'});}
};
