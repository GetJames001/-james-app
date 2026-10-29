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
  res.setHeader("Content-Security-Policy", "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(body);
};

// Only the two decorative welcome images are public; private app assets stay protected.
module.exports.artwork = function artwork(req, res, route) {
  privateNoStore(res);
  if (!requireAllowedHost(req, res)) return;
  const files = {"login-art-dark.png":"welcome-dark.png", "login-art-light.png":"welcome-light.png"};
  if (!Object.hasOwn(files, route)) return res.status(404).end();
  if (!["GET", "HEAD"].includes(req.method)) {res.setHeader("Allow", "GET, HEAD");return res.status(405).end();}
  res.setHeader("Content-Type", "image/png");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(fs.readFileSync(path.join(process.cwd(), "assets", files[route])));
};
