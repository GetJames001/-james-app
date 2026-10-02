const assert = require("node:assert/strict");
const test = require("node:test");

const auth = require("../lib/auth.js");
const limiter = require("../lib/login-rate-limit.js");
const login = require("../lib/routes/login.js");

process.env.JAMES_AUTH_EMAIL = "private@example.com";
process.env.JAMES_SESSION_SECRET = "rate-limit-test-secret-at-least-thirty-two-bytes";
process.env.JAMES_AUTH_PASSWORD_HASH = auth.hashPassword("test password", { salt: Buffer.alloc(16, 3) });
process.env.KV_REST_API_URL = "https://rate-limit.example.test";
process.env.KV_REST_API_TOKEN = "test-token";

function request(body, ip = "203.0.113.10", headers = {}) {
  return {
    method: "POST",
    body,
    headers: {
      host: "www.getjames.ai",
      origin: "https://www.getjames.ai",
      "x-vercel-forwarded-for": ip,
      ...headers
    }
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

function inMemoryRedis() {
  let now = 0;
  const buckets = new Map();
  const fetchImpl = async (_url, options) => {
    const command = JSON.parse(options.body);
    const keyCount = Number(command[2]);
    const keys = command.slice(3, 3 + keyCount);
    const args = command.slice(3 + keyCount).map(Number);
    let blocked = 0;
    let retryAfter = 0;

    keys.forEach((key, index) => {
      const windowMs = args[index * 2];
      const limit = args[index * 2 + 1];
      let bucket = buckets.get(key);
      if (!bucket || bucket.expiresAt <= now) bucket = { count: 0, expiresAt: now + windowMs };
      bucket.count += 1;
      buckets.set(key, bucket);
      if (bucket.count > limit) {
        blocked = 1;
        retryAfter = Math.max(retryAfter, bucket.expiresAt - now);
      }
    });

    return { ok: true, async json() { return { result: [blocked, retryAfter] }; } };
  };

  return { fetchImpl, advance(milliseconds) { now += milliseconds; } };
}

test("per-client short-window threshold is shared across handler instances and resets", async () => {
  const store = inMemoryRedis();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await limiter.checkLoginRateLimit(request({}, "203.0.113.11"), "a@example.com", { fetchImpl: store.fetchImpl });
    assert.equal(result.limited, false, `attempt ${attempt}`);
  }
  let result = await limiter.checkLoginRateLimit(request({}, "203.0.113.11"), "a@example.com", { fetchImpl: store.fetchImpl });
  assert.equal(result.limited, true);
  assert.ok(result.retryAfterSeconds > 0);

  store.advance(61_000);
  result = await limiter.checkLoginRateLimit(request({}, "203.0.113.11"), "a@example.com", { fetchImpl: store.fetchImpl });
  assert.equal(result.limited, false);
});

test("account and global limits stop distributed abuse", async () => {
  let store = inMemoryRedis();
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const result = await limiter.checkLoginRateLimit(request({}, `203.0.113.${attempt}`), "target@example.com", { fetchImpl: store.fetchImpl });
    assert.equal(result.limited, false, `account attempt ${attempt}`);
  }
  let result = await limiter.checkLoginRateLimit(request({}, "203.0.113.99"), "target@example.com", { fetchImpl: store.fetchImpl });
  assert.equal(result.limited, true, "distributed account attempts must share one bucket");

  store = inMemoryRedis();
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const ip = `2001:db8::${attempt.toString(16)}`;
    const current = await limiter.checkLoginRateLimit(request({}, ip), `person-${attempt}@example.com`, { fetchImpl: store.fetchImpl });
    assert.equal(current.limited, false, `global attempt ${attempt}`);
  }
  result = await limiter.checkLoginRateLimit(request({}, "2001:db8::ffff"), "another@example.com", { fetchImpl: store.fetchImpl });
  assert.equal(result.limited, true, "global attempts must share one bucket");
});

test("sustained client limit survives short-window resets and then expires", async () => {
  const store = inMemoryRedis();
  for (let group = 0; group < 5; group += 1) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await limiter.checkLoginRateLimit(request({}, "203.0.113.77"), `account-${group}-${attempt}@example.com`, { fetchImpl: store.fetchImpl });
      assert.equal(result.limited, false);
    }
    if (group < 4) store.advance(61_000);
  }

  let result = await limiter.checkLoginRateLimit(request({}, "203.0.113.77"), "last@example.com", { fetchImpl: store.fetchImpl });
  assert.equal(result.limited, true, "the 26th attempt must hit the 15-minute client limit");

  store.advance(901_000);
  result = await limiter.checkLoginRateLimit(request({}, "203.0.113.77"), "reset@example.com", { fetchImpl: store.fetchImpl });
  assert.equal(result.limited, false);
});

test("limiter includes short and sustained client, account, and global windows", () => {
  assert.deepEqual(limiter.WINDOWS, [
    { scope: "client", seconds: 60, limit: 5 },
    { scope: "client", seconds: 900, limit: 25 },
    { scope: "account", seconds: 60, limit: 8 },
    { scope: "account", seconds: 900, limit: 30 },
    { scope: "global", seconds: 60, limit: 60 },
    { scope: "global", seconds: 900, limit: 300 }
  ]);
});

test("login fails closed when the distributed store is unavailable", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("store offline"); };
  try {
    const res = response();
    await login(request({ email: process.env.JAMES_AUTH_EMAIL, password: "test password" }), res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { ok: false, error: "AUTH_UNAVAILABLE" });
    assert.match(String(res.headers["Cache-Control"]), /no-store/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("malformed and oversized login input is rejected before password work", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, async json() { return { result: [0, 0] }; } });
  try {
    for (const req of [
      request("not-json"),
      request({ email: "private@example.com" }),
      request({ email: "a".repeat(255), password: "x" }),
      request({ email: "private@example.com", password: "x".repeat(513) }),
      request({ email: "private@example.com", password: "x", padding: "x".repeat(4096) }),
      request({ email: "private@example.com", password: "x" }, "203.0.113.50", { "content-length": "4097" })
    ]) {
      const res = response();
      await login(req, res);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { ok: false, error: "INVALID_REQUEST" });
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("rate-limited login responses are generic and do no password work", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, async json() { return { result: [1, 45_000] }; } });
  try {
    const res = response();
    await login(request({ email: process.env.JAMES_AUTH_EMAIL, password: "test password" }), res);
    assert.equal(res.statusCode, 429);
    assert.deepEqual(res.body, { ok: false, error: "TOO_MANY_REQUESTS" });
    assert.equal(res.headers["Retry-After"], "45");
  } finally {
    global.fetch = originalFetch;
  }
});
