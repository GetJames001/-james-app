import crypto from "crypto";

export default async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return res.status(500).send("Google Client ID is not configured.");
  }

  const state = crypto.randomBytes(24).toString("hex");

  res.setHeader(
    "Set-Cookie",
    `google_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri:
      "https://james-app-seven.vercel.app/api/google/callback",
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  const authorizationUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return res.redirect(302, authorizationUrl);
}
