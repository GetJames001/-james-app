/**
 * GET /api/health
 * Does not expose secret values.
 */
const { requireAuth } = require("../lib/auth.js");

module.exports = async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok:false, error:"METHOD_NOT_ALLOWED" });
  }

  return res.status(200).json({
    ok: true,
    service: "james-live-council",
    version: "0.4.0",
    openai_configured: Boolean(process.env.OPENAI_API_KEY)
  });
};
