'use strict';
const crypto = require('node:crypto');
async function inspect(env, fetcher = fetch) {
  const secret = env.JAMES_SESSION_SECRET || '';
  const url = env.KV_REST_API_URL || '';
  const token = env.KV_REST_API_TOKEN || '';
  const result = { sessionSecretValid: Buffer.byteLength(secret) >= 32, authEmailPresent: !!env.JAMES_AUTH_EMAIL, passwordHashPresent: !!env.JAMES_AUTH_PASSWORD_HASH, dbUrlPresent: !!url, dbTokenPresent: !!token, dbCheck: 'not_run' };
  if (!url || !token) return result;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const key = 'james:qa:diagnostic:' + crypto.randomBytes(12).toString('hex');
    const script = "redis.call('SET',KEYS[1],'1','EX',10); redis.call('DEL',KEYS[1]); return {0,0}";
    const response = await fetcher(url.replace(/\/$/, ''), {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(['EVAL',script,'1',key]),signal:controller.signal});
    if (!response.ok) result.dbCheck = 'http_' + response.status;
    else { const data = await response.json(); result.dbCheck = Array.isArray(data.result) && data.result.length === 2 ? 'pass' : 'unexpected_response'; }
  } catch (e) { result.dbCheck = e.name === 'AbortError' ? 'timeout' : 'connection_error'; }
  finally { clearTimeout(timer); }
  return result;
}
module.exports = async function(req,res){res.setHeader('Cache-Control','no-store'); const host=String(process.env.VERCEL_URL||''); if(!host.startsWith('james-isolated-qa-1bd8f93-') || process.env.VERCEL_ENV!=='preview') return res.status(404).end(); if(req.method!=='GET') return res.status(405).end(); return res.status(200).json(await inspect(process.env)); };
