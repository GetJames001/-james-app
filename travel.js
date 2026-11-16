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
  let selectedGroup = '';
  for(const button of section.querySelectorAll('[data-trip-group]')){
    button.onclick=()=>{
      selectedGroup=button.dataset.tripGroup;
      history.replaceState(null,'','#travel');
      show();
    };
  }
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
    if (trip.route) {
      const link = tag('a', 'Open original Drive Weather route');
      link.href = trip.route;
      link.rel = 'noreferrer';
      item.append(link);
    }
    return item;
  }
  const stopsGuide={
    Reno:{name:'Truckee Riverwalk',image:'road',coords:[39.52,-119.81]},
    Bend:{name:'Drake Park & Mirror Pond',image:'travel',coords:[44.06,-121.32]},
    Eugene:{name:'Fifth Street Public Market',image:'eugene',coords:[44.05,-123.09]}
  };
  const mapLink=query=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(query);
  let guideTrip=null,guideDay='',guideSequence=0;
  const sightsCache=new Map();
  function makeGuideCard(title,description,image,query,nearby=false){
    const link=tag('a','');link.className='mag-tile';link.href=mapLink(query);link.target='_blank';link.rel='noopener noreferrer';
    const img=document.createElement('img');img.src='assets/lifestyle/'+image+'.jpg';img.alt='';img.loading='lazy';
    const label=tag('span',title);label.append(tag('small',description));
    if(nearby)label.prepend(tag('small','Near you'));
    link.append(img,label,tag('i','→'));return link;
  }
  async function renderGuide(trip,today){
    const generation=++guideSequence;
    guideTrip=trip;guideDay=today;
    const host=document.getElementById('tripPlaces'),wrap=document.getElementById('tripGuide'),jump=document.getElementById('tripGuideJump');
    const end=trip?.destination||trip?.title?.match(/(?:^|\s)to\s+(.+?)(?:\s+[·–-]\s+driving)?$/i)?.[1];
    const road=Boolean(trip?.route||trip?.mode==='driving');
    wrap.hidden=jump.hidden=!trip||(!road&&!end);
    if(wrap.hidden){host.replaceChildren();return;}
    jump.textContent=road?'Along the way':'In town';
    document.getElementById('tripGuideTitle').textContent=road?'Along the way':'While in '+end;
    if(road){
      const stops=[];
      for(const line of trip.stops){
        for(const match of line.matchAll(/(?:overnight[^.]{0,90}? in |stop in )([A-Z][a-z]+(?: [A-Z][a-z]+)*)/g)){
          if(!stops.includes(match[1]))stops.push(match[1]);
        }
      }
      if(end&&!stops.includes(end))stops.push(end);
      const pos=tripGroup(trip,today)==='Current trips'?window.jamesLocation?.point():null;
      const cards=stops.map(city=>{
        const known=stopsGuide[city];
        const close=pos&&known&&Math.hypot((pos.latitude-known.coords[0])*111,(pos.longitude-known.coords[1])*111*Math.cos(pos.latitude*Math.PI/180))<20;
        return makeGuideCard(city,known?.name||'Explore this stop',known?.image||'road',(known?.name||'Things to see')+' in '+city,close);
      });
      host.replaceChildren(...cards);wrap.hidden=jump.hidden=!cards.length;return;
    }
    let names;
    if(/^Chicago(?:,|$)/i.test(end))names=['Millennium Park','Art Institute of Chicago','Chicago Riverwalk'];
    else{
      host.replaceChildren(tag('p','Finding sights…'));
      try{
        if(!sightsCache.has(end)){
          const response=await fetch('/api/lifestyle/feed?source=sights&city='+encodeURIComponent(end));
          if(!response.ok)throw Error();
          const data=await response.json();
          if(data.items.length)sightsCache.set(end,data.items);
        }
        names=sightsCache.get(end)||[];
      }catch{names=[];}
    }
    if(generation!==guideSequence)return;
    host.replaceChildren(...names.slice(0,3).map((name,i)=>makeGuideCard(name,end,['travel','eugene','road'][i],name+' in '+end)));
    if(!names.length)host.replaceChildren(makeGuideCard('Explore '+end,'Find local attractions','travel','attractions in '+end));
  }
  window.addEventListener('james:trip-location',()=>{if(section.classList.contains('active')&&guideTrip?.route)void renderGuide(guideTrip,guideDay);});
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
    const notes=[];
    for(const stop of trip.stops){
      const overnight=stop.match(/overnight\b[^.]{0,75}?\bin ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/);
      const pause=stop.match(/stop in ([A-Z][a-z]+(?: [A-Z][a-z]+)*) for (\d+ hours?)/i);
      if(overnight)notes.push('Overnight in '+overnight[1]);
      if(pause)notes.push(pause[2]+' in '+pause[1]);
    }
    const routeTitle=trip.title.match(/^(.+?)\s+to\s+(.+?)(?:\s+[·–-]\s+driving)?$/i);
    if(routeTitle && trip.route){
      const stops=[routeTitle[1]];
      for(const stop of trip.stops){
        const city=stop.match(/overnight\b[^.]{0,75}?\bin ([A-Z][a-z]+(?: [A-Z][a-z]+)*)/) || stop.match(/stop in ([A-Z][a-z]+(?: [A-Z][a-z]+)*) for \d+ hours?/i);
        if(city && !stops.includes(city[1]))stops.push(city[1]);
      }
      if(!stops.includes(routeTitle[2]))stops.push(routeTitle[2]);
      const route=tag('span',stops.join('  →  '));route.className='route-stops';link.append(route);
    }
    if(notes.length)link.append(tag('span',notes.slice(0,2).join(' · ')));
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
      void renderGuide(null,'');
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
      const groups=trips.map(trip=>tripGroup(trip,today));
      const opened=trips.find(trip=>location.hash==='#travel/'+trip.id);
      const chosen=opened?tripGroup(opened,today):selectedGroup||(groups.includes('Current trips')?'Current trips':groups.includes('Upcoming trips')?'Upcoming trips':'');
      void renderGuide(opened||trips.find(t=>tripGroup(t,today)===chosen)||(!chosen?trips[0]:null),today);
      section.querySelectorAll('[data-trip-group]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tripGroup===chosen)));
      if(selectedGroup&&!opened&&!groups.includes(selectedGroup))panel.append(tag('p',selectedGroup==='Current trips'?'No trip in progress.':'No upcoming trips.'));
      for (const group of ['Current trips','Upcoming trips','Started · end date open','Past trips']) {
        const items = trips.filter(trip => tripGroup(trip,today) === group);
        if(chosen && group!==chosen && (selectedGroup || ['Current trips','Upcoming trips'].includes(group)))continue;
        if (group === 'Past trips') items.reverse();
        if (items.length) panel.append(tag('h3',group), ...items.map(trip => location.hash === "#travel/" + trip.id ? card(trip) : cover(trip)));
      }
      if (location.hash.startsWith('#travel/')) document.getElementById('trip-' + location.hash.slice(8))?.scrollIntoView({block:'start'});
      if (!trips.length && !selectedGroup) panel.append(tag('p','No trips saved yet.'));
    } catch {
      if (seq !== request) return;
      if (tileStatus) {
        tileStatus.textContent = 'Trips unavailable';
        tileStatus.closest('button').classList.remove('has-trip');
      }
      if(travelOpen)void renderGuide(null,'');
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
