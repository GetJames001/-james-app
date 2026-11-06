'use strict';
const crypto=require('node:crypto');
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max&&!/[\x00-\x1f]/.test(value)?value.trim():null;
function validate(input,now=Date.now()){
 if(!input||Object.keys(input).sort().join('|')!=='end|location|start|timeZone|title')throw Error('APPOINTMENT_DETAILS_REQUIRED');
 const title=text(input.title,200),location=text(input.location,500),timeZone=text(input.timeZone,100);
 const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
 if(!title||!location||!timeZone||!iso(input.start)||!iso(input.end))throw Error('APPOINTMENT_DETAILS_REQUIRED');
 try{new Intl.DateTimeFormat('en-US',{timeZone});}catch{throw Error('APPOINTMENT_TIMEZONE_REQUIRED');}
 const start=Date.parse(input.start),end=Date.parse(input.end);
 if(start<=now||start>now+366*86400000||end<=start||end-start>86400000)throw Error('APPOINTMENT_TIME_REQUIRED');
 return {title,location,start:new Date(start).toISOString(),end:new Date(end).toISOString(),timeZone};
}
function createReview({secret,owner,branch,now=Date.now}){
 if(typeof secret!=='string'||secret.length<32||!owner||!branch)throw Error('REVIEW_UNAVAILABLE');
 const sign=body=>crypto.createHmac('sha256',secret).update('james-appointment-v1\n'+body).digest('base64url');
 function prepare(input){const details=validate(input,now()),nonce=crypto.randomBytes(16).toString('hex');const payload={version:1,owner:crypto.createHash('sha256').update(owner).digest('hex'),branch,expires:now()+600000,nonce,details};const body=Buffer.from(JSON.stringify(payload)).toString('base64url');return {details,reviewToken:body+'.'+sign(body),expiresAt:new Date(payload.expires).toISOString(),status:'review_required'};}
 function verify(token){
  if(typeof token!=='string'||token.length>4096)throw Error('REVIEW_EXPIRED');
  const [body,signature,...extra]=token.split('.');if(extra.length||!signature)throw Error('REVIEW_EXPIRED');
  const expected=Buffer.from(sign(body)),actual=Buffer.from(signature);if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))throw Error('REVIEW_EXPIRED');
  let payload;try{payload=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw Error('REVIEW_EXPIRED');}
  if(payload.version!==1||payload.owner!==crypto.createHash('sha256').update(owner).digest('hex')||payload.branch!==branch||!Number.isFinite(payload.expires)||payload.expires<=now()||payload.expires>now()+600000||!/^[a-f0-9]{32}$/.test(payload.nonce))throw Error('REVIEW_EXPIRED');
  return {details:validate(payload.details,now()),eventId:crypto.createHash('sha256').update(owner+'\n'+branch+'\n'+payload.nonce).digest('hex')};
 }
 return {prepare,verify};
}
module.exports={validate,createReview};
