const fs = require("node:fs");
const path = require("node:path");
const {
  privateNoStore,
  sessionFromRequest
} = require("../auth.js");

module.exports = async function handler(req, res) {
  privateNoStore(res);

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }

  const asset = String(req.query?.asset || "");
  const document = String(req.query?.document || "");

  if (!sessionFromRequest(req)) {
    if (asset) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    res.setHeader("Location", "/login");
    return res.status(302).end();
  }

  const allowedDocuments = new Set(["calendar-test.html", "council-test.html"]);
  const filename = asset === "app.js"
    ? "app.js"
    : allowedDocuments.has(document)
      ? document
      : "index.html";
  const body = fs.readFileSync(path.join(process.cwd(), filename), "utf8");
  res.setHeader(
    "Content-Type",
    filename.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : "text/html; charset=utf-8"
  );
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");

  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(body);
};
