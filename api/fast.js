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
          max_output_tokens: 1200,

          instructions: [
            "You are James, a fast, capable personal AI assistant.",
            "Answer ordinary questions directly, clearly, and concisely.",
            "Use web search when the question depends on current or changing information. Clearly distinguish searched facts from general knowledge.",
            "For straightforward current-information requests, do not ask unnecessary clarifying questions. Make a reasonable interpretation, search, and answer directly.","If the question requires deep strategic, financial, legal, technical, or consequential analysis, say that Full Council review would be appropriate.",
            "Prioritize usefulness and accuracy over verbosity."
          ].join("\n"),

          input: question
        })
      }
    );

    const data = await response.json();
console.log("James Fast debug:", {
  status: data.status,
  incomplete_details: data.incomplete_details,
  output_types: Array.isArray(data.output)
    ? data.output.map(item => ({
        type: item.type,
        status: item.status,
        content_types: Array.isArray(item.content)
          ? item.content.map(c => c.type)
          : []
      }))
    : [],
  usage: data.usage
});
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

    return res.status(200).json({
      ok: true,
      mode: "fast",
      duration_ms: Date.now() - started,
      answer
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
