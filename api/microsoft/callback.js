export default async function handler(req, res) {
  const { code, error, state } = req.query;

  const cookies = Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map(cookie => cookie.trim().split("="))
      .filter(parts => parts.length === 2)
  );

  const expectedState = cookies.microsoft_oauth_state;
  const account = cookies.microsoft_oauth_account;

  if (!state || !expectedState || state !== expectedState) {
    return res.status(400).send("Invalid Microsoft authorization state.");
  }

  if (!["personal", "work"].includes(account)) {
    return res.status(400).send("Microsoft account type is missing.");
  }

  if (error) {
    return res.status(400).send(`Microsoft authorization failed: ${error}`);
  }

  if (!code) {
    return res.status(400).send("Missing Microsoft authorization code.");
  }

  try {
    const tokenResponse = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET,
          code,
          redirect_uri:
            "https://james-app-seven.vercel.app/api/microsoft/callback",
          grant_type: "authorization_code",
          scope: "openid profile offline_access User.Read Mail.Read",
        }),
      }
    );

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Microsoft token exchange failed", {
        error: tokens.error,
        description: tokens.error_description,
      });

      return res.status(500).send("Microsoft Mail connection failed.");
    }

    if (!tokens.refresh_token) {
      console.error("Microsoft did not return a refresh token.");
      return res
        .status(500)
        .send("Microsoft Mail connection could not be saved.");
    }

    const redisResponse = await fetch(process.env.KV_REST_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "SET",
        `microsoft:${account}:refresh_token`,
        tokens.refresh_token,
      ]),
    });

    if (!redisResponse.ok) {
      console.error("Failed to save Microsoft refresh token to Redis.");
      return res
        .status(500)
        .send("Microsoft Mail connection could not be saved.");
    }

    return res.status(200).send(`
      <!doctype html>
      <html>
        <head>
          <title>James Microsoft Mail Connected</title>
        </head>
        <body style="font-family: Arial, sans-serif; padding: 40px;">
          <h1>${account === "work" ? "Work" : "Personal"} Microsoft Mail connected.</h1>
          <p>James successfully completed the Microsoft authorization step.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Microsoft OAuth callback error:", err);
    return res.status(500).send("Microsoft Mail connection failed.");
  }
}
