const { privateNoStore, requireAllowedHost, requireAuth } = require("../lib/auth.js");
const app = require("../lib/routes/app.js");
const health = require("../lib/routes/health.js");
const loginPage = require("../lib/routes/login-page.js");
const login = require("../lib/routes/login.js");
const logout = require("../lib/routes/logout.js");
const session = require("../lib/routes/session.js");
const council = require("./council.js");
const fast = require("./fast.js");
const google = require("./google/[action].js");
const googleCallback = require("./google/callback.js");
const googleConnect = require("./google/connect.js");
const microsoftCallback = require("./microsoft/callback.js");
const microsoftConnect = require("./microsoft/connect.js");
const microsoftMail = require("./microsoft/mail.js");
const microsoftTriage = require("./microsoft/triage.js");
const tasks = require("./tasks.js");
const customerActivity = require("../lib/routes/customer-activity.js");
const attention = require("../lib/routes/attention.js");
const workbench = require('../lib/routes/workbench.js');
const conversation = require("../lib/routes/conversation.js");

const exactHandlers = new Map([
  ["api/health", health],
  ["api/james/workbench", workbench],
  ["api/james/conversation", conversation],
  ["api/auth/login", login],
  ["api/auth/logout", logout],
  ["api/auth/session", session],
  ["api/council", council],
  ["api/fast", fast],
  ["api/google/callback", googleCallback],
  ["api/google/connect", googleConnect],
  ["api/microsoft/callback", microsoftCallback],
  ["api/microsoft/connect", microsoftConnect],
  ["api/microsoft/mail", microsoftMail],
  ["api/microsoft/triage", microsoftTriage],
  ["api/tasks", tasks],
  ["api/attention", attention],
  ["api/customer-activity", customerActivity],
  ["api/customer-database", require("../lib/routes/customer-database.js")]
]);

function requestedPath(req) {
  const value = req.query?.path;
  if (Array.isArray(value) || typeof value !== "string") return null;
  return value.replace(/^\/+/, "");
}

module.exports = async function handler(req, res) {
  // Constant, non-sensitive marker used to distinguish this application
  // boundary from Vercel Authentication or another upstream response.
  res.setHeader("X-Application-Gateway", "enforced");
  privateNoStore(res);
  if (!requireAllowedHost(req, res)) return;

  const route = requestedPath(req);
  if (route === null || route.includes("\0") || route.length > 2048) {
    return res.status(400).json({ ok: false, error: "INVALID_REQUEST" });
  }

  // Protected Vercel Preview only: self-contained fictional interface.
  // Never exposed by production and never reads a real auth/session/provider.
  if(route === "customer-demo" || route === "customer-demo.html"){
    const permitted = process.env.VERCEL_ENV === "preview" &&
      process.env.VERCEL_GIT_COMMIT_REF === "feature/customer-activity-overlay-prototype-20261020" &&
      (req.method === "GET" || req.method === "HEAD");
    if(!permitted) return res.status(404).json({ok:false,error:"NOT_FOUND"});
    const fs=require("node:fs"),path=require("node:path");
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader("X-Robots-Tag","noindex, nofollow, noarchive");
    res.setHeader("X-James-Demo-Only","synthetic");
    if(req.method === "HEAD")return res.status(200).end();
    return res.status(200).send(fs.readFileSync(path.join(process.cwd(),"customer-demo.html"),"utf8"));
  }
  // A branch-scoped preview cannot use the production-only James login.
  // Redirect its landing page to fictional review, never affecting production.
  if ((route === "" || route === "index.html" || route === "login" || route === "login.html") &&
      process.env.VERCEL_ENV === "preview" &&
      process.env.VERCEL_GIT_COMMIT_REF === "feature/customer-activity-overlay-prototype-20261020" &&
      (req.method === "GET" || req.method === "HEAD")) {
    res.setHeader("Location", "/customer-demo");
    return res.status(302).end();
  }
  if (route === "login-art-dark.png" || route === "login-art-light.png") return loginPage.artwork(req, res, route);
  if (route === "login" || route === "login.html") return loginPage(req, res);
  if (route === "" || route === "index.html") return app(req, res);
  if (route === "calendar-test.html" || route === "council-test.html") {
    req.jamesResource = { document: route };
    return app(req, res);
  }
  if (
    route.startsWith("workbench/") ||
    route === "app.js" ||
    ["conversation-ui.js","conversation-runtime.js","conversation-identity.mjs","conversation-bridge.mjs"].includes(route) ||
    route === "mail-refresh.js" ||
    route === "calendar-sync.js" ||
    route === "styles.css" ||
    route === "welcome.css" ||
    route === "welcome.js" ||
    route === "james-orb-v1.png" ||
    route.startsWith("assets/")
  ) {
    req.jamesResource = { asset: route };
    return app(req, res);
  }

  const exactHandler = exactHandlers.get(route);
  if (exactHandler) return exactHandler(req, res);

  const googleMatch = /^api\/google\/(status|calendars|events)$/.exec(route);
  if (googleMatch) {
    req.query.action = googleMatch[1];
    return google(req, res);
  }

  const authenticated = requireAuth(req, res);
  if (!authenticated) return;
  return res.status(404).json({ ok: false, error: "NOT_FOUND" });
};

module.exports.requestedPath = requestedPath;
