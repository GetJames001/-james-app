const { requireAuth } = require("../lib/auth.js");
const TASKS_KEY = "james:tasks";

async function redis(command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(`Redis request failed with status ${response.status}`);
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  const session = requireAuth(req, res, { csrf: req.method === "POST" });
  if (!session) return;

  try {
    // GET /api/tasks
    // Load Michael's persistent Task Pad.
    if (req.method === "GET") {
      const redisData = await redis(["GET", TASKS_KEY]);

      if (!redisData.result) {
        return res.status(200).json({
          tasks: [],
        });
      }

      let tasks;

      try {
        tasks = JSON.parse(redisData.result);
      } catch {
        tasks = [];
      }

      return res.status(200).json({
        tasks: Array.isArray(tasks) ? tasks : [],
      });
    }

    // POST /api/tasks
    // Save the complete Task Pad.
    if (req.method === "POST") {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body || "{}")
          : req.body || {};

      if (!Array.isArray(body.tasks)) {
        return res.status(400).json({
          error: "tasks must be an array.",
        });
      }

      await redis([
        "SET",
        TASKS_KEY,
        JSON.stringify(body.tasks),
      ]);

      return res.status(200).json({
        saved: true,
        tasks: body.tasks,
      });
    }

    res.setHeader("Allow", "GET, POST");

    return res.status(405).json({
      error: "Method not allowed.",
    });
  } catch (error) {
    console.error("Tasks API error:", error);

    return res.status(500).json({
      error: "Could not access James Tasks.",
    });
  }
}
