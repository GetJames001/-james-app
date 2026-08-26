export default async function handler(req, res) {
  try {
    // 1. Get the saved Google refresh token from Redis
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

    // 2. Use the refresh token to obtain a fresh access token
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
      console.error("Google access token refresh failed", {
        error: tokenData.error,
        description: tokenData.error_description,
      });

      return res.status(500).json({
        error: "Could not refresh Google Calendar access.",
      });
    }

    // 3. Get the calendars available to this Google account
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

// Ignore holiday calendars, but include the user's selected calendars
const calendars = (calendarListData.items || []).filter((calendar) => {
  const name = (calendar.summary || "").toLowerCase();

  return (
    calendar.selected !== false &&
    !name.includes("holiday")
  );
});

// 4. Pull upcoming events from all relevant calendars
const now = new Date();
const sevenDaysFromNow = new Date(
  now.getTime() + 7 * 24 * 60 * 60 * 1000
);

const allEvents = [];

for (const calendar of calendars) {
  const calendarParams = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: sevenDaysFromNow.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });

  const calendarResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendar.id
    )}/events?${calendarParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    }
  );

  const calendarData = await calendarResponse.json();

  if (!calendarResponse.ok) {
    console.error(
      `Google Calendar read failed for ${calendar.summary || calendar.id}`,
      calendarData
    );

    continue;
  }

  for (const event of calendarData.items || []) {
    allEvents.push({
      id: event.id,
      calendarId: calendar.id,
      calendarName: calendar.summary || "",
      title: event.summary || "Untitled event",
      location: event.location || "",
      start: event.start?.dateTime || event.start?.date || null,
      end: event.end?.dateTime || event.end?.date || null,
      allDay: Boolean(event.start?.date),
    });
  }
}

// 5. Sort everything into one unified schedule
allEvents.sort((a, b) => {
  return new Date(a.start) - new Date(b.start);
});

return res.status(200).json({
  connected: true,
  calendarCount: calendars.length,
  count: allEvents.length,
  events: allEvents,
});
  } catch (error) {
    console.error("Google Calendar events error:", error);

    return res.status(500).json({
      error: "Could not load Google Calendar events.",
    });
  }
}
