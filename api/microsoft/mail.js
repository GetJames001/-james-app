export default async function handler(req, res) {
  const account = req.query.account;

  if (!["personal", "work"].includes(account)) {
    return res.status(400).json({
      connected: false,
      error: "Choose personal or work Microsoft account.",
    });
  }

  try {
    const redisResponse = await fetch(process.env.KV_REST_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "GET",
        `microsoft:${account}:refresh_token`,
      ]),
    });

    const redisData = await redisResponse.json();
    const refreshToken = redisData.result;

    if (!refreshToken) {
      return res.status(200).json({
        connected: false,
        account,
        unreadCount: null,
      });
    }

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
          refresh_token: refreshToken,
          grant_type: "refresh_token",
          scope: "openid profile offline_access User.Read Mail.Read",
        }),
      }
    );

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok || !tokens.access_token) {
      console.error("Microsoft token refresh failed", {
        error: tokens.error,
        description: tokens.error_description,
      });

      return res.status(500).json({
        connected: false,
        account,
        error: "Microsoft Mail token refresh failed.",
      });
    }

    const graphResponse = await fetch(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=unreadItemCount,totalItemCount",
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );

    const inbox = await graphResponse.json();

    if (!graphResponse.ok) {
      console.error("Microsoft Graph mail request failed", inbox);

      return res.status(500).json({
        connected: true,
        account,
        error: "Microsoft Mail could not be read.",
      });
    }

    return res.status(200).json({
      connected: true,
      account,
      unreadCount: inbox.unreadItemCount ?? 0,
      totalCount: inbox.totalItemCount ?? 0,
    });
  } catch (err) {
    console.error("Microsoft Mail endpoint error:", err);

    return res.status(500).json({
      connected: false,
      account,
      error: "Microsoft Mail request failed.",
    });
  }
}
