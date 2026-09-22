const { privateNoStore } = require("../lib/auth.js");
const app = require("../lib/routes/app.js");
const health = require("../lib/routes/health.js");
const login = require("../lib/routes/login.js");
const logout = require("../lib/routes/logout.js");
const session = require("../lib/routes/session.js");

const handlers = new Map([
  ["app", app],
  ["health", health],
  ["auth/login", login],
  ["auth/logout", logout],
  ["auth/session", session]
]);

module.exports = async function handler(req, res) {
  const route = String(req.query.route || "");
  const selectedHandler = handlers.get(route);

  if (!selectedHandler) {
    privateNoStore(res);
    return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  }

  return selectedHandler(req, res);
};
