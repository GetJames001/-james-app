const { requireAuth } = require("../auth.js");

module.exports = async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const redisResponse = await fetch(process.env.KV_REST_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "GET",
        "google:refresh_token",
      ]),
    });

    if (!redisResponse.ok) {
      return res.status(500).json({
        connected: false,
        error: "Could not check Google connection.",
      });
    }

    const data = await redisResponse.json();

    return res.status(200).json({
      connected: Boolean(data.result),
    });
  } catch (error) {
    console.error("Google status check failed:", error);

    return res.status(500).json({
      connected: false,
      error: "Could not check Google connection.",
    });
  }
}
