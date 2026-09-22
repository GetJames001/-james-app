const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const runWithVercelCli = process.env.JAMES_SECURITY_USE_VERCEL_CLI === "1";
const runWithAutomationBypass = process.env.JAMES_SECURITY_USE_AUTOMATION_BYPASS === "1";
const runAuthorizedProbe = runWithVercelCli || runWithAutomationBypass;
const previewUrls = String(process.env.JAMES_SECURITY_PREVIEW_URLS || "")
  .split(",")
  .map(value => value.trim().replace(/\/$/, ""))
  .filter(Boolean);
const vercelCommand = process.env.JAMES_VERCEL_CLI_COMMAND || "vercel";
const curlCommand = process.env.JAMES_CURL_COMMAND || "curl";
const automationBypassSecret = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "");

const privateSignatures = [
  "Your Morning Briefing",
  "Scott Schuster",
  "Central Transport Proposal",
  "loadPersonalMicrosoftMail"
];

const unauthorizedCases = [
  { name: "trailing-slash index", target: "/index.html/" },
  { name: "encoded internal calendar page", target: "/%63alendar-test.html" },
  { name: "encoded internal council page", target: "/%63ouncil-test.html" },
  { name: "encoded application JavaScript", target: "/%61pp.js" },
  { name: "double-encoded application JavaScript", target: "/%2561pp.js" },
  { name: "query-bearing application JavaScript", target: "/app.js?cache=security-review" },
  { name: "private stylesheet", target: "/styles.css" },
  { name: "private image asset", target: "/assets/james-signature-v2.png" },
  { name: "encoded dot and slash", target: "/.%2findex.html" },
  { name: "unknown route", target: "/unknown-private-route" },
  { name: "private Tasks API", target: "/api/tasks?cache=security-review" }
];

const redirectCases = [
  { name: "application root", target: "/" },
  { name: "encoded index", target: "/%69ndex.html" },
  { name: "raw dot-segment index", target: "/a/../index.html" },
  { name: "query-bearing index", target: "/index.html?cache=security-review" }
];

const alternateMethods = ["HEAD", "POST", "OPTIONS", "PUT"];

function validatePreviewUrls() {
  assert.equal(previewUrls.length, 2, "provide the immutable and branch Preview URLs");
  assert.equal(new Set(previewUrls).size, 2, "Preview URLs must be distinct");
  for (const value of previewUrls) {
    const parsed = new URL(value);
    assert.equal(parsed.protocol, "https:");
    assert.match(parsed.hostname, /\.vercel\.app$/);
    assert.equal(parsed.pathname, "/");
  }
}

function validateAutomationBypassSecret(value) {
  assert.ok(value, "the encrypted Vercel automation-bypass secret is required");
  assert.ok(Buffer.byteLength(value, "utf8") <= 4096, "the automation-bypass secret is invalid");
  assert.doesNotMatch(value, /[\r\n]/, "the automation-bypass secret is invalid");
}

function parseHeaderFile(contents) {
  const blocks = contents
    .split(/\r?\n\r?\n/)
    .map(value => value.trim())
    .filter(value => /^HTTP\//i.test(value));
  assert.ok(blocks.length > 0, "curl did not return an HTTP response header block");

  const lines = blocks.at(-1).split(/\r?\n/);
  const headers = new Map();
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    const existing = headers.get(name) || [];
    existing.push(value);
    headers.set(name, existing);
  }
  return headers;
}

function authorizedRequest(baseUrl, requestTarget, options = {}) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "james-gateway-probe-"));
  const headerFile = path.join(temporaryDirectory, "headers.txt");
  const bodyFile = path.join(temporaryDirectory, "body.txt");
  const bypassHeaderFile = path.join(temporaryDirectory, "bypass-header.txt");
  const method = options.method || "GET";
  const curlArgs = [
    "--silent",
    "--show-error",
    "--connect-timeout",
    "10",
    "--max-time",
    "25",
    "--proto",
    "=https",
    "--path-as-is",
    "--request-target",
    requestTarget,
    "--dump-header",
    headerFile,
    "--output",
    bodyFile,
    "--write-out",
    "%{http_code}"
  ];

  if (method !== "GET") curlArgs.push("--request", method);

  for (const [name, value] of Object.entries(options.headers || {})) {
    curlArgs.push("--header", `${name}: ${value}`);
  }

  try {
    let command;
    let args;

    if (runWithAutomationBypass) {
      validateAutomationBypassSecret(automationBypassSecret);
      fs.writeFileSync(
        bypassHeaderFile,
        `x-vercel-protection-bypass: ${automationBypassSecret}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 }
      );
      command = curlCommand;
      args = ["--header", `@${bypassHeaderFile}`, ...curlArgs, `${baseUrl}/`];
    } else {
      command = vercelCommand;
      args = ["curl", "/", "--deployment", baseUrl, "--", ...curlArgs];
    }

    const result = childProcess.spawnSync(command, args, {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "protected Preview request failed");

    const statusMatch = String(result.stdout || "").match(/(\d{3})\s*$/);
    assert.ok(statusMatch, "protected Preview request did not report an HTTP status");
    return {
      status: Number(statusMatch[1]),
      headers: parseHeaderFile(fs.readFileSync(headerFile, "utf8")),
      body: fs.readFileSync(bodyFile, "utf8")
    };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function headerValues(response, name) {
  return response.headers.get(name.toLowerCase()) || [];
}

function assertGatewayResponse(response, expectedStatus, label) {
  assert.equal(response.status, expectedStatus, label);
  assert.deepEqual(headerValues(response, "x-application-gateway"), ["enforced"], label);
  assert.doesNotMatch(
    headerValues(response, "location").join(", "),
    /vercel\.com\/sso-api/i,
    `${label}: Vercel Authentication intercepted the request`
  );
  assert.match(headerValues(response, "cache-control").join(", "), /\bprivate\b/i, label);
  assert.match(headerValues(response, "cache-control").join(", "), /\bno-store\b/i, label);
  for (const signature of privateSignatures) {
    assert.doesNotMatch(response.body, new RegExp(signature, "i"), `${label}: ${signature}`);
  }
}

function assertUnauthorized(response, label, options = {}) {
  assertGatewayResponse(response, 401, label);
  if (!options.head) {
    assert.deepEqual(JSON.parse(response.body), { ok: false, error: "UNAUTHORIZED" }, label);
  } else {
    assert.equal(response.body, "", label);
  }
}

test("deployed gateway probe supports protected automation without exposing its secret", () => {
  const source = fs.readFileSync(__filename, "utf8");
  assert.match(source, /JAMES_SECURITY_USE_VERCEL_CLI/);
  assert.match(source, /JAMES_SECURITY_USE_AUTOMATION_BYPASS/);
  assert.match(source, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(source, /x-vercel-protection-bypass/);
  assert.match(source, /mode: 0o600/);
  assert.match(source, /`@\$\{bypassHeaderFile\}`/);
  assert.match(source, /"--request-target"/);
  assert.match(source, /"--path-as-is"/);
  assert.match(source, /x-application-gateway/);
  assert.doesNotMatch(source, /assert\.notEqual\(response\.status,\s*200/);
  assert.ok(unauthorizedCases.some(entry => entry.target === "/%2561pp.js"));
  assert.ok(redirectCases.some(entry => entry.target === "/a/../index.html"));
  assert.deepEqual(alternateMethods, ["HEAD", "POST", "OPTIONS", "PUT"]);
});

test("automation-bypass validation rejects missing, oversized, or multiline values", () => {
  assert.throws(() => validateAutomationBypassSecret(""), /required/);
  assert.throws(() => validateAutomationBypassSecret("x".repeat(4097)), /invalid/);
  assert.throws(() => validateAutomationBypassSecret("value\nsecond-header"), /invalid/);
});

test("authorized automation reaches both protected Preview application gateways", {
  skip: runAuthorizedProbe
    ? false
    : "Deferred: an authorized manual GitHub Actions re-run must supply the encrypted bypass secret."
}, () => {
  assert.notEqual(
    runWithVercelCli && runWithAutomationBypass,
    true,
    "select exactly one protected-deployment authorization mechanism"
  );
  if (runWithAutomationBypass) validateAutomationBypassSecret(automationBypassSecret);
  validatePreviewUrls();

  for (const baseUrl of previewUrls) {
    for (const entry of redirectCases) {
      const response = authorizedRequest(baseUrl, entry.target);
      assertGatewayResponse(response, 302, `${baseUrl}: ${entry.name}`);
      assert.deepEqual(headerValues(response, "location"), ["/login"], entry.name);
      assert.equal(response.body, "", entry.name);
    }

    for (const entry of unauthorizedCases) {
      assertUnauthorized(
        authorizedRequest(baseUrl, entry.target),
        `${baseUrl}: ${entry.name}`
      );
    }

    for (const method of alternateMethods) {
      assertUnauthorized(
        authorizedRequest(baseUrl, "/%61pp.js", { method }),
        `${baseUrl}: ${method} encoded app.js`,
        { head: method === "HEAD" }
      );
    }

    const forwardedHeaders = authorizedRequest(baseUrl, "/api/auth/session", {
      headers: {
        "X-Forwarded-Host": "attacker.example",
        "X-Forwarded-Proto": "http"
      }
    });
    assertUnauthorized(forwardedHeaders, `${baseUrl}: spoofed forwarded headers`);

    const hostileOriginLogout = authorizedRequest(baseUrl, "/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://attacker.example" }
    });
    assertGatewayResponse(hostileOriginLogout, 403, `${baseUrl}: hostile logout Origin`);
    assert.deepEqual(
      JSON.parse(hostileOriginLogout.body),
      { ok: false, error: "FORBIDDEN" }
    );
    assert.deepEqual(headerValues(hostileOriginLogout, "set-cookie"), []);

    const sameOriginLogout = authorizedRequest(baseUrl, "/api/auth/logout", {
      method: "POST",
      headers: { Origin: baseUrl }
    });
    assertUnauthorized(sameOriginLogout, `${baseUrl}: same-origin logout without app session`);
    const clearedCookies = headerValues(sameOriginLogout, "set-cookie");
    assert.equal(clearedCookies.length, 2);
    assert.match(clearedCookies[0], /^__Host-james_session=;/);
    assert.match(clearedCookies[1], /^james_session=;/);
    for (const cookie of clearedCookies) {
      assert.match(cookie, /Path=\//);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /Secure/);
      assert.match(cookie, /SameSite=Strict/);
      assert.match(cookie, /Max-Age=0/);
    }

    const hostileHost = authorizedRequest(baseUrl, "/api/auth/session", {
      headers: { Host: "attacker.example" }
    });
    assertGatewayResponse(hostileHost, 403, `${baseUrl}: hostile Host`);
    assert.deepEqual(JSON.parse(hostileHost.body), { ok: false, error: "FORBIDDEN" });
  }
});
