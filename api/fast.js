/**
 * James Fast
 * POST /api/fast
 *
 * Fast path for ordinary questions.
 * Full Council remains at /api/council.
 */

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
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

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          model: process.env.JAMES_FAST_MODEL || "gpt-5-mini",
        store: false,
tools: [
  { type: "web_search" }
],
tool_choice: "auto",
          max_output_tokens: 4000,

          instructions: [
            "You are James, a fast, capable personal AI assistant.",
            "Answer ordinary questions directly, clearly, and concisely.",
            "Use web search when the question depends on current or changing information. Clearly distinguish searched facts from general knowledge.",
            "When using web search, prioritize primary sources and highly reputable outlets such as government agencies, official organizations, Reuters, AP, BBC, Financial Times, Wall Street Journal, New York Times, and other established sources. Avoid low-quality aggregators or local outlets when stronger sources cover the same story. Cross-check important claims across more than one credible source when practical.",
            "Do not append a separate duplicate links or highlights section after the answer unless the user asks for sources.",
            "For straightforward current-information requests, do not ask follow-up questions unless the request is genuinely ambiguous. Use a reasonable default interpretation, perform the search, and return the answer immediately. For requests like 'top news today,' summarize the leading stories across several reputable national sources without asking the user to choose a source first.",
            "Prioritize usefulness and accuracy over verbosity."
          ].join("\n"),

          input: question
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("James Fast OpenAI error:", data);

      return res.status(response.status).json({
        ok: false,
        error: "FAST_MODEL_FAILED",
        message:
          data?.error?.message ||
          "James could not complete the request."
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
    return res.status(200).json({
      ok: true,
      mode: "fast",
      duration_ms: Date.now() - started,
      answer: cleanedAnswer
    });

  } catch (err) {
    console.error("James Fast error:", err);

    return res.status(500).json({
      ok: false,
      error: "FAST_EXECUTION_FAILED",
      message: err?.message || "Unknown error"
    });
  }
};
