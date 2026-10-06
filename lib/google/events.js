const { requireAuth } = require("../auth.js");

// Bounded provider reads. Hitting any bound is disclosed, never presented as a
// complete calendar. Existing OAuth scope and token storage remain unchanged.
const LIMITS = Object.freeze({ calendarPages: 20, calendars: 100, eventPages: 20, eventsPerCalendar: 500, events: 5000 });

function validBoundary(boundary, allDay) {
  const value=allDay ? boundary?.date : boundary?.dateTime;
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}/.test(value))return false;
  const day=new Date(value.slice(0,10)+"T12:00:00Z");
  if(!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10)!==value.slice(0,10))return false;
  return allDay ? /^\d{4}-\d{2}-\d{2}$/.test(value) : /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function createEventsHandler({ fetchImpl = (...args) => fetch(...args), now = () => new Date(), requestTimeoutMs=8000, totalTimeoutMs=25000 } = {}) {
  return async function handler(req, res) {
    if (!requireAuth(req, res)) return;
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }
    const startedAt=Date.now();
    async function read(url,options={}) {
      const remaining=totalTimeoutMs-(Date.now()-startedAt);
      if(remaining<=0)throw new Error("Read deadline exceeded");
      const controller=new AbortController();let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("Read timed out"));},Math.min(requestTimeoutMs,remaining));});
      try {return await Promise.race([timeout,(async()=>{
        const result=await fetchImpl(url,{...options,signal:controller.signal});
        const data=await result.json();return {ok:result.ok,json:async()=>data};
      })()]);}finally{clearTimeout(timer);}
    }
    try {
      const instant = new Date(now());
      const fetchedAt = instant.toISOString();
      const redisResponse = await read(process.env.KV_REST_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(["GET", "google:refresh_token"]),
      });
      if (!redisResponse.ok) throw new Error("Connection read failed");
      const redisData = await redisResponse.json();
      if (redisData.error) throw new Error("Connection read failed");
      const refreshToken = redisData.result;
      if (!refreshToken) return res.status(401).json({ error: "Google Calendar is not connected." });
      if (typeof refreshToken !== "string") throw new Error("Connection read failed");
      const tokenResponse = await read("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || typeof tokenData.access_token !== "string" || !tokenData.access_token) throw new Error("Token refresh failed");
      const headers = { Authorization: `Bearer ${tokenData.access_token}` };
      const calendars = [];
      const calendarIds = new Set();
      const limitations = new Set();
      let pageToken = "";
      const listTokens = new Set();
      for (let page = 0; page < LIMITS.calendarPages; page++) {
        const params = new URLSearchParams({ maxResults: "250" });
        if (pageToken) params.set("pageToken", pageToken);
        let data;
        try {
          const response = await read(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`, { headers });
          data = await response.json();
          if (!response.ok || !data || (data.items !== undefined && !Array.isArray(data.items))) throw new Error("Calendar list failed");
        } catch {
          if (page === 0) throw new Error("Calendar list failed");
          limitations.add("CALENDAR_LIST_INCOMPLETE");
          break;
        }
        for (const calendar of data.items || []) {
          if (!calendar || typeof calendar.id !== "string" || !calendar.id) {
            limitations.add("CALENDAR_LIST_INCOMPLETE");
            continue;
          }
          if (calendar.selected === false || String(calendar.summary || "").toLowerCase().includes("holiday") || calendarIds.has(calendar.id)) continue;
          if (calendars.length >= LIMITS.calendars) { limitations.add("CALENDAR_LIMIT"); continue; }
          calendarIds.add(calendar.id);
          calendars.push(calendar);
        }
        if (!data.nextPageToken) break;
        if (typeof data.nextPageToken !== "string" || listTokens.has(data.nextPageToken)) {
          limitations.add("CALENDAR_LIST_INCOMPLETE"); break;
        }
        listTokens.add(data.nextPageToken);
        pageToken = data.nextPageToken;
        if (page === LIMITS.calendarPages - 1) limitations.add("CALENDAR_PAGE_LIMIT");
      }
      const timeMin = new Date(instant.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(instant.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const events = [];
      const failedCalendars = [];
      const completedCalendarIds = [];
      for (const calendar of calendars) {
        const sourceEvents = [];
        let sourceComplete = false;
        let sourceError = "READ_UNAVAILABLE";
        if (events.length >= LIMITS.events) {
          limitations.add("EVENT_LIMIT");
          failedCalendars.push({ id: calendar.id, name: calendar.summary || "", error: sourceError });
          continue;
        }
        let eventPageToken = "";
        const eventTokens = new Set();
        const eventIds = new Set();
        for (let page = 0; page < LIMITS.eventPages; page++) {
          const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
          if (eventPageToken) params.set("pageToken", eventPageToken);
          let data;
          try {
            const response = await read(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params}`, { headers });
            data = await response.json();
            if (!response.ok || !data || (data.items !== undefined && !Array.isArray(data.items))) throw new Error("Event read failed");
          } catch {
            break;
          }
          let capped = false;
          for (const event of data.items || []) {
            if (event?.status === "cancelled") continue;
            if (!event || typeof event.id !== "string" || !event.id || !validBoundary(event.start,Boolean(event.start?.date)) || !validBoundary(event.end,Boolean(event.start?.date)) || Date.parse(event.end.dateTime || event.end.date)<=Date.parse(event.start.dateTime || event.start.date)) {
              limitations.add("EVENT_DATA_INCOMPLETE"); capped = true; break;
            }
            if (eventIds.has(event.id)) continue;
            if (sourceEvents.length >= LIMITS.eventsPerCalendar || events.length + sourceEvents.length >= LIMITS.events) { capped = true; break; }
            eventIds.add(event.id);
            sourceEvents.push({
              id: event.id, calendarId: calendar.id, calendarName: calendar.summary || "",
              title: event.summary || "Untitled event", location: event.location || "",
              start: event.start.dateTime || event.start.date || null,
              end: event.end.dateTime || event.end.date || null,
              allDay: Boolean(event.start.date),
              startTimeZone: event.start.timeZone || "",
              endTimeZone: event.end.timeZone || "",
              calendarTimeZone: data.timeZone || calendar.timeZone || "",
            });
          }
          if (capped || ((sourceEvents.length >= LIMITS.eventsPerCalendar || events.length + sourceEvents.length >= LIMITS.events) && data.nextPageToken)) {
            limitations.add("EVENT_LIMIT"); break;
          }
          if (!data.nextPageToken) { sourceComplete = true; break; }
          if (typeof data.nextPageToken !== "string" || eventTokens.has(data.nextPageToken)) {
            break;
          }
          eventTokens.add(data.nextPageToken);
          eventPageToken = data.nextPageToken;
          if (page === LIMITS.eventPages - 1) limitations.add("CALENDAR_PAGE_LIMIT");
        }
        if (sourceComplete) {
          completedCalendarIds.push(calendar.id);
          events.push(...sourceEvents);
        } else {
          failedCalendars.push({ id: calendar.id, name: calendar.summary || "", error: sourceError });
        }
      }
      events.sort((a, b) => new Date(a.start) - new Date(b.start));
      const partial = failedCalendars.length > 0 || limitations.size > 0;
      return res.status(200).json({ connected: true, complete: !partial, partial, limited: limitations.size > 0, fetchedAt, calendarCount: calendars.length, calendars: calendars.map(calendar => ({ id: calendar.id, name: calendar.summary || "", timeZone: calendar.timeZone || "" })), completedCalendarIds, count: events.length, events, failedCalendars, limitations: [...limitations] });
    } catch {
      // Provider response content, token values and error objects must never be
      // emitted into diagnostics or returned to the client.
      return res.status(503).json({ error: "Could not load Google Calendar events." });
    }
  };
}

module.exports = createEventsHandler();
module.exports.createEventsHandler = createEventsHandler;
module.exports.LIMITS = LIMITS;
