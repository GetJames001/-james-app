const {
  clearLegacySessionCookie,
  clearSessionCookie,
  privateNoStore,
  requireAllowedHost,
  requireAuth,
  requireSameOrigin,
  sessionFromRequest,
  unauthorized
} = require("../auth.js");

module.exports = async function handler(req, res) {
  privateNoStore(res);
  if (req.method !== "POST") {
    const session = requireAuth(req, res);
    if (!session) return;
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  // Reject cross-site and hostile-host requests before changing browser state.
  if (!requireAllowedHost(req, res)) return;
  if (!requireSameOrigin(req, res)) return;

  // A trusted same-origin logout is also the recovery path for expired,
  // malformed, and legacy cookies, so clear them after the request boundary
  // has been validated even when the current session is no longer usable.
  const session = sessionFromRequest(req);
  res.setHeader("Set-Cookie", [clearSessionCookie(), clearLegacySessionCookie()]);
  if (!session) return unauthorized(res);

  return res.status(200).json({ ok: true });
};
