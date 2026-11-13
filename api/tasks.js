const { createHash } = require("node:crypto");
const { requireAuth } = require("../lib/auth.js");
const { boundedJson } = require("../lib/attention/storage-response.cjs");
const { CAS } = require("../lib/customer-activity/storage.cjs");

// Preserve the existing single-owner array. No migration, seeding or cleanup.
const TASKS_KEY = "james:tasks";
const MAX_BYTES = 1024 * 1024;
const MAX_TASKS = 2000;

function validTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > MAX_TASKS) return false;
  const ids = new Set();
  for (const task of tasks) {
    if (!task || typeof task !== "object" || Array.isArray(task) ||
        typeof task.id !== "string" || !task.id.trim() || task.id.length > 256 ||
        ids.has(task.id) || typeof task.title !== "string" ||
        !task.title.trim() || task.title.length > 2000) return false;
    ids.add(task.id);
  }
  return Buffer.byteLength(JSON.stringify(tasks), "utf8") <= MAX_BYTES;
}

function revision(raw) {
  return createHash("sha256").update(raw === null ? "absent" : `present:${raw}`).digest("hex");
}

async function redis(command) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw Error("STORAGE_UNAVAILABLE");
  const response = await fetch(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw Error("STORAGE_UNAVAILABLE");
  const data = await boundedJson(response);
  if (!data || typeof data !== "object" || Object.hasOwn(data, "error") ||
      !Object.hasOwn(data, "result")) throw Error("INVALID_STORAGE_RESPONSE");
  return data.result;
}

async function readTasks() {
  const raw = await redis(["GET", TASKS_KEY]);
  if (raw !== null && (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_BYTES)) {
    throw Error("INVALID_STORED_TASKS");
  }
  const tasks = raw === null ? [] : JSON.parse(raw);
  if (!validTasks(tasks)) throw Error("INVALID_STORED_TASKS");
  return { raw, tasks, revision: revision(raw) };
}

module.exports = async function handler(req, res) {
  const session = requireAuth(req, res, { csrf: req.method === "POST" });
  if (!session) return;
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  // Preview shares existing credentials. It must never mutate the live Task Pad.
  const writable = process.env.VERCEL_ENV !== "preview";
  try {
    if (req.method === "GET") {
      const current = await readTasks();
      return res.status(200).json({ tasks: current.tasks, revision: current.revision, writable });
    }
    if (!writable) return res.status(403).json({ error: "TASKS_PREVIEW_READ_ONLY" });

    let body;
    try {
      if (typeof req.body === "string" && Buffer.byteLength(req.body, "utf8") > MAX_BYTES + 256) {
        return res.status(413).json({ error: "TASKS_TOO_LARGE" });
      }
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || !validTasks(body.tasks)) return res.status(400).json({ error: "INVALID_TASKS" });
    } catch {
      return res.status(400).json({ error: "INVALID_TASKS" });
    }
    if (typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision)) {
      return res.status(428).json({ error: "TASKS_RELOAD_REQUIRED" });
    }

    const current = await readTasks();
    if (body.revision !== current.revision) return res.status(409).json({ error: "TASKS_CONFLICT" });
    const next = JSON.stringify(body.tasks);
    const result = await redis(["EVAL", CAS, 1, TASKS_KEY,
      current.raw === null ? "absent" : "present", current.raw || "", next]);
    if (result === 0) return res.status(409).json({ error: "TASKS_CONFLICT" });
    if (result !== 1) throw Error("INVALID_STORAGE_RESPONSE");
    return res.status(200).json({ saved: true, tasks: body.tasks, revision: revision(next), writable });
  } catch {
    // Never turn malformed/unavailable storage into an empty list or expose upstream details.
    return res.status(503).json({ error: "TASKS_UNAVAILABLE" });
  }
};
