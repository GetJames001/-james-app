'use strict';
// Metadata only. No credentials, network calls or mutable authorization here.
const BRANCH_HOST='james-app-git-work-hosted-preparation-proof-20261113-james-cb7a.vercel.app';
const SCHEDULE_BRANCH='work/hosted-schedule-compatibility-20261113';
const SCHEDULE_HOST='james-app-git-work-hosted-schedule-compatibil-cd6a6c-james-cb7a.vercel.app';
function verifyPreviewMetadata({combined,statuses,head,deploymentId,immutableUrl,branchUrl,expectedBranch='work/hosted-preparation-proof-20261113'}){
 const reject=()=>{throw Error('PREVIEW_MAPPING_NOT_VERIFIED');};
 if(!['work/hosted-preparation-proof-20261113',SCHEDULE_BRANCH].includes(expectedBranch))reject();
 const expectedHost=expectedBranch===SCHEDULE_BRANCH?SCHEDULE_HOST:BRANCH_HOST;
 if(!/^[a-f0-9]{40}$/.test(head||'')||!(/^[A-Za-z0-9]{20,40}$/).test(deploymentId||''))reject();
 let immutable,branch;
 try{immutable=new URL(immutableUrl);branch=new URL(branchUrl);}catch{reject();}
 for(const url of [immutable,branch])if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.port||url.search||url.hash)reject();
 if(branch.hostname!==expectedHost||!/^james-[a-z0-9]+-james-cb7a\.vercel\.app$/.test(immutable.hostname)||immutable.hostname===branch.hostname)reject();
 // These two approval values are taken together from the signed-in deployment
 // dashboard's exact-source page. The commit status independently binds its ID.
 const expected='https://vercel.com/james-cb7a/james-app/'+deploymentId;
 if(combined?.sha!==head||!Array.isArray(combined.statuses))reject();
 const matching=combined.statuses.filter(s=>s.context==='Vercel – james-app');
 if(matching.length!==1||matching[0].state!=='success'||matching[0].target_url!==expected||!Number.isSafeInteger(matching[0].id)||!Array.isArray(statuses))reject();
 const authored=statuses.filter(s=>s.id===matching[0].id);
 if(authored.length!==1||authored[0].creator?.login!=='vercel[bot]'||authored[0].state!=='success'||authored[0].context!==matching[0].context||authored[0].target_url!==expected)reject();
 return {head,urls:immutable.origin+'/,'+branch.origin+'/'};
}
module.exports={verifyPreviewMetadata};
if(require.main===module){
 const fs=require('node:fs');
 try{
  const raw=fs.readFileSync(process.argv[2]),authored=fs.readFileSync(process.argv[3]);if(raw.length>1024*1024||authored.length>1024*1024)throw Error();
  const result=verifyPreviewMetadata({combined:JSON.parse(raw),statuses:JSON.parse(authored),head:process.env.EVENT_HEAD,deploymentId:process.env.APPROVED_DEPLOYMENT_ID,immutableUrl:process.env.APPROVED_IMMUTABLE_URL,branchUrl:process.env.BRANCH_URL,expectedBranch:process.env.PROOF_BRANCH});
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'head='+result.head+'\nurls='+result.urls+'\nauthorized=true\n');
  console.log('Exact-head Vercel status and approved dashboard deployment mapping verified.');
 }catch{console.error('PREVIEW_MAPPING_NOT_VERIFIED');process.exitCode=1;}
}
