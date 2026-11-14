'use strict';
const {requireAuth,configuredIdentity}=require('../auth.js');
const {create,enabled}=require('../attention/review-alert.cjs');
module.exports=async(req,res)=>{
  if(!enabled(req))return res.status(404).end();
  if(!requireAuth(req,res,{csrf:req.method==='POST'}))return;
  try{
    const service=create(configuredIdentity());
    if(req.method==='GET')return res.status(200).json(await service.status());
    if(req.method!=='POST')return res.status(405).end();
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return res.status(415).end();
    const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body??null);
    if(Buffer.byteLength(raw)>6000)return res.status(400).end();
    let data;try{data=JSON.parse(raw);}catch{return res.status(400).end();}
    if(data?.action==='prepare')return res.status(200).json(await service.prepare());
    if(data?.action==='pair')return res.status(200).json(await service.pair(data.subscription,data.publicKey));
    if(['shown','opened'].includes(data?.action))return res.status(200).json(await service.acknowledge(data.key,data.action));
    if(data?.action==='stop')return res.status(200).json(await service.stop());
    return res.status(400).end();
  }catch(error){return res.status(['INVALID_SUBSCRIPTION','INVALID_RECEIPT'].includes(error.code)?400:['ALREADY_ENROLLED','RETRY'].includes(error.code)?409:503).json({error:'ALERT_UNAVAILABLE'});}
};
