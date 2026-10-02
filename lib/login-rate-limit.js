const crypto = require("node:crypto");
const net = require("node:net");

const STORE_TIMEOUT_MS = 1800;
const RATE_LIMIT_SCRIPT = `
local blocked = 0
local retry_after = 0
for index, key in ipairs(KEYS) do
  local window_ms = tonumber(ARGV[(index - 1) * 2 + 1])
  local limit = tonumber(ARGV[(index - 1) * 2 + 2])
  local count = redis.call("INCR", key)
  if count == 1 then
    redis.call("PEXPIRE", key, window_ms)
  end
  local remaining = redis.call("PTTL", key)
  if count > limit then
    blocked = 1
    if remaining > retry_after then retry_after = remaining end
  end
end
return {blocked, retry_after}
`;

const WINDOWS = [
  { scope: "client", seconds: 60, limit: 5 },
  { scope: "client", seconds: 15 * 60, limit: 25 },
  { scope: "account", seconds: 60, limit: 8 },
  { scope: "account", seconds: 15 * 60, limit: 30 },
  { scope: "global", seconds: 60, limit: 60 },
  { scope: "global", seconds: 15 * 60, limit: 300 }
];

function secretKey(value) {
  const secret = String(process.env.JAMES_SESSION_SECRET || "");
  return crypto.createHmac("sha256", secret).update(String(value)).digest("base64url");
}

function clientAddress(req) {
  const forwarded = String(req.headers?.["x-vercel-forwarded-for"] || "")
    .split(",")
    .map(value => value.trim())
    .find(value => net.isIP(value));
  if (forwarded) return forwarded;

  const direct = String(req.socket?.remoteAddress || "").trim();
  return net.isIP(direct) ? direct : "unknown";
}

function bucketId(scope, req, email) {
  if (scope === "client") return secretKey(`client:${clientAddress(req)}`);
  if (scope === "account") return secretKey(`account:${String(email).trim().toLowerCase()}`);
  return "all";
}

function rateLimitCommand(req, email) {
  const keys = WINDOWS.map(({ scope, seconds }) =>
    `james:auth:login:${scope}:${seconds}:${bucketId(scope, req, email)}`
  );
  const args = WINDOWS.flatMap(({ seconds, limit }) => [seconds * 1000, limit]);
  return ["EVAL", RATE_LIMIT_SCRIPT, String(keys.length), ...keys, ...args.map(String)];
}

async function checkLoginRateLimit(req, email, options = {}) {
  const url = String(options.url || process.env.KV_REST_API_URL || "").replace(/\/$/, "");
  const token = String(options.token || process.env.KV_REST_API_TOKEN || "");
  const fetchImpl = options.fetchImpl || fetch;
  if (!url || !token || Buffer.byteLength(String(process.env.JAMES_SESSION_SECRET || "")) < 32) {
    return { available: false, limited: false, retryAfterSeconds: 0 };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || STORE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(rateLimitCommand(req, email)),
      signal: controller.signal
    });
    if (!response.ok) return { available: false, limited: false, retryAfterSeconds: 0 };

    const payload = await response.json();
    if (!Array.isArray(payload?.result) || payload.result.length !== 2) {
      return { available: false, limited: false, retryAfterSeconds: 0 };
    }

    const limited = Number(payload.result[0]) === 1;
    const retryAfterMilliseconds = Math.max(0, Number(payload.result[1]) || 0);
    return {
      available: true,
      limited,
      retryAfterSeconds: limited ? Math.max(1, Math.ceil(retryAfterMilliseconds / 1000)) : 0
    };
  } catch {
    return { available: false, limited: false, retryAfterSeconds: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  STORE_TIMEOUT_MS,
  WINDOWS,
  checkLoginRateLimit,
  clientAddress,
  rateLimitCommand
};
