import statusHandler from "./_status.js";
import calendarsHandler from "./_calendars.js";
import eventsHandler from "./_events.js";

const handlers = {
  status: statusHandler,
  calendars: calendarsHandler,
  events: eventsHandler,
};

export default async function handler(req, res) {
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
