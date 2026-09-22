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
  const headers = { ...(options.headers || {}) };
  if (options.authorized) {
    const token = auth.createSessionToken(process.env.JAMES_AUTH_EMAIL, options.sessionOptions);
    headers.cookie = `james_session=${token}`;
  }
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.host) headers.host = options.host;
  if (options.host) headers["x-forwarded-host"] = options.host;
  headers["x-forwarded-proto"] = options.protocol || "https";

  return {
    method,
    headers,
    body: options.body || {},
    query: options.query || {}
  };
}

const protectedEndpoints = [
  ["/api/health", require("../api/health.js"), request("GET")],
  ["/api/tasks", require("../api/tasks.js"), request("GET")],
  ["/api/fast", require("../api/fast.js"), request("POST")],
  ["/api/council", require("../api/council.js"), request("POST")],
  ["/api/google/status", require("../api/google/[action].js"), request("GET", { query: { action: "status" } })],
  ["/api/google/_status", require("../api/google/_status.js"), request("GET")],
  ["/api/google/_calendars", require("../api/google/_calendars.js"), request("GET")],
  ["/api/google/_events", require("../api/google/_events.js"), request("GET")],
  ["/api/google/connect", require("../api/google/connect.js"), request("GET")],
  ["/api/microsoft/mail", require("../api/microsoft/mail.js"), request("GET")],
  ["/api/microsoft/triage", require("../api/microsoft/triage.js"), request("POST")],
  ["/api/microsoft/connect", require("../api/microsoft/connect.js"), request("GET")],
  ["/api/auth/session", require("../api/auth/session.js"), request("GET")],
  ["/api/auth/logout", require("../api/auth/logout.js"), request("POST")]
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

test("API inventory explicitly classifies every deployed function", () => {
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
    "api/auth/login.js",
    "api/google/callback.js",
    "api/microsoft/callback.js"
  ]);
  const expectedProtected = new Set([
    "api/app.js",
    "api/auth/logout.js",
    "api/auth/session.js",
    "api/council.js",
    "api/fast.js",
    "api/google/[action].js",
    "api/google/_calendars.js",
    "api/google/_events.js",
    "api/google/_status.js",
    "api/google/connect.js",
    "api/health.js",
    "api/microsoft/connect.js",
    "api/microsoft/mail.js",
    "api/microsoft/triage.js",
    "api/tasks.js"
  ]);

  assert.deepEqual(
    new Set(apiFiles),
    new Set([...publicFunctions, ...expectedProtected])
  );
  for (const file of expectedProtected) {
    assert.match(fs.readFileSync(path.join(root, file), "utf8"), /requireAuth|sessionFromRequest/);
  }
});

test("forged, expired, future, malformed, and wrong-identity sessions fail closed", () => {
  const now = 2000000000;
  const valid = auth.createSessionToken(process.env.JAMES_AUTH_EMAIL, { now });
  assert.equal(auth.verifySessionToken(valid, { now }).sub, process.env.JAMES_AUTH_EMAIL);

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
  const login = require("../api/auth/login.js");

  let res = mockRes();
  await login(request("POST", {
    host: "www.getjames.ai",
    origin: "https://attacker.example",
    body: { email: process.env.JAMES_AUTH_EMAIL, password: "correct horse battery staple" }
  }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers["Set-Cookie"], undefined);

  res = mockRes();
  await login(request("POST", {
    host: "www.getjames.ai",
    origin: "https://www.getjames.ai",
    body: { email: process.env.JAMES_AUTH_EMAIL, password: "correct horse battery staple" }
  }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Set-Cookie"], /^james_session=/);
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
    ["logout", require("../api/auth/logout.js"), {}, {}]
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
  }
});

test("authorized requests preserve app, session, health, and stored Tasks behavior", async () => {
  const sameOrigin = {
    authorized: true,
    host: "www.getjames.ai",
    origin: "https://www.getjames.ai"
  };

  let res = mockRes();
  await require("../api/auth/session.js")(request("GET", sameOrigin), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.identity, process.env.JAMES_AUTH_EMAIL);

  res = mockRes();
  await require("../api/health.js")(request("GET", sameOrigin), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.service, "james-live-council");

  res = mockRes();
  await require("../api/app.js")(request("GET", sameOrigin), res);
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
  await require("../api/app.js")(request("GET", {
    host: "www.getjames.ai",
    origin: "https://www.getjames.ai"
  }), res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, "/login");
  assert.match(String(res.headers["Cache-Control"]), /private/);
  assert.match(String(res.headers["Cache-Control"]), /no-store/);
});

test("authorization is host-agnostic while same-origin CSRF follows each entry URL", async () => {
  const session = require("../api/auth/session.js");
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
});

test("OAuth callbacks stay public only behind their existing state checks", async () => {
  for (const handler of [
    require("../api/google/callback.js"),
    require("../api/microsoft/callback.js")
  ]) {
    const res = mockRes();
    await handler(request("GET", { query: {} }), res);
    assert.equal(res.statusCode, 400);
    assert.match(String(res.headers["Cache-Control"]), /no-store/);
  }
});
