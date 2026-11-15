const crypto = require('node:crypto');
const {requireAuth, configuredIdentity} = require('../auth.js');
const {createSnapshotStore} = require('../attention/snapshot-store.cjs');
const {createReadHandler} = require('../attention/read-endpoint.cjs');

const {boundedJson}=require('../attention/storage-response.cjs');
// Reads only saved Attention state. Does not read tokens, mail, triage or Tasks.
async function readCommand(command){
  if(command.length!==2||command[0]!=='GET'||!/^james:attention:v1:[a-f0-9]{64}$/.test(command[1]))throw new Error('READ_ONLY_COMMAND_REQUIRED');
  const response=await fetch(process.env.KV_REST_API_URL,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{Authorization:`Bearer ${process.env.KV_REST_API_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify(command)
  });
  if(!response.ok)throw new Error('STORAGE_UNAVAILABLE');
  const data=await boundedJson(response);
  if(!data||data.error||!Object.hasOwn(data,'result')||(data.result!==null&&typeof data.result!=='string'))throw new Error('INVALID_STORAGE_RESPONSE');
  return data.result;
}
const store=createSnapshotStore({command:readCommand,maxBytes:1024*1024});
function accountFor(identity){
 if(!identity)throw Error('OWNER_UNAVAILABLE');
 return 'owner:'+crypto.createHash('sha256').update(identity).digest('hex');
}
const read=createReadHandler({
  authorize:(req,res)=>requireAuth(req,res),
  resolveAccount:()=>accountFor(configuredIdentity()),
  loadSnapshot:store.load,
  now:()=>new Date().toISOString()
});
module.exports=async function handler(req,res){
  // Gateway's routing parameter is infrastructure, not a client account control.
  const query={...(req.query||{})};delete query.path;
  return read({...req,method:req.method,headers:req.headers,query},res);
};

const {sessionFromRequest}=require('../auth.js');
const {readDecisions,projectReview}=require('../attention/mail-review.cjs');
const escapeText=value=>String(value).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

// The gateway validates the host and result key before dispatch.
module.exports.savedReview=async function(req,res,key){
  res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','HEAD'].includes(req.method)){
    res.setHeader('Allow','GET, HEAD');
    return res.status(405).end();
  }
  if(!sessionFromRequest(req)){
    res.setHeader('Location','/login?review='+key);
    return res.status(302).end();
  }
  let status=200,title,details='',section='Needs Attention';
  try{
    const snapshot=await store.load(accountFor(configuredIdentity()));
    if(readDecisions(snapshot).has(key)){
      res.setHeader('X-James-Review-State','handled');
      title='You already handled this item.';
    }else{
      const item=projectReview(snapshot,{includeReceipts:true})?.items.find(candidate=>candidate.reviewKey===key);
      if(item){
        res.setHeader('X-James-Review-State','ready');
        if(item.category==='reservation'){section='Reservation receipt';res.setHeader('X-James-Review-Category','reservation');}
        title=item.subject;
        details=[item.sender,...item.reasons,item.preview].map(value=>'<p>'+escapeText(value)+'</p>').join('');
      }else{
        status=404;
        title='This saved review is no longer available.';
      }
    }
  }catch{
    status=503;
    title='James could not load this saved review. Try again.';
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>James · Saved review</title><style>body{color-scheme:dark;background:#101822;color:#eee;font:1rem/1.6 system-ui;margin:0}main{max-width:40rem;margin:auto;padding:2rem 1.25rem;overflow-wrap:anywhere}h1{font:2rem Georgia,serif}a{color:#edd19b}</style><main><p>James · '+section+'</p><h1>'+escapeText(title)+'</h1>'+details+'<a href="/">Return to Daily Briefing</a></main></html>';
  return req.method==='HEAD'?res.status(status).end():res.status(status).send(html);
};
