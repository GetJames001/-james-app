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
  ["hosted-proof", require("../lib/routes/hosted-proof.js").page],
  ["hosted-proof-ui.js", require("../lib/routes/hosted-proof.js").page],
  ["api/health", health],
  ["api/weather", require("../lib/routes/weather.js")],
  ["api/james/routing", require("../lib/routes/routing.js")],
  ["api/james/reminders", require("../lib/routes/reminders.js")],
  ["api/james/places", require("../lib/routes/places.js")],
  ["api/james/appointments", require("../lib/routes/appointments.js")],
  ["api/google/appointments/connect", require("../lib/appointments/connect.js").connect],
  ["api/james/workbench", workbench],
  ["api/james/conversation", conversation],
  ["api/james/task-execution", require("../lib/routes/task-execution.js")],
  ["api/james/hosted-proof", require("../lib/routes/hosted-proof.js")],
  ["api/james/voice", require("../lib/routes/voice.js")],
  ["api/james/files", require("../lib/routes/files.js")],
  ["api/auth/login", login],
  ["api/auth/logout", logout],
  ["api/auth/session", session],
  ["api/council", council],
  ["api/fast", fast],
  ["api/google/callback", googleCallback],
  ["api/google/gmail/connect", require("../lib/google/gmail-connect.js").connect],
  ["api/google/gmail/messages", require("../lib/google/gmail-mail.js")],
  ["api/google/capabilities", require("../lib/google/capabilities.js")],
  ["api/google/connect", googleConnect],
  ["api/microsoft/callback", microsoftCallback],
  ["api/microsoft/connect", microsoftConnect],
  ["api/microsoft/mail", microsoftMail],
  ["api/microsoft/compose", require("../lib/routes/outlook-compose.js")],
  ["api/microsoft/triage", microsoftTriage],
  ["api/tasks", tasks],
  ["api/attention", attention],
  ["api/attention/decision", require("../lib/routes/attention-decision.js")],
  ["api/attention/scan", require("../lib/routes/attention-scan.js")],
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
  if (route === 'entrance-scenes.js' || loginPage.matchLoginPoster(route) || route === 'login-art-dark.png' || route === 'login-art-light.png' || loginPage.matchLoginScene(route)) return loginPage.artwork(req,res,route);
  if (route === "login" || route === "login.html") return loginPage(req, res);
  if (route === "" || route === "index.html") return app(req, res);
  if (route === "calendar-test.html" || route === "council-test.html") {
    req.jamesResource = { document: route };
    return app(req, res);
  }
  if (
    route.startsWith("workbench/") ||
    route === "app.js" ||
    route === "appointments-ui.js" || route === "location-context.js" || route === "reminders-ui.js" || route === "wake-listener.js" || route === "wall-display.js" ||
    route === "customer-activity-ui.js" || route === "customer-database.css" || route === "customer-database-ui.js" ||
    ["realtime-coordinator.mjs","turn-timing.mjs","voice-session.js","conversation-ui.js","conversation-runtime.js","conversation-identity.mjs","conversation-bridge.mjs"].includes(route) ||
    route === "mail-refresh.js" || route === "mail-attention.js" ||
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
