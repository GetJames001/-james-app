'use strict';

function tripDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function validTrip(trip) {
  if (!trip || typeof trip.title !== 'string' || !trip.title.trim() || trip.title.length > 120 ||
      !tripDate(trip.start) || (trip.end && (!tripDate(trip.end) || trip.end < trip.start)) ||
      !Array.isArray(trip.stops) || !trip.stops.length || trip.stops.length > 20 ||
      !trip.stops.every(stop => typeof stop === 'string' && stop.length > 0 && stop.length <= 500)) return false;
  if (!trip.route) return true;
  try {
    const url = new URL(trip.route);
    return url.origin === 'https://driveweatherapp.com' && !url.username && !url.password &&
      url.pathname === '/download' && url.searchParams.has('data') && trip.route.length < 12000;
  } catch { return false; }
}

function tripGroup(trip, today) {
  if (trip.start > today) return 'Upcoming trips';
  if (trip.end && trip.end < today) return 'Past trips';
  if (!trip.end && trip.start < today) return 'Started · end date open';
  return 'Current trips';
}

function mountTravel({list, read, save}) {
  const panel = document.getElementById('travelCards');
  if (!panel) return;
  const section = document.getElementById('travel');
  const suffix = '.james-trip.json';
  let request = 0;
  const tag = (name, text) => {
    const node = document.createElement(name);
    node.textContent = text;
    return node;
  };
  const displayDate = value => new Date(value + 'T12:00:00').toLocaleDateString(undefined,
    {weekday:'short', month:'short', day:'numeric', year:'numeric'});
  function card(trip) {
    const item = document.createElement('article');
    item.append(tag('h4', trip.title), tag('p', displayDate(trip.start) + ' – ' + (trip.end ? displayDate(trip.end) : 'End date open')));
    trip.stops.forEach(stop => item.append(tag('p', stop)));
    if (trip.route) {
      const link = tag('a', 'Open original Drive Weather route');
      link.href = trip.route;
      link.rel = 'noreferrer';
      item.append(link);
    }
    return item;
  }
  async function show() {
    if (!section.classList.contains('active')) return;
    const seq = ++request;
    if (location.hash.startsWith('#trip?')) {
      const fields = new URLSearchParams(location.hash.slice(5));
      const trip = {title:fields.get('title'), start:fields.get('start'), end:fields.get('end') || '',
        stops:fields.getAll('stop'), route:fields.get('route') || ''};
      if (!validTrip(trip)) { panel.replaceChildren(tag('p','This trip link is incomplete.')); return; }
      const button = tag('button', 'Save trip');
      button.type = 'button';
      const status = tag('p','');
      button.onclick = async () => {
        button.disabled = true;
        try {
          await save(new File([JSON.stringify(trip)], 'itinerary' + suffix, {type:'application/json',lastModified:0}));
          history.replaceState(null,'','#travel');
          await show();
        } catch { status.textContent = 'James could not save this trip. Try again.'; button.disabled = false; }
      };
      panel.replaceChildren(card(trip), button, status);
      return;
    }
    panel.replaceChildren(tag('p','Loading trips…'));
    try {
      const {files} = await list();
      const trips = await Promise.all(files.filter(f => f.name.endsWith(suffix)).map(async f => {
        const file = await read(f.id);
        const trip = JSON.parse(await file.text());
        if (!validTrip(trip)) throw Error('Invalid saved trip');
        return trip;
      }));
      if (seq !== request) return;
      const now = new Date();
      const today = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
      panel.replaceChildren();
      trips.sort((a,b) => a.start.localeCompare(b.start));
      for (const group of ['Current trips','Upcoming trips','Started · end date open','Past trips']) {
        const items = trips.filter(trip => tripGroup(trip,today) === group);
        if (group === 'Past trips') items.reverse();
        if (items.length) panel.append(tag('h3',group), ...items.map(card));
      }
      if (!trips.length) panel.append(tag('p','No trips saved yet.'));
    } catch {
      if (seq === request) panel.replaceChildren(tag('p','James could not load your trips. Reopen Travel to retry.'));
    }
  }
  function launch() {
    if (location.hash === '#travel' || location.hash.startsWith('#trip?')) window.jamesPageNow('travel');
  }
  window.addEventListener('james:page-changed', show);
  window.addEventListener('hashchange', launch);
  window.addEventListener('pageshow', show);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) show(); });
  if (location.hash === '#travel' || location.hash.startsWith('#trip?')) setTimeout(launch,0);
  else show();
}
if (typeof module !== 'undefined') module.exports = {tripDate, validTrip, tripGroup};
