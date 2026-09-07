import crypto from "crypto";

export default async function handler(req, res) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;

  if (!clientId) {
    return res.status(500).send("Microsoft Client ID is not configured.");
  }

  const state = crypto.randomBytes(24).toString("hex");

  res.setHeader(
    "Set-Cookie",
    `microsoft_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri:
      "https://james-app-seven.vercel.app/api/microsoft/callback",
    response_type: "code",
    response_mode: "query",
    scope: "openid profile offline_access User.Read Mail.Read",
    state,
  });

  const authorizationUrl =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;

  return res.redirect(302, authorizationUrl);
}
