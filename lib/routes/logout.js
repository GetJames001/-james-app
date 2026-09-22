const {
  clearSessionCookie,
  requireAuth
} = require("../auth.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    const session = requireAuth(req, res);
    if (!session) return;
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const session = requireAuth(req, res, { csrf: true });
  if (!session) return;

  res.setHeader("Set-Cookie", clearSessionCookie());
  return res.status(200).json({ ok: true });
};
