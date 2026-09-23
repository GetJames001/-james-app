const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const auth = require("../lib/auth.js");
const root = path.join(__dirname, "..");

process.env.JAMES_AUTH_EMAIL = "michael@example.com";
process.env.JAMES_SESSION_SECRET = "test-session-secret-that-is-at-least-thirty-two-bytes";
process.env.JAMES_AUTH_PASSWORD_HASH = auth.hashPassword("correct horse battery staple", {
  salt: Buffer.alloc(16, 7)
});
process.env.KV_REST_API_URL = "https://rate-limit.example.test";
process.env.KV_REST_API_TOKEN = "test-rate-limit-token";

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end(value) { this.body = value ?? this.body; return this; },
    redirect(status, location) {
      this.statusCode = status;
      this.headers.Location = location;
      return this;
    }
  };
}

function request(method = "GET", options = {}) {
  const headers = { host: "www.getjames.ai", ...(options.headers || {}) };
  if (options.authorized) {
    const token = auth.createSessionToken(process.env.JAMES_AUTH_EMAIL, options.sessionOptions);
    headers.cookie = `${auth.SESSION_COOKIE}=${token}`;
  }
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.host) headers.host = options.host;
  if (options.forwardedHost) headers["x-forwarded-host"] = options.forwardedHost;
  if (options.forwardedProto) headers["x-forwarded-proto"] = options.forwardedProto;

  const req = {
    method,
    headers,
    body: options.body || {},
    query: options.query || {}
  };
  if (options.resource) req.jamesResource = options.resource;
  if (options.socket) req.socket = options.socket;
  return req;
}

async function withAllowedRateLimit(callback) {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() { return { result: [0, 0] }; }
  });
  try {
    return await callback();
  } finally {
    global.fetch = originalFetch;
  }
}

const protectedEndpoints = [
  ["/api/health", require("../lib/routes/health.js"), request("GET")],
  ["/api/tasks", require("../api/tasks.js"), request("GET")],
  ["/api/fast", require("../api/fast.js"), request("POST")],
  ["/api/council", require("../api/council.js"), request("POST")],
  ["/api/google/status", require("../api/google/[action].js"), request("GET", { query: { action: "status" } })],
  ["/api/google/_status", require("../api/google/[action].js"), request("GET", { query: { action: "_status" } })],
  ["/api/google/_calendars", require("../api/google/[action].js"), request("GET", { query: { action: "_calendars" } })],
  ["/api/google/_events", require("../api/google/[action].js"), request("GET", { query: { action: "_events" } })],
  ["/api/google/connect", require("../api/google/connect.js"), request("GET")],
  ["/api/microsoft/mail", require("../api/microsoft/mail.js"), request("GET")],
  ["/api/microsoft/triage", require("../api/microsoft/triage.js"), request("POST")],
  ["/api/microsoft/connect", require("../api/microsoft/connect.js"), request("GET")],
  ["/api/auth/session", require("../lib/routes/session.js"), request("GET")],
  ["/api/auth/logout", require("../lib/routes/logout.js"), request("POST", {
    origin: "https://www.getjames.ai"
  })]
];

test("every private API rejects an unauthenticated direct request without metadata", async () => {
  for (const [route, handler, req] of protectedEndpoints) {
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401, route);
    assert.deepEqual(res.body, { ok: false, error: "UNAUTHORIZED" }, route);
    assert.match(String(res.headers["Cache-Control"]), /private/);
    assert.match(String(res.headers["Cache-Control"]), /no-store/);
  }
});

test("deployed gateway routes preserve the same authentication boundary", async () => {
  const router = require("../api/gateway.js");

  for (const route of ["api/health", "api/auth/session", "api/auth/logout"]) {
    const res = mockRes();
    await router(request(route.endsWith("logout") ? "POST" : "GET", {
      origin: route.endsWith("logout") ? "https://www.getjames.ai" : undefined,
      query: { path: route }
    }), res);
    assert.equal(res.headers["X-Application-Gateway"], "enforced", route);
    assert.equal(res.statusCode, 401, route);
    assert.deepEqual(res.body, { ok: false, error: "UNAUTHORIZED" });
    assert.match(String(res.headers["Cache-Control"]), /private/);
    assert.match(String(res.headers["Cache-Control"]), /no-store/);
  }
});

test("API inventory explicitly classifies every deployed function within the Hobby limit", () => {
  const apiFiles = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.endsWith(".js")) apiFiles.push(path.relative(root, absolute));
    }
  }
  walk(path.join(root, "api"));

  const publicFunctions = new Set([
    "api/google/callback.js",
    "api/microsoft/callback.js"
  ]);
  const mixedFunctions = new Set(["api/gateway.js"]);
  const expectedProtected = new Set([
    "api/council.js",
    "api/fast.js",
    "api/google/[action].js",
    "api/google/connect.js",
    "api/microsoft/connect.js",
    "api/microsoft/mail.js",
    "api/microsoft/triage.js",
    "api/tasks.js"
  ]);

  assert.deepEqual(
    new Set(apiFiles),
    new Set([...publicFunctions, ...mixedFunctions, ...expectedProtected])
  );
  assert.ok(apiFiles.length <= 12, `Vercel Hobby function limit exceeded: ${apiFiles.length}`);
  for (const file of expectedProtected) {
    assert.match(fs.readFileSync(path.join(root, file), "utf8"), /requireAuth|sessionFromRequest/);
  }
  assert.match(fs.readFileSync(path.join(root, "api/gateway.js"), "utf8"), /auth\/login/);
});

test("Vercel routes send every normalized path through the fail-closed gateway", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.deepEqual(config.routes, [{
    src: "^/(.*)$",
    dest: "/api/gateway?path=$1"
  }]);
  assert.equal(config.routes.some(route => route.handle === "filesystem"), false);
});

test("forged, expired, future, malformed, and wrong-identity sessions fail closed", () => {
  const now = 2000000000;
  const valid = auth.createSessionToken(process.env.JAMES_AUTH_EMAIL, { now });
  assert.equal(auth.verifySessionToken(valid, { now }).sub, "owner");
  const publicPayload = JSON.parse(Buffer.from(valid.split(".")[1], "base64url").toString("utf8"));
  assert.equal(publicPayload.sub, "owner");
  assert.doesNotMatch(JSON.stringify(publicPayload), /michael|example/i);

  const forged = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
  assert.equal(auth.verifySessionToken(forged, { now }), null);
  assert.equal(auth.verifySessionToken("not-a-session", { now }), null);

  const expired = auth.createSessionToken(process.env.JAMES_AUTH_EMAIL, { now: now - 100, ttl: 50 });
  assert.equal(auth.verifySessionToken(expired, { now }), null);

  const future = auth.createSessionToken(process.env.JAMES_AUTH_EMAIL, { now: now + 120, ttl: 100 });
  assert.equal(auth.verifySessionToken(future, { now }), null);

  const originalIdentity = process.env.JAMES_AUTH_EMAIL;
  process.env.JAMES_AUTH_EMAIL = "someone-else@example.com";
  assert.equal(auth.verifySessionToken(valid, { now }), null);
  process.env.JAMES_AUTH_EMAIL = originalIdentity;
});

test("login is same-origin only and issues a hardened session cookie", async () => {
  const login = require("../lib/routes/login.js");

  let res = mockRes();
  await login(request("POST", {
    host: "www.getjames.ai",
    origin: "https://attacker.example",
    body: { email: process.env.JAMES_AUTH_EMAIL, password: "correct horse battery staple" }
  }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers["Set-Cookie"], undefined);

  res = mockRes();
  await withAllowedRateLimit(() => login(request("POST", {
    host: "www.getjames.ai",
    origin: "https://www.getjames.ai",
    body: { email: process.env.JAMES_AUTH_EMAIL, password: "correct horse battery staple" }
  }), res));
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Set-Cookie"], /^__Host-james_session=/);
  assert.match(res.headers["Set-Cookie"], /HttpOnly/);
  assert.match(res.headers["Set-Cookie"], /Secure/);
  assert.match(res.headers["Set-Cookie"], /SameSite=Strict/);
  assert.match(res.headers["Set-Cookie"], /Max-Age=28800/);
});

test("all mutating endpoints reject a valid session from a cross-site origin", async () => {
  const mutations = [
    ["tasks", require("../api/tasks.js"), { tasks: [] }, {}],
    ["mail", require("../api/microsoft/mail.js"), { messageId: "1", replyText: "test" }, { account: "personal" }],
    ["fast", require("../api/fast.js"), { question: "test" }, {}],
    ["council", require("../api/council.js"), { question: "test" }, {}],
    ["triage", require("../api/microsoft/triage.js"), { messages: [{ id: "1" }] }, {}],
    ["logout", require("../lib/routes/logout.js"), {}, {}]
  ];

  for (const [name, handler, body, query] of mutations) {
    const res = mockRes();
    await handler(request("POST", {
      authorized: true,
      host: "www.getjames.ai",
      origin: "https://attacker.example",
      body,
      query
    }), res);
    assert.equal(res.statusCode, 403, name);
    assert.deepEqual(res.body, { ok: false, error: "FORBIDDEN" }, name);
    if (name === "logout") {
      assert.equal(res.headers["Set-Cookie"], undefined, "cross-site logout must not clear cookies");
    }
  }
});

test("authorized requests preserve app, session, health, and stored Tasks behavior", async () => {
  const sameOrigin = {
    authorized: true,
    host: "www.getjames.ai",
    origin: "https://www.getjames.ai"
  };

  let res = mockRes();
  await require("../lib/routes/session.js")(request("GET", sameOrigin), res);
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.expiresAt, "number");
  assert.equal(Object.hasOwn(res.body, "identity"), false);

  res = mockRes();
  await require("../lib/routes/health.js")(request("GET", sameOrigin), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.service, "james-live-council");

  res = mockRes();
  await require("../lib/routes/app.js")(request("GET", sameOrigin), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Your Morning Briefing/);

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return { result: JSON.stringify([{ id: "existing", title: "Preserved task" }]) };
    }
  });
  try {
    res = mockRes();
    await require("../api/tasks.js")(request("GET", sameOrigin), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.tasks, [{ id: "existing", title: "Preserved task" }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("the application shell redirects unauthenticated visitors to the login page", async () => {
  const res = mockRes();
  await require("../lib/routes/app.js")(request("GET", {
    host: "www.getjames.ai",
    origin: "https://www.getjames.ai"
  }), res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, "/login");
  assert.match(String(res.headers["Cache-Control"]), /private/);
  assert.match(String(res.headers["Cache-Control"]), /no-store/);
});

test("fixture-bearing application JavaScript is not exposed without a session", async () => {
  const app = require("../lib/routes/app.js");
  let res = mockRes();
  await app(request("GET", {
    host: "www.getjames.ai",
    origin: "https://www.getjames.ai",
    query: {},
    resource: { asset: "app.js" }
  }), res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: "UNAUTHORIZED" });
  assert.doesNotMatch(JSON.stringify(res.body), /Scott Schuster/);

  res = mockRes();
  await app(request("GET", {
    authorized: true,
    host: "www.getjames.ai",
    origin: "https://www.getjames.ai",
    query: {},
    resource: { asset: "app.js" }
  }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /text\/javascript/);
  assert.match(res.body, /loadPersonalMicrosoftMail/);
});

test("authorization accepts only configured production and exact deployment hosts", async () => {
  const session = require("../lib/routes/session.js");
  process.env.VERCEL_URL = "james-production-id.vercel.app";
  for (const host of [
    "www.getjames.ai",
    "getjames.ai",
    "james-production-id.vercel.app",
    "james-app-seven.vercel.app"
  ]) {
    const res = mockRes();
    await session(request("GET", {
      authorized: true,
      host,
      origin: `https://${host}`
    }), res);
    assert.equal(res.statusCode, 200, host);
  }
  delete process.env.VERCEL_URL;
});

test("OAuth callbacks stay public only behind their existing state checks", async () => {
  for (const handler of [
    require("../api/google/callback.js"),
    require("../api/microsoft/callback.js")
  ]) {
    const res = mockRes();
    await handler(request("GET", { query: {}, host: "www.getjames.ai" }), res);
    assert.equal(res.statusCode, 400);
    assert.match(String(res.headers["Cache-Control"]), /no-store/);
  }
});

test("encoded, normalized, trailing-slash, query-bearing, and alternate-method routes fail closed", async () => {
  const gateway = require("../api/gateway.js");
  const variants = [
    "%69ndex.html",
    "index.html/",
    "%63alendar-test.html",
    "%63ouncil-test.html",
    "%61pp.js",
    "%2561pp.js",
    "./index.html",
    "assets/../app.js",
    "app.js",
    "styles.css",
    "calendar-test.html",
    "council-test.html",
    "assets/james-signature-v2.png"
  ];

  for (const route of variants) {
    for (const method of ["GET", "HEAD", "POST", "OPTIONS"]) {
      const res = mockRes();
      await gateway(request(method, { query: { path: route, cacheBust: "review" } }), res);
      assert.equal(res.statusCode, 401, `${method} /${route}`);
      assert.notEqual(typeof res.body === "string" && /Your Morning Briefing|Scott Schuster/.test(res.body), true);
      assert.match(String(res.headers["Cache-Control"]), /no-store/);
    }
  }

  const root = mockRes();
  await gateway(request("GET", { query: { path: "", cacheBust: "review" } }), root);
  assert.equal(root.statusCode, 302);
  assert.equal(root.headers.Location, "/login");
});

test("host and origin checks ignore spoofed forwarded values and reject unknown hosts", async () => {
  const session = require("../lib/routes/session.js");
  const gateway = require("../api/gateway.js");

  let res = mockRes();
  await session(request("GET", {
    authorized: true,
    host: "www.getjames.ai",
    forwardedHost: "attacker.example",
    forwardedProto: "http"
  }), res);
  assert.equal(res.statusCode, 200, "forwarded host and proto must not override Host");

  res = mockRes();
  await session(request("GET", {
    authorized: true,
    host: "attacker.example",
    forwardedHost: "www.getjames.ai",
    forwardedProto: "https"
  }), res);
  assert.equal(res.statusCode, 403, "unknown Host must not be rescued by forwarded headers");

  res = mockRes();
  await gateway(request("GET", {
    host: "attacker.example",
    forwardedHost: "www.getjames.ai",
    forwardedProto: "https",
    query: { path: "api/auth/session" }
  }), res);
  assert.equal(res.statusCode, 403, "a hostile Host reaching the application gateway must fail closed");
  assert.deepEqual(res.body, { ok: false, error: "FORBIDDEN" });
  assert.equal(res.headers["X-Application-Gateway"], "enforced");
  assert.match(String(res.headers["Cache-Control"]), /\bprivate\b/);
  assert.match(String(res.headers["Cache-Control"]), /\bno-store\b/);

  for (const origin of [
    "http://www.getjames.ai",
    "https://www.getjames.ai/path",
    "https://attacker.example"
  ]) {
    res = mockRes();
    assert.equal(auth.requestOrigin(request("POST", {
      host: "www.getjames.ai",
      origin,
      forwardedHost: "www.getjames.ai",
      forwardedProto: "https"
    })), null, origin);
  }
});

function assertLogoutCookiesCleared(res) {
  const cookies = res.headers["Set-Cookie"];
  assert.ok(Array.isArray(cookies));
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /^__Host-james_session=;/);
  assert.match(cookies[1], /^james_session=;/);

  for (const cookie of cookies) {
    assert.match(cookie, /; Path=\//);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; SameSite=Strict/);
    assert.match(cookie, /; Max-Age=0/);
    assert.match(cookie, /; Priority=High/);
    assert.doesNotMatch(cookie, /; Domain=/i);
  }
}

test("hostile logout requests cannot emit cookie deletion headers or mutate request state", async () => {
  const logout = require("../lib/routes/logout.js");
  const hostileCases = [
    {
      name: "cross-site origin",
      options: {
        authorized: true,
        host: "www.getjames.ai",
        origin: "https://attacker.example"
      }
    },
    {
      name: "missing origin",
      options: {
        authorized: true,
        host: "www.getjames.ai"
      }
    },
    {
      name: "hostile Host with trusted forwarded values",
      options: {
        authorized: true,
        host: "attacker.example",
        origin: "https://attacker.example",
        forwardedHost: "www.getjames.ai",
        forwardedProto: "https"
      }
    }
  ];

  for (const { name, options } of hostileCases) {
    const req = request("POST", options);
    const res = mockRes();
    await logout(req, res);
    assert.equal(res.statusCode, 403, name);
    assert.deepEqual(res.body, { ok: false, error: "FORBIDDEN" }, name);
    assert.equal(res.headers["Set-Cookie"], undefined, name);
    assert.equal(req.jamesIdentity, undefined, name);
  }
});

test("same-origin logout clears valid, invalid, expired, malformed, and legacy cookies", async () => {
  const logout = require("../lib/routes/logout.js");
  const valid = auth.createSessionToken(process.env.JAMES_AUTH_EMAIL);
  const forged = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
  const expired = auth.createSessionToken(process.env.JAMES_AUTH_EMAIL, {
    now: Math.floor(Date.now() / 1000) - 120,
    ttl: 30
  });

  const cases = [
    { name: "valid", cookie: `${auth.SESSION_COOKIE}=${valid}`, status: 200 },
    { name: "invalid signature", cookie: `${auth.SESSION_COOKIE}=${forged}`, status: 401 },
    { name: "expired", cookie: `${auth.SESSION_COOKIE}=${expired}`, status: 401 },
    { name: "malformed", cookie: `${auth.SESSION_COOKIE}=not-a-session`, status: 401 },
    { name: "legacy only", cookie: "james_session=legacy-value", status: 401 },
    {
      name: "valid with legacy",
      cookie: `${auth.SESSION_COOKIE}=${valid}; james_session=legacy-value`,
      status: 200
    }
  ];

  for (const entry of cases) {
    const res = mockRes();
    await logout(request("POST", {
      headers: { cookie: entry.cookie },
      host: "www.getjames.ai",
      origin: "https://www.getjames.ai"
    }), res);
    assert.equal(res.statusCode, entry.status, entry.name);
    assert.deepEqual(
      res.body,
      entry.status === 200 ? { ok: true } : { ok: false, error: "UNAUTHORIZED" },
      entry.name
    );
    assertLogoutCookiesCleared(res);
  }
});

test("OAuth callback failures never reflect provider-controlled text", async () => {
  const cases = [
    {
      handler: require("../api/google/callback.js"),
      cookie: "google_oauth_state=expected",
      expected: "Google authorization was not completed."
    },
    {
      handler: require("../api/microsoft/callback.js"),
      cookie: "microsoft_oauth_state=expected; microsoft_oauth_account=personal",
      expected: "Microsoft authorization was not completed."
    }
  ];

  for (const entry of cases) {
    const res = mockRes();
    await entry.handler(request("GET", {
      headers: { cookie: entry.cookie },
      query: { state: "expected", error: "<script>provider detail</script>" }
    }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body, entry.expected);
    assert.doesNotMatch(res.body, /provider detail|script/);
  }
});

test("public login content is generic, no-store, and contains no configured identity", async () => {
  const res = mockRes();
  await require("../lib/routes/login-page.js")(request("GET"), res);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["Cache-Control"]), /no-store/);
  assert.doesNotMatch(res.body, /Michael|michael@example\.com|configured identity/i);
  assert.match(res.body, /private James workspace/i);
});
