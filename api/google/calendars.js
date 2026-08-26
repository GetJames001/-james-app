export default async function handler(req, res) {
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
        error: "Could not read Google connection.",
      });
    }

    const redisData = await redisResponse.json();
    const refreshToken = redisData.result;

    if (!refreshToken) {
      return res.status(401).json({
        error: "Google Calendar is not connected.",
      });
    }

    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(500).json({
        error: "Could not refresh Google Calendar access.",
      });
    }

    const calendarListResponse = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    const calendarListData = await calendarListResponse.json();

    if (!calendarListResponse.ok) {
      console.error("Google calendar list failed", calendarListData);

      return res.status(500).json({
        error: "Could not load Google calendars.",
      });
    }

    const calendars = (calendarListData.items || []).map((calendar) => ({
      id: calendar.id,
      name: calendar.summary || "",
      primary: Boolean(calendar.primary),
      selected: calendar.selected !== false,
      accessRole: calendar.accessRole || "",
    }));

    return res.status(200).json({
      connected: true,
      count: calendars.length,
      calendars,
    });
  } catch (error) {
    console.error("Google calendars error:", error);

    return res.status(500).json({
      error: "Could not load Google calendars.",
    });
  }
}
