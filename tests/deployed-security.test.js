const assert = require("node:assert/strict");
const https = require("node:https");
const test = require("node:test");

const previewUrls = String(process.env.JAMES_SECURITY_PREVIEW_URLS || "")
  .split(",")
  .map(value => value.trim().replace(/\/$/, ""))
  .filter(Boolean);
const bypassSecret = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "");

const privateSignatures = [
  "Your Morning Briefing",
  "Scott Schuster",
  "Central Transport Proposal",
  "loadPersonalMicrosoftMail"
];

function headers(extra = {}) {
  return {
    ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
    ...extra
  };
}

async function assertBlocked(baseUrl, path, method = "GET", extraHeaders = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: headers(extraHeaders),
        redirect: "manual",
        signal: AbortSignal.timeout(15_000)
      });
      const body = method === "HEAD" ? "" : await response.text();
      for (const signature of privateSignatures) assert.doesNotMatch(body, new RegExp(signature, "i"));
      assert.notEqual(response.status, 200, `${method} ${baseUrl}${path}`);
      return response.status;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function rawHostRequest(baseUrl, hostHeader) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: target.hostname,
      path: "/api/auth/session",
      method: "GET",
      headers: headers({ Host: hostHeader, "X-Forwarded-Host": target.hostname, "X-Forwarded-Proto": "https" })
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("deployed hostile-host request timed out")));
    req.end();
  });
}

async function rawHostRequestWithRetry(baseUrl, hostHeader) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await rawHostRequest(baseUrl, hostHeader);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

test("deployed Preview blocks normalized and encoded application paths", {
  skip: previewUrls.length ? false : "Set JAMES_SECURITY_PREVIEW_URLS to run deployed verification."
}, async () => {
  const paths = [
    "/%69ndex.html",
    "/index.html/",
    "/%63alendar-test.html",
    "/%63ouncil-test.html",
    "/%61pp.js",
    "/%2561pp.js",
    "/app.js?cache=review",
    "/calendar-test.html?cache=review",
    "/a/../index.html",
    "/.%2findex.html",
    "/api/tasks?cache=review"
  ];

  for (const baseUrl of previewUrls) {
    for (let index = 0; index < paths.length; index += 3) {
      await Promise.all(paths.slice(index, index + 3).map(path => assertBlocked(baseUrl, path)));
    }
    await Promise.all(["HEAD", "POST", "OPTIONS"]
      .map(method => assertBlocked(baseUrl, "/%61pp.js", method)));

    await assertBlocked(baseUrl, "/app.js", "GET", {
      "X-Forwarded-Host": "attacker.example",
      "X-Forwarded-Proto": "http"
    });

    const hostileHost = await rawHostRequestWithRetry(baseUrl, "attacker.example");
    assert.notEqual(hostileHost.status, 200);
    for (const signature of privateSignatures) assert.doesNotMatch(hostileHost.body, new RegExp(signature, "i"));
  }
});
