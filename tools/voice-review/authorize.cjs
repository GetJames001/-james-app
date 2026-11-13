'use strict';
const REPO='GetJames001/-james-app',BRANCH='work/voice-wake-20261113',BASE='4012695b5cdde4b5801f4d451d7ae2aefa3b40cd';
const BRANCH_URL='https://james-app-git-work-voice-wake-20261113-james-cb7a.vercel.app/';
function validate(env){
 const reject=()=>{throw Error('VOICE_REVIEW_NOT_AUTHORIZED');};
 if(env.ATTEMPT==='1')return null;
 if(!/^[2-9][0-9]*$|^1[0-9]+$/.test(env.ATTEMPT||'')||env.EVENT_REPO!==REPO||env.GITHUB_REPOSITORY!==REPO||env.EVENT_BRANCH!==BRANCH||env.EVENT_BASE!==BASE||env.EVENT_PR!=='92'||env.ACTOR!=='GetJames001'||env.TRIGGERING_ACTOR!=='GetJames001')reject();
 let approval;try{approval=JSON.parse(env.REVIEW_APPROVAL);}catch{reject();}
 if(!approval||approval.pr!==92||!(/^[a-f0-9]{40}$/).test(approval.head||'')||approval.head!==env.EVENT_HEAD||!(/^[A-Za-z0-9]{20,40}$/).test(approval.deploymentId||''))reject();
 let url;try{url=new URL(approval.immutableUrl);}catch{reject();}
 if(url.protocol!=='https:'||!/^james-[a-z0-9]+-james-cb7a\.vercel\.app$/.test(url.hostname)||url.pathname!=='/'||url.username||url.password||url.port||url.search||url.hash)reject();
 return {...approval,immutableUrl:url.origin+'/'};
}
function verify(env,{pr,combined,statuses}){
 const approval=validate(env);if(!approval)throw Error('VOICE_REVIEW_NOT_AUTHORIZED');
 const reject=()=>{throw Error('VOICE_PREVIEW_MAPPING_NOT_VERIFIED');};
 if(pr?.number!==92||pr.state!=='open'||pr.head?.sha!==approval.head||pr.head?.ref!==BRANCH||pr.head?.repo?.full_name!==REPO||pr.base?.sha!==BASE)reject();
 if(combined?.sha!==approval.head||!Array.isArray(combined.statuses)||!Array.isArray(statuses))reject();
 const matching=combined.statuses.filter(s=>s.context==='Vercel – james-app');
 const expected='https://vercel.com/james-cb7a/james-app/'+approval.deploymentId;
 if(matching.length!==1||matching[0].state!=='success'||matching[0].target_url!==expected||!Number.isSafeInteger(matching[0].id))reject();
 const authored=statuses.filter(s=>s.id===matching[0].id);
 if(authored.length!==1||authored[0].creator?.login!=='vercel[bot]'||authored[0].state!=='success'||authored[0].context!==matching[0].context||authored[0].target_url!==expected)reject();
 return {head:approval.head,urls:approval.immutableUrl+','+BRANCH_URL};
}
module.exports={validate,verify};
if(require.main===module){
 const fs=require('node:fs');
 try{
  if(process.argv[2]==='validate'){if(!validate(process.env))throw Error('VOICE_REVIEW_NOT_AUTHORIZED');}
  else{
   const read=p=>{const raw=fs.readFileSync(p);if(raw.length>1024*1024)throw Error();return JSON.parse(raw);};
   const result=verify(process.env,{pr:read(process.argv[2]),combined:read(process.argv[3]),statuses:read(process.argv[4])});
   fs.appendFileSync(process.env.GITHUB_OUTPUT,'head='+result.head+'\nurls='+result.urls+'\nauthorized=true\n');
   console.log('Reviewed voice head and Vercel-authored deployment mapping verified.');
  }
 }catch{console.error('VOICE_REVIEW_NOT_AUTHORIZED_OR_PREVIEW_NOT_VERIFIED');process.exitCode=1;}
}
