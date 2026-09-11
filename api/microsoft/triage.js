module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  try {
    const messages = Array.isArray(req.body?.messages)
      ? req.body.messages.slice(0, 10)
      : [];

    if (!messages.length) {
      return res.status(400).json({
        ok: false,
        error: "MESSAGES_REQUIRED"
      });
    }

    const emailText = messages.map((message, index) => ({
      index,
      id: message.id || "",
      sender: message.sender || "",
      subject: message.subject || "",
      receivedDateTime: message.receivedDateTime || "",
      body: String(message.body || message.preview || "").slice(0, 5000)
    }));

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.JAMES_FAST_MODEL || "gpt-5-mini",
        store: false,
        max_output_tokens: 1800,

        instructions: [
          "You are James, an executive AI assistant.",
          "Classify email for attention and action.",
          "Use only the email content supplied. Do not browse the web.",
          "",
          "For each email assign exactly one category:",
          "ACTION = the user should reply, decide, call, schedule, pay, submit, approve, follow up, or otherwise act.",
          "IMPORTANT = meaningful personal or business information worth surfacing, but no immediate action is clearly required.",
          "FYI = useful information with low urgency and no action required.",
          "LOW_PRIORITY = marketing, promotions, newsletters, automated advertising, or other mail that normally does not deserve the user's attention.",
          "",
          "Also provide:",
          "- summary: one short sentence",
          "- suggestedAction: a short action such as Reply, Call, Review, Add to calendar, Follow up, or None",
          "- urgency: high, normal, or low",
          "",
          "Return ONLY valid JSON in this exact shape:",
          '{"results":[{"index":0,"category":"ACTION","summary":"...","suggestedAction":"Reply","urgency":"normal"}]}'
        ].join("\n"),

        input: JSON.stringify(emailText)
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Email triage OpenAI error:", data);

      return res.status(response.status).json({
        ok: false,
        error: "TRIAGE_MODEL_FAILED"
      });
    }

    const answer =
      data.output_text ||
      data.output
        ?.flatMap(item => item.content || [])
        ?.filter(item => item.type === "output_text")
        ?.map(item => item.text || "")
        ?.join("\n") ||
      "";

    const cleaned = answer
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      console.error("Could not parse triage response:", cleaned);

      return res.status(500).json({
        ok: false,
        error: "TRIAGE_PARSE_FAILED"
      });
    }

    return res.status(200).json({
      ok: true,
      results: Array.isArray(parsed.results) ? parsed.results : []
    });

  } catch (error) {
    console.error("Email triage endpoint error:", error);

    return res.status(500).json({
      ok: false,
      error: "TRIAGE_FAILED"
    });
  }
};
