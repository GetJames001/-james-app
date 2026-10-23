/**
 * James Fast
 * POST /api/fast
 *
 * Fast path for ordinary questions.
 * Full Council remains at /api/council.
 */
const { requireAuth } = require("../lib/auth.js");

module.exports = async function handler(req, res) {
  const session = requireAuth(req, res, { csrf: req.method === "POST" });
  if (!session) return;

  const diagnosticPreview = process.env.VERCEL_ENV === "preview" && process.env.VERCEL_GIT_COMMIT_REF === "investigate/conversation-host-20261023";
  const selectedModel = process.env.JAMES_FAST_MODEL || (diagnosticPreview ? "gpt-5.6-luna" : "gpt-5-mini");
  // Temporary read-only diagnosis is available only on this isolated Preview.
  // The ordinary James authentication boundary above always runs first.
  if (req.method === "GET" && req.query?.diagnostics === "models" &&
      diagnosticPreview) {
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ok:false,error:"MODEL_DIAGNOSTIC_UNAVAILABLE"});
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        method:"GET", redirect:"error", signal:AbortSignal.timeout(8000),
        headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`}
      });
      if (!response.ok) return res.status(502).json({ok:false,error:"MODEL_INVENTORY_UNAVAILABLE"});
      const data = await response.json();
      if (!Array.isArray(data?.data)) throw Error("INVALID_MODEL_INVENTORY");
      const models = [...new Set(data.data.map(item=>item?.id).filter(id=>typeof id==="string" && /^(?:gpt-|o[134](?:-|$))/.test(id) && id.length<100))].sort();
      return res.status(200).json({ok:true,configuredModel:selectedModel,models,inferenceAccessVerified:false});
    } catch {
      return res.status(502).json({ok:false,error:"MODEL_INVENTORY_UNAVAILABLE"});
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "OPENAI_API_KEY_NOT_CONFIGURED"
    });
  }

  const question = String(req.body?.question || "").trim();

  if (!question) {
    return res.status(400).json({
      ok: false,
      error: "QUESTION_REQUIRED"
    });
  }

  if (question.length > 12000) {
    return res.status(400).json({
      ok: false,
      error: "QUESTION_TOO_LONG"
    });
  }

  const started = Date.now();

  const timezone = String(req.body?.timezone || "UTC");

  const currentDate = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date());
  
  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        signal: AbortSignal.timeout(25000),

        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          model: selectedModel,
          ...(selectedModel === "gpt-5.6-luna" ? {reasoning:{effort:"low"}} : {}),

          store: false,

          tools: [
  {
    type: "web_search",
    search_context_size: "low"
  }
],

          tool_choice: "auto",

          max_output_tokens: 800,

          instructions: [
            `The user's local date is ${currentDate} in timezone ${timezone}. This is the authoritative date for the conversation.`,
`For "today", "tonight", "tomorrow", "yesterday", and other relative dates, always use the user's local date and timezone above. Do not substitute UTC, server time, or a date inferred from web-search results.`,
            "You are James, a fast, capable personal AI assistant.",
            "Answer ordinary questions directly, clearly, and concisely.",
            "Use web search when the question depends on current or changing information. Clearly distinguish searched facts from general knowledge.",
            "When using web search, prioritize primary sources and highly reputable outlets such as government agencies, official organizations, Reuters, AP, BBC, Financial Times, Wall Street Journal, New York Times, and other established sources. Avoid low-quality aggregators or local outlets when stronger sources cover the same story. Cross-check important claims across more than one credible source when practical.",
            "Do not append a separate duplicate links or highlights section after the answer unless the user asks for sources.",
            "For straightforward current-information requests, do not ask follow-up questions unless the request is genuinely ambiguous. Use a reasonable default interpretation, perform the search, and return the answer immediately. For requests like 'top news today,' summarize the leading stories across several reputable national sources without asking the user to choose a source first.",
            "Prioritize usefulness and accuracy over verbosity."
          ].join("\n"),

          input: `User local date: ${currentDate} (${timezone}). ${question}`
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      // Provider authorization is not a James session failure. Never forward
      // a provider 401/403 as the application authentication boundary.
      const unavailable = data?.error?.code === "model_not_found";
      console.error("James Fast provider failure", {status: response.status, category: unavailable ? "model_unavailable" : "request_failed"});
      return res.status(502).json({
        ok: false,
        error: unavailable ? "FAST_MODEL_UNAVAILABLE" : "FAST_MODEL_FAILED",
        message: unavailable ? "James's configured model is unavailable." : "James could not complete the request."
      });
    }

    const answer =
      data.output_text ||
      data.output
        ?.flatMap(item => item.content || [])
        ?.filter(item => item.type === "output_text")
        ?.map(item => item.text || "")
        ?.join("\n")
        ?.trim() ||
      "";

    const cleanedAnswer = answer
      .replace(/\n## Highlights:[\s\S]*$/i, "")
      .trim();

    const trustedDomains = [
      "apnews.com",
      "reuters.com",
      "bbc.com",
      "nytimes.com",
      "wsj.com",
      "ft.com",
      "npr.org",
      "cnn.com",
      "whitehouse.gov",
      "congress.gov",
      "justice.gov",
      "state.gov",
      "treasury.gov",
      "sec.gov"
    ];

    const citedDomains = [
      ...cleanedAnswer.matchAll(/https?:\/\/(?:www\.)?([^/\s)]+)/gi)
    ].map(match => match[1].toLowerCase());

    const weakDomains = [
      ...new Set(
        citedDomains.filter(domain =>
          !trustedDomains.some(
            trusted =>
              domain === trusted ||
              domain.endsWith(`.${trusted}`)
          )
        )
      )
    ];

    return res.status(200).json({
      ok: true,
      mode: "fast",
      duration_ms: Date.now() - started,
      source_quality: weakDomains.length ? "mixed" : "trusted",
      weak_domains: weakDomains,
      answer: cleanedAnswer
    });

  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.error("James Fast execution failure", {category: timedOut ? "timeout" : "request_failed"});

    return res.status(timedOut ? 504 : 502).json({
      ok: false,
      error: timedOut ? "FAST_TIMEOUT" : "FAST_EXECUTION_FAILED",
      message: "James could not complete the request."
    });
  }
};
