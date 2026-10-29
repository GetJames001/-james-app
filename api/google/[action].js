const statusHandler = require("../../lib/google/status.js");
const calendarsHandler = require("../../lib/google/calendars.js");
const eventsHandler = require("../../lib/google/events.js");
const { requireAuth } = require("../../lib/auth.js");

const handlers = {
  status: statusHandler,
  calendars: calendarsHandler,
  events: eventsHandler,
};

module.exports = async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const action = Array.isArray(req.query.action)
    ? req.query.action[0]
    : req.query.action;

  const selectedHandler = handlers[action];

  if (!selectedHandler) {
    return res.status(404).json({
      error: "Google endpoint not found.",
    });
  }

  return selectedHandler(req, res);
}
