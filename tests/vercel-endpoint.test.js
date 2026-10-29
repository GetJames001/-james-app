const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../api/council.js");
const { createSessionToken } = require("../lib/auth.js");

process.env.JAMES_AUTH_EMAIL = "michael@example.com";
process.env.JAMES_SESSION_SECRET = "test-session-secret-that-is-at-least-thirty-two-bytes";

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

function authorizedRequest(method, body = {}) {
  const token = createSessionToken(process.env.JAMES_AUTH_EMAIL);
  return {
    method,
    body,
    headers: {
      cookie: `__Host-james_session=${token}`,
      host: "www.getjames.ai",
      origin: "https://www.getjames.ai"
    }
  };
}

test("Council rejects unauthenticated requests before endpoint metadata", async () => {
  const res = mockRes();
  await handler({ method: "GET", body: {}, headers: { host: "www.getjames.ai" } }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: "UNAUTHORIZED" });
});

test("Council retains method and configuration behavior for an authorized user", async () => {
  let res = mockRes();
  await handler(authorizedRequest("GET"), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error, "METHOD_NOT_ALLOWED");

  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    res = mockRes();
    await handler(authorizedRequest("POST", { question: "Test" }), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, "OPENAI_API_KEY_NOT_CONFIGURED");
  } finally {
    if (oldKey) process.env.OPENAI_API_KEY = oldKey;
  }
});
