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

const exactHandlers = new Map([
  ["api/health", health],
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
  ["api/tasks", tasks]
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

  if (route === "login" || route === "login.html") return loginPage(req, res);
  if (route === "" || route === "index.html") return app(req, res);
  if (route === "calendar-test.html" || route === "council-test.html") {
    req.jamesResource = { document: route };
    return app(req, res);
  }
  if (
    route === "app.js" ||
    route === "styles.css" ||
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
