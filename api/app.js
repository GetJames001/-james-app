const fs = require("node:fs");
const path = require("node:path");
const {
  privateNoStore,
  sessionFromRequest
} = require("../lib/auth.js");

module.exports = async function handler(req, res) {
  privateNoStore(res);

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }

  if (!sessionFromRequest(req)) {
    res.setHeader("Location", "/login");
    return res.status(302).end();
  }

  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");

  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(html);
};
