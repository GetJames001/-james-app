const crypto = require("node:crypto");

const SESSION_COOKIE = "__Host-james_session";
const LEGACY_SESSION_COOKIE = "james_session";
const SESSION_VERSION = "v1";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PASSWORD_SCHEME = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 310000;
const PASSWORD_BYTES = 32;
const DEFAULT_ALLOWED_HOSTS = new Set([
  "getjames.ai",
  "www.getjames.ai",
  "james-app-seven.vercel.app"
]);

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

function configuredAllowedHosts() {
  const hosts = new Set(DEFAULT_ALLOWED_HOSTS);
  for (const value of [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ...(String(process.env.JAMES_ALLOWED_HOSTS || "").split(","))
  ]) {
    const host = normalizeHost(value);
    if (host) hosts.add(host);
  }
  return hosts;
}

function normalizeHost(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text.includes(",") || /[\s/@\\]/.test(text)) return null;

  try {
    const parsed = new URL(`https://${text}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return parsed.hostname ? parsed.host : null;
  } catch {
    return null;
  }
}

function requestHost(req) {
  return normalizeHost(req.headers?.host);
}

function isAllowedHost(req) {
  const host = requestHost(req);
  return Boolean(host && configuredAllowedHosts().has(host));
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

function identityMatches(candidate) {
  const allowedIdentity = configuredIdentity();
  const normalizedCandidate = String(candidate || "").trim().toLowerCase();
  return Boolean(allowedIdentity && safeEqualText(normalizedCandidate, allowedIdentity));
}

function signSessionPayload(encodedPayload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${SESSION_VERSION}.${encodedPayload}`)
    .digest("base64url");
}

function identityVersion(identity, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`identity:${identity}`)
    .digest("base64url")
    .slice(0, 22);
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
    sub: "owner",
    idv: identityVersion(allowedIdentity, secret),
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
      payload.sub !== "owner" ||
      typeof payload.idv !== "string" ||
      !safeEqualText(payload.idv, identityVersion(allowedIdentity, secret)) ||
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

function forbidden(res) {
  return res.status(403).json({ ok: false, error: "FORBIDDEN" });
}

function requireAllowedHost(req, res) {
  if (isAllowedHost(req)) return true;
  privateNoStore(res);
  forbidden(res);
  return false;
}

function requestOrigin(req) {
  const origin = String(req.headers?.origin || "").trim();
  const host = requestHost(req);

  if (!origin || !host || !configuredAllowedHosts().has(host)) return null;

  try {
    const parsed = new URL(origin);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.host.toLowerCase() !== host ||
      parsed.origin !== origin
    ) {
      return null;
    }
    return parsed.origin;
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
  if (!requireAllowedHost(req, res)) return null;
  const session = sessionFromRequest(req, options);
  if (!session) {
    if (options.redirectToLogin) {
      res.setHeader("Location", "/login");
      res.status(302).end();
    } else {
      unauthorized(res);
    }
    return null;
  }

  if (options.csrf && !requireSameOrigin(req, res)) return null;
  req.jamesIdentity = "owner";
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

function clearLegacySessionCookie() {
  return [
    `${LEGACY_SESSION_COOKIE}=`,
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

function derivePassword(password, salt, iterations, length) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password || ""), salt, iterations, length, "sha256", (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

async function verifyPassword(password, encodedHash) {
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

    const actual = await derivePassword(password, salt, iterations, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearSessionCookie,
  clearLegacySessionCookie,
  configuredAllowedHosts,
  configuredIdentity,
  createSessionToken,
  hashPassword,
  identityMatches,
  isAllowedHost,
  privateNoStore,
  requestOrigin,
  requestHost,
  requireAuth,
  requireAllowedHost,
  requireSameOrigin,
  sessionCookie,
  sessionFromRequest,
  unauthorized,
  verifyPassword,
  verifySessionToken
};
