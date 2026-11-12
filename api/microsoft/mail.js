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

  const readOnly=req.method==='GET', deadline=Date.now()+15000;
  let readStage='connection_store',upstreamStatus=null;
  const readFailure=(code,reason='unavailable',status=502)=>res.status(status).json({
    account,code,error:'Microsoft Mail is unavailable.',messagesStatus:'unavailable',
    diagnostic:{stage:readStage,reason,upstreamStatus},
    coverage:{scope:'latest_inbox_page',complete:false,mailboxScanComplete:false,limit:25}
  });
  const requestFetch=async(url,options={})=>{
    upstreamStatus=null;
    const response=await fetch(url,readOnly?{...options,redirect:'error',signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))}:options);
    upstreamStatus=Number.isInteger(response.status)?response.status:null;return response;
  };
  try {
    const redisResponse = await requestFetch(process.env.KV_REST_API_URL, {
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
    // A storage outage is not evidence that the account is disconnected.
    // Only a successful GET with an explicit missing result establishes that.
    if (!redisResponse.ok || !redisData || typeof redisData !== "object" ||
        Array.isArray(redisData) || redisData.error ||
        !Object.hasOwn(redisData, "result") ||
        (redisData.result !== null &&
         (typeof redisData.result !== "string" || !redisData.result.trim()))) {
      return res.status(502).json({
        account,
        error: "Microsoft Mail connection status could not be checked. Please retry.",
        code: "MAIL_CONNECTION_STATUS_UNAVAILABLE",
        diagnostic:{stage:"connection_store",reason:"invalid_response",upstreamStatus},
        messagesStatus: "unavailable",
        coverage: { scope: "latest_inbox_page", complete: false, mailboxScanComplete: false, limit: 25 },
      });
    }
    const refreshToken = redisData.result;

    if (refreshToken === null) {
      return res.status(200).json({
        connected: false,
        account,
        unreadCount: null,
      });
    }

    readStage='authorization';
    const tokenResponse = await requestFetch(
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
          scope: req.query.calendar === "1" && account === "personal"
            ? "User.Read Calendars.Read" : "openid profile offline_access User.Read Mail.Read Mail.Send",
        }),
      }
    );

    const tokens = await tokenResponse.json();
    if(readOnly&&req.query.calendar!=='1'&&(!tokenResponse.ok||!tokens?.access_token)){
      const reasons=['invalid_grant','interaction_required','consent_required','invalid_scope','invalid_client','unauthorized_client'];
      const reason=reasons.includes(tokens?.error)?tokens.error:'provider_error';
      const code=['invalid_client','unauthorized_client'].includes(reason)?'MAIL_CONFIGURATION_REQUIRED':['invalid_grant','interaction_required','consent_required','invalid_scope'].includes(reason)?'MAIL_AUTH_REQUIRED':'MAIL_AUTHORIZATION_UNAVAILABLE';
      return readFailure(code,reason,code==='MAIL_AUTH_REQUIRED'?403:502);
    }

    if (req.method === "GET" && req.query.calendar === "1") {
      if (account !== "personal") return res.status(400).json({ error: "PERSONAL_CALENDAR_ONLY" });
      if (!tokenResponse.ok || !tokens.access_token) {
        const consent = ["invalid_grant", "interaction_required", "consent_required", "invalid_scope"].includes(tokens.error);
        return res.status(consent ? 403 : 502).json({ error: consent ? "CALENDAR_PERMISSION_REQUIRED" : "OUTLOOK_CALENDAR_UNAVAILABLE" });
      }
      return require("../../lib/microsoft/calendar.js")(tokens.access_token, res);
    }
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
if (req.method === "GET" && req.query.readMessageId !== undefined) {
  const id=req.query.readMessageId;
  if(account!=="personal"||typeof id!=="string"||!/^[A-Za-z0-9_+=/-]{1,2048}$/.test(id))return res.status(400).json({error:"INVALID_MESSAGE_ID"});
  const result=await readStateRequest("https://graph.microsoft.com/v1.0/me/messages/"+encodeURIComponent(id)+"?$select=id,subject,from,receivedDateTime,isRead,bodyPreview,body,importance,flag",{headers:{Authorization:"Bearer "+tokens.access_token}},Date.now()+10000);
  if(!result.ok)return res.status(result.status===404?404:502).json({error:"MESSAGE_UNAVAILABLE"});
  const message=result.data;
  if(message.id!==id)return res.status(502).json({error:"MESSAGE_UNAVAILABLE"});
  return res.status(200).json({message:{id:message.id,subject:message.subject||"(No subject)",sender:message.from?.emailAddress?.name||message.from?.emailAddress?.address||"Unknown sender",receivedDateTime:message.receivedDateTime,isRead:message.isRead,preview:message.bodyPreview||"",body:message.body?.content||"",importance:message.importance||"normal",flagStatus:message.flag?.flagStatus||"notFlagged"}});
}
if (req.method === "GET" && req.query.messageId !== undefined) {
  const { messageId, attachmentId } = req.query;
  const validId = id => typeof id === "string" && /^[A-Za-z0-9_+=/-]{1,2048}$/.test(id);
  if (account !== "personal" || !validId(messageId) || (attachmentId !== undefined && !validId(attachmentId))) {
    return res.status(400).json({ error: "INVALID_ATTACHMENT_REQUEST" });
  }
  const path = "messages/" + encodeURIComponent(messageId) + "/attachments";
  const result = await readStateRequest("https://graph.microsoft.com/v1.0/me/" + path +
    (attachmentId ? "/" + encodeURIComponent(attachmentId) : "?$top=100"), {
    headers: { Authorization: "Bearer " + tokens.access_token }
  }, Date.now() + 10000);
  if (!result.ok) return res.status(502).json({ error: "ATTACHMENT_UNAVAILABLE", providerStatus: result.status });
  if (!attachmentId) return res.status(200).json({ attachments: (result.data.value || []).map(({id, name, contentType, isInline, contentId, size}) => ({id, name, contentType, isInline, contentId, size})) });
  const { name, contentType, contentBytes } = result.data;
  if (typeof contentBytes !== "string") return res.status(404).json({ error: "ATTACHMENT_UNAVAILABLE", providerStatus: result.status });
  return res.status(200).json({ name, contentType, contentBytes });
}
if (req.method === "POST") {
  const { messageId, replyText } = req.body || {};

  if (!messageId || !replyText?.trim()) {
    return res.status(400).json({
      sent: false,
      error: "Message ID and reply text are required.",
    });
  }

  const replyResponse = await requestFetch(
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
    // A delayed unread count must not prevent actual messages from loading.
    const inboxRead=(async()=>{
      try{
        const result=await readStateRequest('https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=unreadItemCount,totalItemCount',{
          headers:{Authorization:`Bearer ${tokens.access_token}`},redirect:'error'
        },Math.min(deadline,Date.now()+5000));
        return result.ok?result.data:null;
      }catch{return null;}
    })();
const inboxMessages = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=25&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,body,importance,flag&$orderby=receivedDateTime%20desc");
const cursor = req.query.cursor;
if (cursor !== undefined) {
  if (account !== "personal" || typeof cursor !== "string" || !/^\d{1,12}$/.test(cursor)) {
    return res.status(400).json({ error: "INVALID_MAIL_CURSOR" });
  }
  inboxMessages.searchParams.set("$skip", cursor);
}
readStage='inbox_messages';
const messagesResponse = await requestFetch(
  inboxMessages.toString(),
  {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Prefer: 'outlook.body-content-type="html"'
    },
  }
);

const messageFailure = reason => res.status(502).json({
  connected: true,
  account,
  error: "Microsoft Mail messages could not be refreshed. Please retry.",
  code: "MAIL_MESSAGES_UNAVAILABLE",
  diagnostic:{stage:"inbox_messages",reason,upstreamStatus},
  messagesStatus: "unavailable",
  coverage: { scope: "latest_inbox_page", complete: false, mailboxScanComplete: false, limit: 25 },
  upstreamStatus: messagesResponse.status,
  reason,
});
let messagesData;
try { messagesData = await messagesResponse.json(); }
catch (_) { return messageFailure("invalid_json"); }
if (!messagesResponse.ok) return messageFailure("provider_error");
if (!messagesData || !Array.isArray(messagesData.value)) return messageFailure("invalid_message_list");

const nextLink = messagesData["@odata.nextLink"];
const nextCursor = typeof nextLink === "string" ? new URL(nextLink, inboxMessages).searchParams.get("$skip") : null;
const messages = messagesData.value.map(message => ({
      id: message.id,
      subject: message.subject || "(No subject)",
      sender:
        message.from?.emailAddress?.name ||
        message.from?.emailAddress?.address ||
        "Unknown sender",
      receivedDateTime: message.receivedDateTime,
      isRead: message.isRead,
      importance: message.importance || "normal",
      flagStatus: message.flag?.flagStatus || "notFlagged",
      preview: message.bodyPreview || "",
    body: message.body?.content || ''
    }));
    let reconciliation;
    if (req.query.reviewCheckIds !== undefined) {
      let ids;
      try { ids=JSON.parse(req.query.reviewCheckIds); } catch { return res.status(400).json({error:"INVALID_REVIEW_CHECK"}); }
      if(account!=="personal"||!Array.isArray(ids)||ids.length>25||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=="string"||!(/^[A-Za-z0-9_+=/-]{1,2048}$/).test(id)))return res.status(400).json({error:"INVALID_REVIEW_CHECK"});
      const {verifyChecks}=require("../../lib/attention/mail-reconcile.cjs");
      const checked=await verifyChecks(ids,async id=>{
        const current=messages.find(message=>message.id===id);
        if(current)return {message:current};
        const result=await readStateRequest("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/"+encodeURIComponent(id)+"?$select=id,subject,from,receivedDateTime,bodyPreview,importance,flag",{headers:{Authorization:"Bearer "+tokens.access_token}},Date.now()+10000);
        if(result.status===404)return {absent:true};
        if(!result.ok||result.data?.id!==id)throw Error("MAIL_RECONCILIATION_UNAVAILABLE");
        const message=result.data;
        return {message:{id,subject:message.subject||"(No subject)",sender:message.from?.emailAddress?.name||message.from?.emailAddress?.address||"Unknown sender",receivedDateTime:message.receivedDateTime,preview:message.bodyPreview||"",importance:message.importance||"normal",flagStatus:message.flag?.flagStatus||"notFlagged"}};
      });
      reconciliation={...checked,cursor:ids.at(-1)||null};
    }
    const inbox=await inboxRead;
    const unreadCount=Number.isSafeInteger(inbox?.unreadItemCount)&&inbox.unreadItemCount>=0?inbox.unreadItemCount:null;
    const totalCount=Number.isSafeInteger(inbox?.totalItemCount)&&inbox.totalItemCount>=0?inbox.totalItemCount:null;
    return res.status(200).json({
      connected: true,
      account,
      unreadCount,totalCount,countStatus:unreadCount===null?'unavailable':'available',
      messages,
      ...(reconciliation?{reconciliation}:{}),
      nextCursor,
      messagesStatus: "available",
      coverage: {
        scope: "latest_inbox_page", complete: true, mailboxScanComplete: false,
        limit: 25, returned: messages.length,
        hasMore: typeof messagesData["@odata.nextLink"] === "string" && !!messagesData["@odata.nextLink"],
      },
    });
  } catch (err) {
    if(readOnly)return readFailure(readStage==='connection_store'?'MAIL_CONNECTION_STATUS_UNAVAILABLE':'MAIL_READ_UNAVAILABLE',err?.name==='TimeoutError'||err?.name==='AbortError'?'timeout':'request_failed');
    console.error("Microsoft Mail endpoint error", {stage:'write_request'});
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
