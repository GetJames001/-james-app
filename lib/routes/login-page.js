const fs = require("node:fs");
const path = require("node:path");
const { privateNoStore, requireAllowedHost } = require("../auth.js");

module.exports = async function handler(req, res) {
  privateNoStore(res);
  if (!requireAllowedHost(req, res)) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }

  const body = fs.readFileSync(path.join(process.cwd(), "login.html"), "utf8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'none'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(body);
};

// Only the two decorative welcome images are public; private app assets stay protected.
module.exports.artwork = function artwork(req, res, route) {
  privateNoStore(res);
  if (!requireAllowedHost(req, res)) return;
  const matchScene = /^login-scene-(morning|noon|evening|night)\.mp4$/.exec(route);
  if (matchScene) {
    if (!['GET','HEAD'].includes(req.method)) {res.setHeader('Allow','GET, HEAD');return res.status(405).end();}
    const bytes=fs.readFileSync(path.join(process.cwd(),'assets','scenes',matchScene[1]+'.mp4'));
    res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');res.setHeader('X-Content-Type-Options','nosniff');
    const range=req.headers?.range;
    if(range){
      const m=/^bytes=(\d*)-(\d*)$/.exec(range);let start,end;
      if(m&&(m[1]||m[2])){start=m[1]?Number(m[1]):Math.max(0,bytes.length-Number(m[2]));end=m[1]?(m[2]?Number(m[2]):bytes.length-1):bytes.length-1;}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=bytes.length||end<start){res.setHeader('Content-Range','bytes */'+bytes.length);return res.status(416).end();}
      end=Math.min(end,bytes.length-1);res.setHeader('Content-Range','bytes '+start+'-'+end+'/'+bytes.length);res.setHeader('Content-Length',end-start+1);
      return req.method==='HEAD'?res.status(206).end():res.status(206).send(bytes.subarray(start,end+1));
    }
    res.setHeader('Content-Length',bytes.length);return req.method==='HEAD'?res.status(200).end():res.status(200).send(bytes);
  }
  const files = {"login-art-dark.png":"welcome-dark.png", "login-art-light.png":"welcome-light.png"};
  if (!Object.hasOwn(files, route)) return res.status(404).end();
  if (!["GET", "HEAD"].includes(req.method)) {res.setHeader("Allow", "GET, HEAD");return res.status(405).end();}
  res.setHeader("Content-Type", "image/png");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(fs.readFileSync(path.join(process.cwd(), "assets", files[route])));
};
