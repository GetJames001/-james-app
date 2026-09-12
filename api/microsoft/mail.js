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
          scope: "openid profile offline_access User.Read Mail.Read Mail.Send",
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
if (req.method === "POST") {
  const { messageId, replyText } = req.body || {};

  if (!messageId || !replyText?.trim()) {
    return res.status(400).json({
      sent: false,
      error: "Message ID and reply text are required.",
    });
  }

  const replyResponse = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(
      messageId
    )}/reply`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        comment: replyText.trim(),
      }),
    }
  );

  if (!replyResponse.ok) {
    const replyError = await replyResponse.text();

    console.error("Microsoft reply failed", replyError);

    return res.status(500).json({
      sent: false,
      error: "Microsoft could not send the reply.",
    });
  }

  return res.status(200).json({
    sent: true,
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
const messagesResponse = await fetch(
  "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=10&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,body&$orderby=receivedDateTime%20desc",
  {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Prefer: 'outlook.body-content-type="html"'
    },
  }
);

const messagesData = await messagesResponse.json();

const messages = messagesResponse.ok && Array.isArray(messagesData.value)
  ? messagesData.value.map(message => ({
      id: message.id,
      subject: message.subject || "(No subject)",
      sender:
        message.from?.emailAddress?.name ||
        message.from?.emailAddress?.address ||
        "Unknown sender",
      receivedDateTime: message.receivedDateTime,
      isRead: message.isRead,
      preview: message.bodyPreview || "",
    body: message.body?.content || ''
    }))
  : [];
    return res.status(200).json({
      connected: true,
      account,
      unreadCount: inbox.unreadItemCount ?? 0,
      totalCount: inbox.totalItemCount ?? 0,
      messages,
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
