const {
  configuredIdentity,
  createSessionToken,
  identityMatches,
  privateNoStore,
  requireAllowedHost,
  requireSameOrigin,
  sessionCookie,
  verifyPassword
} = require("../auth.js");
const { checkLoginRateLimit } = require("../login-rate-limit.js");

const MAX_BODY_BYTES = 4096;
const MAX_EMAIL_BYTES = 254;
const MAX_PASSWORD_BYTES = 512;

function parseCredentials(req) {
  const declaredLength = Number(req.headers?.["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;

  let body = req.body;
  if (Buffer.isBuffer(body)) {
    if (body.length > MAX_BODY_BYTES) return null;
    body = body.toString("utf8");
  }
  if (typeof body === "string") {
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return null;
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) return null;
  } catch {
    return null;
  }

  const { email, password } = body;
  if (typeof email !== "string" || typeof password !== "string") return null;
  if (
    Buffer.byteLength(email, "utf8") > MAX_EMAIL_BYTES ||
    Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES
  ) {
    return null;
  }

  return { email: email.trim().toLowerCase(), password };
}

module.exports = async function handler(req, res) {
  privateNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (!requireAllowedHost(req, res)) return;
  if (!requireSameOrigin(req, res)) return;

  const credentials = parseCredentials(req);
  const emailForLimit = credentials?.email || "invalid";

  const rateLimit = await checkLoginRateLimit(req, emailForLimit);
  if (!rateLimit.available) {
    return res.status(503).json({ ok: false, error: "AUTH_UNAVAILABLE" });
  }
  if (rateLimit.limited) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    return res.status(429).json({ ok: false, error: "TOO_MANY_REQUESTS" });
  }
  if (!credentials) {
    return res.status(400).json({ ok: false, error: "INVALID_REQUEST" });
  }

  const allowedIdentity = configuredIdentity();
  const passwordHash = String(process.env.JAMES_AUTH_PASSWORD_HASH || "");
  if (!allowedIdentity || !passwordHash || !process.env.JAMES_SESSION_SECRET) {
    return res.status(503).json({ ok: false, error: "AUTH_UNAVAILABLE" });
  }

  const { email, password } = credentials;
  const allowedIdentityMatches = identityMatches(email);
  const passwordMatches = await verifyPassword(password, passwordHash);

  if (!allowedIdentityMatches || !passwordMatches) {
    return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });
  }

  const token = createSessionToken(email);
  res.setHeader("Set-Cookie", sessionCookie(token));
  return res.status(200).json({ ok: true });
};

module.exports.parseCredentials = parseCredentials;
module.exports.MAX_BODY_BYTES = MAX_BODY_BYTES;
module.exports.MAX_EMAIL_BYTES = MAX_EMAIL_BYTES;
module.exports.MAX_PASSWORD_BYTES = MAX_PASSWORD_BYTES;
