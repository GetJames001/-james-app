const { requireAuth } = require("../auth.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    const session = requireAuth(req, res);
    if (!session) return;
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const session = requireAuth(req, res);
  if (!session) return;

  return res.status(200).json({
    ok: true,
    identity: session.sub,
    expiresAt: session.exp
  });
};
