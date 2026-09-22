const {
  configuredIdentity,
  createSessionToken,
  privateNoStore,
  requireSameOrigin,
  sessionCookie,
  verifyPassword
} = require("../../lib/auth.js");

module.exports = async function handler(req, res) {
  privateNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (!requireSameOrigin(req, res)) return;

  const allowedIdentity = configuredIdentity();
  const passwordHash = String(process.env.JAMES_AUTH_PASSWORD_HASH || "");
  if (!allowedIdentity || !passwordHash || !process.env.JAMES_SESSION_SECRET) {
    return res.status(503).json({ ok: false, error: "AUTH_UNAVAILABLE" });
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const identityMatches = email === allowedIdentity;
  const passwordMatches = verifyPassword(password, passwordHash);

  if (!identityMatches || !passwordMatches) {
    return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });
  }

  const token = createSessionToken(email);
  res.setHeader("Set-Cookie", sessionCookie(token));
  return res.status(200).json({ ok: true });
};
