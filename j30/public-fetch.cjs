'use strict';
// Shared anonymous public-page transport. No browser cookies, credentials or redirects.
const https=require('node:https'),dns=require('node:dns/promises'),{isIP,BlockList}=require('node:net');
const {candidateUrl}=require('./discovery.cjs');
const denied=new BlockList();
for(const [address,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied.addSubnet(address,prefix,'ipv4');
const fail=code=>{throw Error(code)};
function publicIPv4(address){return isIP(address)===4&&!denied.check(address,'ipv4')}
function transportUrl(value){
 const canonical=candidateUrl(value);if(!canonical)fail('PUBLIC_URL_DENIED');
 let path;try{path=decodeURIComponent(new URL(canonical).pathname)}catch{fail('PUBLIC_URL_DENIED')}
 if(/%|[\x00-\x1f\\]|\b(?:checkout|cart|login|signin|account|payment|oauth|authorize|redirect)\b/i.test(path))fail('PUBLIC_URL_DENIED');return canonical;
}
async function valueWithin(operation,signal){
 if(signal.aborted)fail('TASK_INTERRUPTED');let stop;
 try{const value=await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{stop=()=>reject(Error('TASK_INTERRUPTED'));signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop()})]);if(signal.aborted)fail('TASK_INTERRUPTED');return value}finally{if(stop)signal.removeEventListener('abort',stop)}
}
async function currentWithin(assertCurrent,signal){await valueWithin(assertCurrent,signal)}
function createPublicFetch({lookup=dns.lookup,request=https.request,timeoutMs=10000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)fail('PUBLIC_FETCH_INVALID');
 return async function fetchPublic(value,{kind='document',assertCurrent,signal}={}){
  const url=transportUrl(value),u=new URL(url);
  const limits={document:2000000,stylesheet:500000,image:2000000},types={document:/^text\/html(?:\s*;|$)/i,stylesheet:/^text\/css(?:\s*;|$)/i,image:/^image\/(?:png|jpeg|webp|avif)(?:\s*;|$)/i};
  if(!Object.hasOwn(limits,kind)||typeof assertCurrent!=='function')fail('PUBLIC_FETCH_INVALID');
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),timeoutMs),activeSignal=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
  async function current(){await currentWithin(assertCurrent,activeSignal)}
  try{
  await current();let addresses;
  let stop;try{addresses=await Promise.race([lookup(u.hostname,{family:4,all:true}),new Promise((_,reject)=>{stop=()=>reject(Error('PUBLIC_DNS_UNCONFIRMED'));activeSignal.addEventListener('abort',stop,{once:true});if(activeSignal.aborted)stop()})])}catch{fail('PUBLIC_DNS_UNCONFIRMED')}finally{if(stop)activeSignal.removeEventListener('abort',stop)}
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>32||addresses.some(n=>n.family!==4||!publicIPv4(n.address)))fail('PUBLIC_DNS_DENIED');
  // Pin the checked IPv4 address for the actual TLS connection. Do not resolve again.
  const address=addresses[0].address;await current();
  return await new Promise((resolve,reject)=>{
   let req,settled=false;const done=(error,result)=>{if(settled)return;settled=true;if(error)reject(Error(error));else resolve(result)};
   try{req=request(url,{method:'GET',agent:false,family:4,autoSelectFamily:false,servername:u.hostname,rejectUnauthorized:true,signal:activeSignal,headers:{Accept:kind==='document'?'text/html':kind==='stylesheet'?'text/css':'image/png,image/jpeg,image/webp,image/avif','Accept-Encoding':'identity'},lookup:(hostname,options,callback)=>{
    if(hostname!==u.hostname)return callback(Error('PUBLIC_DNS_DENIED'));
    if(options?.all)return callback(null,[{address,family:4}]);callback(null,address,4);
   }},response=>{
    const rejectResponse=code=>{done(code);response.destroy();req?.destroy()};
    if(response.statusCode!==200)return rejectResponse('PUBLIC_RESPONSE_UNVERIFIED');
    if(!types[kind].test(response.headers['content-type']||'')||(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'))return rejectResponse('PUBLIC_CONTENT_UNSUPPORTED');
    const length=response.headers['content-length'];if(length&&(!/^\d+$/.test(length)||Number(length)>limits[kind]))return rejectResponse('PUBLIC_RESPONSE_TOO_LARGE');
    let size=0;const chunks=[];
    response.on('data',chunk=>{size+=chunk.length;if(size>limits[kind])return rejectResponse('PUBLIC_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(chunk))});
    response.on('error',()=>done('PUBLIC_REQUEST_UNCONFIRMED'));
    response.on('aborted',()=>done('PUBLIC_REQUEST_UNCONFIRMED'));
    response.on('end',async()=>{if(!response.complete)return done('PUBLIC_REQUEST_UNCONFIRMED');try{await current();done(null,{url,status:200,contentType:response.headers['content-type'],body:Buffer.concat(chunks)})}catch{done('TASK_INTERRUPTED')}});
   });req.on('error',()=>done(activeSignal.aborted?'TASK_INTERRUPTED':'PUBLIC_REQUEST_UNCONFIRMED'));req.end();}catch{done('PUBLIC_REQUEST_UNCONFIRMED')}
  });
  }finally{clearTimeout(timer)}
 };
}
module.exports={publicIPv4,transportUrl,createPublicFetch,currentWithin,valueWithin};
