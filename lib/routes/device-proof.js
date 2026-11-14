'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {requireAuth, privateNoStore, configuredIdentity} = require('../auth.js');
const {createDeviceProof, enabled} = require('../task-execution/device-proof.cjs');

const routes = new Map([
  ['device-check/', ['device-check.html','text/html']],
  ['device-check/ui.js', ['device-check-ui.js','application/javascript']],
  ['device-check/worker.js', ['device-check-worker.js','application/javascript']]
]);
function createHandler({env=process.env, authorize=requireAuth, service=()=>createDeviceProof({env,owner:configuredIdentity()})}={}) {
  return async (req,res)=>{
    privateNoStore(res);
    if (!enabled(env)) return res.status(404).json({error:'NOT_ENABLED'});
    const route=req.query?.path, api=route==='api/james/device-check';
    if (!api && !routes.has(route)) return res.status(404).end();
    const method=req.method;
    if (route==='device-check/' && authorize===requireAuth && ['GET','HEAD'].includes(method) &&
        !require('../auth.js').sessionFromRequest(req)) {
      if (!require('../auth.js').requireAllowedHost(req,res)) return;
      res.setHeader('Location','/login?device-check=1');
      return res.status(302).end();
    }
    if (!authorize(req,res,{csrf:method==='POST'})) return;
    if (Object.keys(req.query||{}).some(k=>k!=='path')) return res.status(400).json({error:'INVALID_REQUEST'});
    if (!api) {
      if (method!=='HEAD' && method!=='GET') return res.status(405).end();
      const [file,type]=routes.get(route);
      res.setHeader('Content-Type',type+'; charset=utf-8');
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'");
      res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
      if (file==='device-check-worker.js') res.setHeader('Service-Worker-Allowed','/device-check/');
      return method==='HEAD'?res.status(200).end():res.status(200).send(fs.readFileSync(path.join(process.cwd(),file),'utf8'));
    }
    try {
      const proof=service();
      if (method==='GET') return res.status(200).json(await proof.status());
      if (method!=='POST') return res.status(405).end();
      if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||'')) return res.status(415).end();
      const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
      if (!raw || Buffer.byteLength(raw)>2800) return res.status(400).end();
      let data;
      try {data=JSON.parse(raw);} catch {return res.status(400).end();}
      if (!data || typeof data!=='object' || Array.isArray(data)) return res.status(400).end();
      const fields=Object.keys(data).sort().join(',');
      if (fields==='action' && ['begin','run','stop','pending'].includes(data.action)) return res.status(200).json(await proof[data.action]());
      if (data.action==='pair' && fields==='action,endpoint') return res.status(200).json(await proof.pair(data.endpoint));
      if (['shown','opened'].includes(data.action) && fields==='action,id') return res.status(200).json(await proof.acknowledge(data.id,data.action==='opened'));
      return res.status(400).json({error:'INVALID_REQUEST'});
    } catch(e) {
      if (e.code==='INVALID_SUBSCRIPTION') return res.status(400).json({error:e.code});
      if (['WINDOW_CLOSED','DEVICE_REQUIRED','DEVICE_ALREADY_PAIRED','NOTICE_UNAVAILABLE','AGENDA_UNAVAILABLE'].includes(e.code)) return res.status(409).json({error:e.code});
      return res.status(503).json({error:'CHECK_UNAVAILABLE'});
    }
  };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
