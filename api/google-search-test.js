/**
 * James Google Search Test
 * POST /api/google-search-test
 *
 * Separate benchmark path.
 * Does not change Fast James or Full Council.
 */

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");c
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (!["GET", "POST"].includes(req.method)) {
  return res.status(405).json({
    ok: false,
    error: "METHOD_NOT_ALLOWED"
  });
}

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "GEMINI_API_KEY_NOT_CONFIGURED"
    });
  }

  const question = String(
  req.method === "GET"
    ? req.query?.question || ""
    : req.body?.question || ""
).trim();

const timezone = String(
  req.method === "GET"
    ? req.query?.timezone || "UTC"
    : req.body?.timezone || "UTC"
);

  if (!question) {
    return res.status(400).json({
      ok: false,
      error: "QUESTION_REQUIRED"
    });
  }

  const started = Date.now();

  const currentDate = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date());

  try {
    const model =
      process.env.JAMES_GOOGLE_MODEL ||
      "gemini-3.6-flash";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",

        headers: {
          "x-goog-api-key": process.env.GEMINI_API_KEY,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: [
                    `The current date is ${currentDate}.`,
                    `The user's timezone is ${timezone}.`,
                    "Answer the question directly and concisely.",
                    "For current information, use Google Search grounding.",
                    "Prefer authoritative, primary, and major established sources.",
                    "",
                    `Question: ${question}`
                  ].join("\n")
                }
              ]
            }
          ],

          tools: [
            {
              google_search: {}
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("James Google Search error:", data);

      return res.status(response.status).json({
        ok: false,
        error: "GOOGLE_SEARCH_FAILED",
        message:
          data?.error?.message ||
          "Google-grounded search could not complete."
      });
    }

    const candidate = data?.candidates?.[0];

    const answer =
      candidate?.content?.parts
        ?.map(part => part?.text || "")
        ?.filter(Boolean)
        ?.join("\n")
        ?.trim() || "";

    const grounding =
      candidate?.groundingMetadata || {};

    const sources = (grounding.groundingChunks || [])
      .map(chunk => chunk?.web)
      .filter(Boolean)
      .map(source => ({
        title: source.title || "",
        url: source.uri || ""
      }))
      .filter(source => source.url);

    return res.status(200).json({
      ok: true,
      provider: "google",
      model,
      duration_ms: Date.now() - started,
      answer,
      sources
    });

  } catch (err) {
    console.error("James Google Search test error:", err);

    return res.status(500).json({
      ok: false,
      error: "GOOGLE_SEARCH_TEST_FAILED",
      message: err?.message || "Unknown error"
    });
  }
};
