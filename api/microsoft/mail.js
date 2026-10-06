const { requireAuth } = require("../../lib/auth.js");

module.exports = async function handler(req, res) {
  const session = requireAuth(req, res, { csrf: ["POST", "PATCH"].includes(req.method) });
  if (!session) return;

  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const account = req.query.account;

  if (!["personal", "work"].includes(account)) {
    return res.status(400).json({
      connected: false,
      error: "Choose personal or work Microsoft account.",
    });
  }

  if (req.method === "PATCH") return updateReadState(req, res, account);

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

// Only this explicit mutation requests write permission. Normal reads and replies
// retain their existing scopes so an older connection can continue reading mail.
async function updateReadState(req, res, account) {
  if (account !== "personal") {
    return res.status(400).json({ ok: false, error: "PERSONAL_MAIL_ONLY" });
  }
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      !Object.hasOwn(body, "messageId") || !Object.hasOwn(body, "isRead") ||
      typeof body.messageId !== "string" || body.messageId.length < 1 ||
      body.messageId.length > 2048 || [".", ".."].includes(body.messageId) ||
      /[\s\x00-\x1f\x7f]/.test(body.messageId) ||
      typeof body.isRead !== "boolean") {
    return res.status(400).json({ ok: false, error: "INVALID_READ_STATE" });
  }
  const deadline = Date.now() + 15000;
  const permissionRequired = () => res.status(403).json({
    ok: false, error: "MAIL_PERMISSION_REQUIRED",
    message: "Reconnect Personal Mail to allow read-status updates."
  });
  try {
    const stored = await readStateRequest(process.env.KV_REST_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(["GET", "microsoft:personal:refresh_token"])
    }, deadline);
    if (!stored.ok) throw new Error("Provider request failed");
    if (!stored.data.result) return permissionRequired();
    const refreshed = await readStateRequest("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        refresh_token: stored.data.result,
        grant_type: "refresh_token",
        scope: "openid profile offline_access User.Read Mail.ReadWrite Mail.Send"
      })
    }, deadline);
    if (!refreshed.ok || !refreshed.data.access_token) {
      if (["invalid_grant", "interaction_required", "consent_required", "invalid_scope"].includes(refreshed.data.error)) return permissionRequired();
      throw new Error("Provider request failed");
    }
    const tokens = refreshed.data;
    // Microsoft may rotate the refresh token; save it before issuing a mutation.
    if (tokens.refresh_token && tokens.refresh_token !== stored.data.result) {
      const saved = await readStateRequest(process.env.KV_REST_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(["SET", "microsoft:personal:refresh_token", tokens.refresh_token])
      }, deadline);
      if (!saved.ok || saved.data.error || saved.data.result !== "OK") throw new Error("Token could not be saved");
    }
    if (typeof tokens.scope === "string" && !tokens.scope.toLowerCase().split(/\s+/).includes("mail.readwrite")) return permissionRequired();
    const updated = await readStateRequest(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(body.messageId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: body.isRead })
    }, deadline);
    if ([401, 403].includes(updated.status)) return permissionRequired();
    if (!updated.ok || updated.data.isRead !== body.isRead) {
      return res.status(502).json({ ok: false, error: "READ_STATE_NOT_CONFIRMED" });
    }
    // The message change is already confirmed. A failed count read must not turn
    // this into a mutation failure or manufacture a +/-1 unread count.
    let unreadCount = null;
    try {
      const inbox = await readStateRequest("https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=unreadItemCount", {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      }, deadline);
      if (inbox.ok && Number.isSafeInteger(inbox.data.unreadItemCount) && inbox.data.unreadItemCount >= 0) unreadCount = inbox.data.unreadItemCount;
    } catch (_) { /* Keep the confirmed message state; count will refresh later. */ }
    return res.status(200).json({ ok: true, account, messageId: body.messageId,
      isRead: updated.data.isRead, unreadCount, unreadCountVerified: unreadCount !== null });
  } catch (err) {
    // Do not log provider bodies, message identifiers, tokens or error details.
    return res.status(err.name === "TimeoutError" ? 504 : 502).json({
      ok: false, error: err.name === "TimeoutError" ? "MAIL_REQUEST_TIMEOUT" : "MAIL_REQUEST_FAILED"
    });
  }
}

async function readStateRequest(url, options, deadline) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, signal: controller.signal });
        // Error responses may be empty or non-JSON; preserve their status so
        // permission failures still produce the reconnection path.
        const data = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, data };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error("Mail request timed out");
          error.name = "TimeoutError";
          reject(error);
        }, Math.max(0, deadline - Date.now()));
      })
    ]);
  } finally { clearTimeout(timer); }
}
