const { personalMailbox } = require('./compose.js');

module.exports = async function readCalendar(token, res) {
  const origin = 'https://graph.microsoft.com';
  const headers = { Authorization: 'Bearer ' + token, Prefer: 'outlook.timezone="UTC"' };
  const signal = AbortSignal.timeout(12000);
  const read = async url => {
    const response = await fetch(url, { headers, signal, redirect: 'error' });
    if (!response.ok) throw Object.assign(Error('Outlook calendar unavailable'), { status: response.status });
    return response.json();
  };
  try {
    const profile = await read(origin + '/v1.0/me?$select=mail,userPrincipalName');
    if ((profile.mail || profile.userPrincipalName || '').toLowerCase() !== personalMailbox) {
      return res.status(403).json({ error: 'PERSONAL_MAILBOX_REQUIRED' });
    }
    const day = 86400000, now = Date.now();
    const first = new URL(origin + '/v1.0/me/calendarView');
    first.search = new URLSearchParams({
      startDateTime: new Date(now - day).toISOString(),
      endDateTime: new Date(now + 90 * day).toISOString(),
      '$select': 'id,iCalUId,subject,start,end,isAllDay,isCancelled,location',
      '$top': '100'
    });
    const events = [];
    let next = first;
    const visited = new Set();
    while (next && visited.size < 15) {
      if (next.origin !== origin || next.pathname.toLowerCase() !== '/v1.0/me/calendarview' || visited.has(next.href)) {
        throw Error('Unexpected Outlook calendar page');
      }
      visited.add(next.href);
      const page = await read(next);
      for (const item of page.value) {
        if (item.isCancelled) continue;
        const boundary = value => item.isAllDay ? value?.slice(0, 10) : new Date(value + 'Z').toISOString();
        events.push({
          id: item.id, iCalUID: item.iCalUId, title: item.subject, location: item.location?.displayName,
          calendarId: 'outlook-personal', calendarName: 'Hotmail',
          start: boundary(item.start?.dateTime), end: boundary(item.end?.dateTime), allDay: !!item.isAllDay
        });
      }
      next = page['@odata.nextLink'] ? new URL(page['@odata.nextLink']) : null;
    }
    return res.status(200).json({ events, complete: !next });
  } catch (error) {
    const consent = [401, 403].includes(error.status);
    return res.status(consent ? 403 : 502).json({ error: consent ? 'CALENDAR_PERMISSION_REQUIRED' : 'OUTLOOK_CALENDAR_UNAVAILABLE' });
  }
};
