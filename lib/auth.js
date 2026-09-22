const crypto = require("node:crypto");

const SESSION_COOKIE = "james_session";
const SESSION_VERSION = "v1";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PASSWORD_SCHEME = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 310000;
const PASSWORD_BYTES = 32;

function privateNoStore(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Vary", "Cookie");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function parseCookies(req) {
  const header = String(req.headers?.cookie || "");
  const cookies = {};

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = value;
  }

  return cookies;
}

function configuredIdentity() {
  return String(process.env.JAMES_AUTH_EMAIL || "").trim().toLowerCase();
}

function sessionSecret() {
  const secret = String(process.env.JAMES_SESSION_SECRET || "");
  return Buffer.byteLength(secret, "utf8") >= 32 ? secret : null;
}

function safeEqualText(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left)).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function signSessionPayload(encodedPayload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${SESSION_VERSION}.${encodedPayload}`)
    .digest("base64url");
}

function createSessionToken(email, options = {}) {
  const allowedIdentity = configuredIdentity();
  const secret = sessionSecret();
  const subject = String(email || "").trim().toLowerCase();

  if (!allowedIdentity || !secret || !safeEqualText(subject, allowedIdentity)) {
    throw new Error("James authentication is not configured.");
  }

  const now = Number.isFinite(options.now) ? options.now : Math.floor(Date.now() / 1000);
  const ttl = Number.isFinite(options.ttl) ? options.ttl : SESSION_TTL_SECONDS;
  const payload = {
    sub: allowedIdentity,
    iat: now,
    exp: now + ttl,
    jti: crypto.randomBytes(16).toString("base64url")
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signSessionPayload(encodedPayload, secret);

  return `${SESSION_VERSION}.${encodedPayload}.${signature}`;
}

function verifySessionToken(token, options = {}) {
  try {
    const allowedIdentity = configuredIdentity();
    const secret = sessionSecret();
    if (!allowedIdentity || !secret || typeof token !== "string") return null;

    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== SESSION_VERSION) return null;

    const expected = signSessionPayload(parts[1], secret);
    if (parts[2].length !== expected.length || !safeEqualText(parts[2], expected)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const now = Number.isFinite(options.now) ? options.now : Math.floor(Date.now() / 1000);

    if (
      !payload ||
      typeof payload.sub !== "string" ||
      !safeEqualText(payload.sub.toLowerCase(), allowedIdentity) ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.iat > now + 60 ||
      payload.exp <= now ||
      payload.exp - payload.iat > SESSION_TTL_SECONDS
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function sessionFromRequest(req, options = {}) {
  return verifySessionToken(parseCookies(req)[SESSION_COOKIE], options);
}

function unauthorized(res) {
  return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
}

function requestOrigin(req) {
  const origin = String(req.headers?.origin || "");
  const forwardedHost = String(req.headers?.["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(req.headers?.host || "").trim();
  const forwardedProto = String(req.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");

  if (!origin || !host) return null;

  try {
    const parsed = new URL(origin);
    return parsed.origin === `${protocol}://${host}` ? parsed.origin : null;
  } catch {
    return null;
  }
}

function requireSameOrigin(req, res) {
  if (requestOrigin(req)) return true;
  res.status(403).json({ ok: false, error: "FORBIDDEN" });
  return false;
}

function requireAuth(req, res, options = {}) {
  privateNoStore(res);
  const session = sessionFromRequest(req, options);
  if (!session) {
    unauthorized(res);
    return null;
  }

  if (options.csrf && !requireSameOrigin(req, res)) return null;
  req.jamesIdentity = session.sub;
  return session;
}

function sessionCookie(token) {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "Priority=High"
  ].join("; ");
}

function clearSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0",
    "Priority=High"
  ].join("; ");
}

function hashPassword(password, options = {}) {
  const iterations = options.iterations || PASSWORD_ITERATIONS;
  const salt = options.salt || crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(
    String(password),
    salt,
    iterations,
    PASSWORD_BYTES,
    "sha256"
  );
  return `${PASSWORD_SCHEME}$${iterations}$${Buffer.from(salt).toString("base64url")}$${digest.toString("base64url")}`;
}

function verifyPassword(password, encodedHash) {
  try {
    const [scheme, iterationText, saltText, digestText] = String(encodedHash || "").split("$");
    const iterations = Number(iterationText);
    if (
      scheme !== PASSWORD_SCHEME ||
      !Number.isInteger(iterations) ||
      iterations < PASSWORD_ITERATIONS ||
      iterations > 1000000
    ) {
      return false;
    }

    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(digestText, "base64url");
    if (salt.length < 16 || expected.length !== PASSWORD_BYTES) return false;

    const actual = crypto.pbkdf2Sync(
      String(password || ""),
      salt,
      iterations,
      expected.length,
      "sha256"
    );
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearSessionCookie,
  configuredIdentity,
  createSessionToken,
  hashPassword,
  privateNoStore,
  requestOrigin,
  requireAuth,
  requireSameOrigin,
  sessionCookie,
  sessionFromRequest,
  unauthorized,
  verifyPassword,
  verifySessionToken
};
