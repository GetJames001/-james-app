/**
 * James Fast
 * POST /api/fast
 *
 * Fast path for ordinary questions.
 * Full Council remains at /api/council.
 */
const { requireAuth } = require("../lib/auth.js");
const {searchPlaces,freshPoint}=require("../lib/travel/places.js");

module.exports = async function handler(req, res) {
  const session = requireAuth(req, res, { csrf: req.method === "POST" });
  if (!session) return;

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

  const selectedModel = String(process.env.JAMES_FAST_MODEL || "").trim();
  if (!selectedModel || !/^[a-zA-Z0-9._:-]{1,120}$/.test(selectedModel)) {
    return res.status(503).json({ok:false,error:"FAST_MODEL_NOT_CONFIGURED",message:"James's text model is not configured."});
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

  const spoken=req.body?.responseStyle==='spoken_brief';
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
    const payload={
          model: selectedModel,
          ...(selectedModel === "gpt-5.6-luna" ? {reasoning:{effort:"low"}} : {}),

          store: false,

          tools: [
  {
    type: "web_search",
    search_context_size: "low"
  },
  {type:"function",name:"find_places",description:"Find business names and exact addresses. Use nearby when no city/area was specified, explicit when a city or area was named. Named areas override device location.",parameters:{type:"object",properties:{query:{type:"string"},area:{type:"string",enum:["nearby","explicit"]}},required:["query","area"],additionalProperties:false}}
],

          tool_choice: "auto",

          max_output_tokens: spoken?300:800,

          instructions: [
            `The user's local date is ${currentDate} in timezone ${timezone}. This is the authoritative date for the conversation.`,
`For "today", "tonight", "tomorrow", "yesterday", and other relative dates, always use the user's local date and timezone above. Do not substitute UTC, server time, or a date inferred from web-search results.`,
            "You are James, a fast, capable personal AI assistant.",
            "Answer ordinary questions directly, clearly, and concisely.",
            "For business locations use find_places. Named cities/areas always take priority over current location; include the named area in the query and use area explicit. Otherwise use area nearby, including follow-ups that refer to the current local search. Do not add an assumed Las Vegas or profile city. If location_required is returned, ask to enable live location or name a city. Never identify home or claim the closest branch from weather, timezone or a location bias alone. Do not require a complete directory; offer verified matches. Match voice behavior in typed chat. You cannot create tasks, reminders or Calendar events through this text research endpoint; never claim to have saved an action.",
            ...(spoken?["This is a live spoken conversation. Lead with the direct answer in two to four short sentences. Give a useful researched summary first, then offer details. Preserve key uncertainty and distinguish trade-in, private-party and retail values when relevant. Do not fabricate current prices or skip necessary search to sound fast."]:[]),
            "Use web search when the question depends on current or changing information. Clearly distinguish searched facts from general knowledge.",
            "When using web search, prioritize primary sources and highly reputable outlets such as government agencies, official organizations, Reuters, AP, BBC, Financial Times, Wall Street Journal, New York Times, and other established sources. Avoid low-quality aggregators or local outlets when stronger sources cover the same story. Cross-check important claims across more than one credible source when practical.",
            "Do not append a separate duplicate links or highlights section after the answer unless the user asks for sources.",
            "For straightforward current-information requests, do not ask follow-up questions unless the request is genuinely ambiguous. Use a reasonable default interpretation, perform the search, and return the answer immediately. For requests like 'top news today,' summarize the leading stories across several reputable national sources without asking the user to choose a source first.",
            "Prioritize usefulness and accuracy over verbosity."
          ].join("\n"),

          input: `User local date: ${currentDate} (${timezone}). ${question}`
        };
    const deadline=started+25000;
    const call=async body=>{const remaining=deadline-Date.now();if(remaining<=0)throw Object.assign(Error('TIMEOUT'),{name:'TimeoutError'});const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(remaining),headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});return {response,data:await response.json()};};
    let {response,data}=await call(payload);
    const calls=response.ok&&Array.isArray(data.output)?data.output.filter(item=>item.type==='function_call'):[];
    if(calls.length){
      const input=[{role:'user',content:payload.input},...data.output],point=freshPoint(req.body?.deviceLocation)?req.body.deviceLocation:null;
      let used=0;
      for(const item of calls){let result={status:'unavailable',reason:'unsupported_tool'};
        try{const args=JSON.parse(item.arguments);if(item.name==='find_places'&&used<2&&args&&Object.keys(args).sort().join('|')==='area|query'){used++;result=await searchPlaces({...args,location:point});}}catch{result={status:'unavailable',reason:'invalid_tool_request'};}
        input.push({type:'function_call_output',call_id:item.call_id,output:JSON.stringify(result)});
      }
      ({response,data}=await call({...payload,input,tool_choice:'none'}));
    }

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
