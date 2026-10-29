const { isAllowedHost, requestHost } = require("../auth.js");

// Keep authorization cookies and the callback on the same trusted host.
// Never derive this address from Forwarded, Origin or user query parameters.
function microsoftRedirectUri(req) {
  if (!isAllowedHost(req)) throw new Error("Untrusted Microsoft callback host.");
  return `https://${requestHost(req)}/api/microsoft/callback`;
}

module.exports = { microsoftRedirectUri };
