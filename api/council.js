/**
 * Vercel Serverless Function
 * POST /api/council
 *
 * Body:
 * {
 *   "question": "Should I buy this company?",
 *   "context": { ... optional Executive Case File context ... }
 * }
 *
 * Security:
 * OPENAI_API_KEY must be stored in Vercel Environment Variables.
 */

const { runExecutiveCouncil } = require("../lib/live-council-e2e.js");

module.exports = async function handler(req, res) {
  // Basic CORS for same-site browser use. Tighten allowed origin later if needed.
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
  const context = req.body?.context && typeof req.body.context === "object"
    ? req.body.context
    : {};

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
    const result = await runExecutiveCouncil({
      question,
      context,
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.JAMES_DEFAULT_MODEL || "gpt-5"
    });

    return res.status(200).json({
      ok: true,
      duration_ms: Date.now() - started,
      ...result
    });
  } catch (err) {
    console.error("James Council error:", err);

    return res.status(500).json({
      ok: false,
      error: "COUNCIL_EXECUTION_FAILED",
      message: err?.message || "Unknown error"
    });
  }
};
