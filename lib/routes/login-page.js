const fs = require("node:fs");
const path = require("node:path");
const { privateNoStore, requireAllowedHost } = require("../auth.js");

module.exports = async function handler(req, res) {
  privateNoStore(res);
  if (!requireAllowedHost(req, res)) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }

  const body = fs.readFileSync(path.join(process.cwd(), "login.html"), "utf8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(body);
};
