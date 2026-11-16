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
  const tileStatus = document.getElementById('briefingTravelStatus');
  const suffix = '.james-trip.json';
  let request = 0;
  let savedTrips = [];
  let cache = new Map();
  const tripEnd = trip => trip.end || trip.start;
  function tripsOn(date) {
    return savedTrips.filter(trip => trip.start <= date && tripEnd(trip) >= date);
  }
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
    if (trip.id) item.id = 'trip-' + trip.id;
    for (const stop of trip.stops) {
      if (/^The original Drive Weather route shows .+ and omits .+\.$/i.test(stop.trim())) continue;
      item.append(tag('p', stop.replace(/Leave Sunstone, Las Vegas\b/i,'Leave Northwest Las Vegas')));
    }
    const stops=trip.stops.join(' ');
    const places=[['Reno','https://www.visitrenotahoe.com/'],['Bend','https://visitbend.com/'],['Eugene','https://www.eugenecascadescoast.org/'],['Chicago','https://www.choosechicago.com/']].filter(([name])=>new RegExp('\\b'+name+'\\b','i').test(trip.title+' '+stops));
    if(places.length){
      const aside=tag('section','');aside.className='trip-guides';aside.append(tag('h4',trip.route?'Along the way':'While you’re in town'));
      for(const [name,url] of places){const link=tag('a',name);link.href=url;link.target='_blank';link.rel='noopener noreferrer';aside.append(link);}
      item.append(aside);
    }
    if (trip.route) {
      const link = tag('a', 'Open original Drive Weather route');
      link.href = trip.route;
      link.rel = 'noreferrer';
      item.append(link);
    }
    return item;
  }
  function tripLink(trip) {
    const link = tag('a', trip.title + (trip.route ? ' · Driving' : '') + ' · ' + displayDate(trip.start));
    link.href = '#travel/' + trip.id;
    link.className = 'trip-link';
    link.onclick = event => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      history.pushState(null, '', link.hash);
      window.jamesPageNow('travel');
    };
    return link;
  }
  function cover(trip){
    const link=tripLink(trip);link.replaceChildren(tag('strong',trip.title),tag('span',displayDate(trip.start)+(trip.end?' – '+displayDate(trip.end):'')));
    link.append(tag('small','Open itinerary →'));return link;
  }
  window.jamesTripCalendar = {tripsOn, tripLink};
  async function show() {
    const travelOpen = section.classList.contains('active');
    const briefing = document.getElementById('briefing');
    if (!travelOpen && !briefing?.classList.contains('active') &&
        !document.getElementById('appointments')?.classList.contains('active')) return;
    const seq = ++request;
    if (travelOpen && location.hash.startsWith('#trip?')) {
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
    if (travelOpen) panel.replaceChildren(tag('p','Loading trips…'));
    try {
      const {files} = await list();
      const trips = await Promise.all(files.filter(f => f.name.endsWith(suffix)).map(async f => {
        if (cache.has(f.id)) return cache.get(f.id);
        const file = await read(f.id);
        const trip = JSON.parse(await file.text());
        if (!validTrip(trip)) throw Error('Invalid saved trip');
        return {...trip, id:f.id};
      }));
      if (seq !== request) return;
      const now = new Date();
      const today = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
      trips.sort((a,b) => a.start.localeCompare(b.start));
      if (tileStatus) {
        const cutoff = shiftAppointmentDate(today,7);
        const active = trips.filter(trip => trip.start <= today && tripEnd(trip) >= today);
        const upcoming = trips.filter(trip => trip.start > today && trip.start <= cutoff);
        const relevant = [...active,...upcoming];
        const first = relevant[0];
        const date = first && new Date(first.start+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
        const label = active.length ? 'Traveling now' : first ? 'Upcoming · '+date : 'Your trips';
        tileStatus.textContent = label + (relevant.length > 1 ? ' · +'+(relevant.length-1) : '');
        tileStatus.closest('button').classList.toggle('has-trip',Boolean(first));
      }
      savedTrips = trips;
      cache = new Map(trips.map(trip => [trip.id,trip]));
      document.getElementById('todayTripLinks')?.replaceChildren(...tripsOn(today).map(tripLink));
      renderQuickCalendar();
      renderAppointmentView();
      if (!travelOpen) return;
      panel.replaceChildren();
      for (const group of ['Current trips','Upcoming trips','Started · end date open','Past trips']) {
        const items = trips.filter(trip => tripGroup(trip,today) === group);
        if (group === 'Past trips') items.reverse();
        if (items.length) panel.append(tag('h3',group), ...items.map(trip => location.hash === "#travel/" + trip.id ? card(trip) : cover(trip)));
      }
      if (location.hash.startsWith('#travel/')) document.getElementById('trip-' + location.hash.slice(8))?.scrollIntoView({block:'start'});
      if (!trips.length) panel.append(tag('p','No trips saved yet.'));
    } catch {
      if (seq !== request) return;
      if (tileStatus) {
        tileStatus.textContent = 'Trips unavailable';
        tileStatus.closest('button').classList.remove('has-trip');
      }
      if (travelOpen) panel.replaceChildren(tag('p','James could not load your trips. Reopen Travel to retry.'));
    }
  }
  function isTravelLink() {
    return location.hash === '#travel' || location.hash.startsWith('#travel/') || location.hash.startsWith('#trip?');
  }
  function launch() {
    if (isTravelLink()) window.jamesPageNow('travel');
  }
  let wasInTravel = section.classList.contains('active');
  window.addEventListener('james:page-changed', () => {
    const inTravel = section.classList.contains('active');
    if (wasInTravel && !inTravel && isTravelLink()) {
      history.replaceState(history.state, '', location.pathname + location.search);
    }
    wasInTravel = inTravel;
    show();
  });
  window.addEventListener('hashchange', launch);
  window.addEventListener('pageshow', show);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) show(); });
  if (isTravelLink()) setTimeout(launch,0);
  else show();
}
if (typeof module !== 'undefined') module.exports = {tripDate, validTrip, tripGroup};
