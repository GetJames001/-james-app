const fs = require("node:fs");
const path = require("node:path");
const {
  privateNoStore,
  requireAuth
} = require("../auth.js");

module.exports = async function handler(req, res) {
  privateNoStore(res);

  const resource = req.jamesResource || {};
  const asset = String(resource.asset || "");
  const document = String(resource.document || "");
  const session = requireAuth(req, res, { redirectToLogin: !asset && !document });
  if (!session) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }

  const allowedDocuments = new Set(["calendar-test.html", "council-test.html"]);
  const allowedAssets = new Map([
    ["app.js", { filename: "app.js", type: "text/javascript; charset=utf-8" }],
    ["styles.css", { filename: "styles.css", type: "text/css; charset=utf-8" }],
    ["assets/james-signature-v2.png", { filename: "assets/james-signature-v2.png", type: "image/png" }],
    ["assets/orb/90ededa3-bf96-4b39-89c6-29ea5f73338b.png", { filename: "assets/orb/90ededa3-bf96-4b39-89c6-29ea5f73338b.png", type: "image/png" }],
    ["assets/orb/james-orb-v1.png", { filename: "assets/orb/james-orb-v1.png", type: "image/png" }],
    ["assets/orb/james-signature.png.", { filename: "assets/orb/james-signature.png.", type: "image/png" }],
    ["james-orb-v1.png", { filename: "james-orb-v1.png", type: "image/png" }]
  ]);
  const selected = asset
    ? allowedAssets.get(asset)
    : allowedDocuments.has(document)
      ? { filename: document, type: "text/html; charset=utf-8" }
      : { filename: "index.html", type: "text/html; charset=utf-8" };

  if (!selected) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  const binary = selected.type === "image/png";
  const body = fs.readFileSync(path.join(process.cwd(), selected.filename), binary ? undefined : "utf8");
  res.setHeader("Content-Type", selected.type);
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");

  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(body);
};
