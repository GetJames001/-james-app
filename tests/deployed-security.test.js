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
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(extraHeaders),
    redirect: "manual"
  });
  const body = method === "HEAD" ? "" : await response.text();
  for (const signature of privateSignatures) assert.doesNotMatch(body, new RegExp(signature, "i"));
  assert.notEqual(response.status, 200, `${method} ${baseUrl}${path}`);
  return response.status;
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
    req.end();
  });
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
    for (const path of paths) {
      await assertBlocked(baseUrl, path);
      await assertBlocked(baseUrl, path, "HEAD");
      await assertBlocked(baseUrl, path, "POST");
      await assertBlocked(baseUrl, path, "OPTIONS");
    }

    await assertBlocked(baseUrl, "/app.js", "GET", {
      "X-Forwarded-Host": "attacker.example",
      "X-Forwarded-Proto": "http"
    });

    const hostileHost = await rawHostRequest(baseUrl, "attacker.example");
    assert.notEqual(hostileHost.status, 200);
    for (const signature of privateSignatures) assert.doesNotMatch(hostileHost.body, new RegExp(signature, "i"));
  }
});
