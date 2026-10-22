'use strict';
const PRODUCTION_CALLBACK='https://www.getjames.ai/api/google/callback';

// A preview must opt in to its own registered callback. Never derive a redirect
// from a request header or fall back to production for preview authorization.
function googleRedirectUri(req, env=process.env) {
  if(env.VERCEL_ENV!=='preview')return PRODUCTION_CALLBACK;
  const configured=env.JAMES_GOOGLE_PREVIEW_CALLBACK_URL;
  const branch=env.VERCEL_BRANCH_URL;
  if(typeof configured!=='string'||typeof branch!=='string'||!branch.endsWith('.vercel.app'))throw new Error('Preview Calendar connection is not configured.');
  const expected=`https://${branch}/api/google/callback`;
  if(configured!==expected)throw new Error('Preview Calendar callback does not match this branch.');
  const url=new URL(configured);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/api/google/callback'||url.host!==branch)throw new Error('Invalid preview Calendar callback.');
  if(req.headers?.host!==url.host)throw new Error('Open the configured branch preview to connect Calendar.');
  return configured;
}
module.exports={googleRedirectUri,PRODUCTION_CALLBACK};
