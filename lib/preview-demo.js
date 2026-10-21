"use strict";

// Preview-only synthetic mode. This must never run on Production, an unapproved
// branch, or against any real customer's data or provider integration.
const { requireAuth, privateNoStore } = require("./auth.js");
const { clientAddress } = require("./login-rate-limit.js");
const DEMO_BRANCH = "feature/customer-activity-overlay-prototype-20261020";
const attempts = new Map();

function isPreviewDemo() {
  return process.env.JAMES_DEMO_PREVIEW === "enabled" &&
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === DEMO_BRANCH &&
    /^james-demo@preview\.example\.test$/i.test(String(process.env.JAMES_AUTH_EMAIL || "")) &&
    !process.env.KV_REST_API_URL && !process.env.KV_REST_API_TOKEN;
}

// Defense in depth behind Vercel Authentication: bounded per-instance attempts.
// The production login always retains its shared Redis-based rate limiter.
// Note: serverless instances do not share this map, which is acceptable only
// because this private Preview serves fictional data and no provider writes.
function previewDemoLimit(req, email) {
  const now = Date.now();
  const key = clientAddress(req) + ":" + String(email || "").toLowerCase();
  const prior = attempts.get(key) || [];
  const recent = prior.filter(timestamp => now - timestamp < 5*60*1000);
  const limited = recent.length >= 5;
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 200) {
    for (const [name, timestamps] of attempts) {
      if (timestamps.every(time => now - time > 5*60*1000)) attempts.delete(name);
    }
    if (attempts.size > 200) attempts.delete(attempts.keys().next().value);
  }
  return { available:true, limited, retryAfterSeconds: limited ? 300 : 0 };
}

function reply(res, status, data) {
  return res.status(status).json(data);
}

function handlePreviewDemoApi(req, res, route) {
  privateNoStore(res);
  if (!requireAuth(req, res)) return;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return reply(res, 405, {ok:false,error:"METHOD_NOT_ALLOWED"});
  }

  let result;
  switch (route) {
    case "api/google/status":
      result={connected:false,status:"demo_only",calendars:[]};
      break;
    case "api/google/calendars":
      result={connected:false,calendars:[]};
      break;
    case "api/google/events":
      result={connected:false,events:[],calendars:[],complete:false,status:"demo_only"};
      break;
    case "api/microsoft/mail":
      result={connected:false,unreadCount:null,messages:[]};
      break;
    case "api/tasks":
      result={tasks:[]};
      break;
    case "api/attention":
      result={schemaVersion:1,status:"not_checked",revision:0,attentionItems:[],sourceHealth:[],needsReview:[],coverage:[]};
      break;
    default:
      return reply(res,404,{ok:false,error:"DEMO_UNAVAILABLE"});
  }
  res.setHeader("X-James-Demo-Only","fictional-no-provider-access");
  if(req.method==="HEAD")return res.status(200).end();
  return reply(res,200,result);
}

module.exports={isPreviewDemo,previewDemoLimit,handlePreviewDemoApi,DEMO_BRANCH};
