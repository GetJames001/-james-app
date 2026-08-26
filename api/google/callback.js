export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`Google authorization failed: ${error}`);
  }

  if (!code) {
    return res.status(400).send("Missing Google authorization code.");
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:
          "https://james-app-seven.vercel.app/api/google/callback",
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Google token exchange failed", {
        error: tokens.error,
        description: tokens.error_description,
      });

      return res.status(500).send("Google Calendar connection failed.");
    }

    return res.status(200).send(`
      <!doctype html>
      <html>
        <head>
          <title>James Calendar Connected</title>
        </head>
        <body style="font-family: Arial, sans-serif; padding: 40px;">
          <h1>Google Calendar connected.</h1>
          <p>James successfully completed the Google authorization step.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return res.status(500).send("Google Calendar connection failed.");
  }
}
