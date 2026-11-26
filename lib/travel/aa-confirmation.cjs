'use strict';

// Format parser only. The caller must check provider-authenticated sender provenance
// before passing a bounded, fully decoded plain-text candidate. A forwarded From
// line, subject, matching locator, or successful parse is not an auth signal.
const months = 'January February March April May June July August September October November December'.split(' ');
const weekdays = 'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ');
const dayRE = new RegExp('^(' + weekdays.join('|') + '), (' + months.join('|') + ') (\\d{1,2}), (20\\d{2})$');
const nameRE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .,&'’()/-]{0,79}$/u;
const timeRE = /^(?:[1-9]|1[0-2]):[0-5][0-9] (?:AM|PM)$/;
const airportRE = /^[A-Z]{3}$/;
const flightRE = /^AA [1-9]\d{0,3}$/;
function dateFrom(m) {
  const d = new Date(Date.UTC(Number(m[4]), months.indexOf(m[2]), Number(m[3])));
  return d.getUTCMonth() === months.indexOf(m[2]) &&
    d.getUTCDate() === Number(m[3]) && weekdays[d.getUTCDay()] === m[1]
    ? d.toISOString().slice(0, 10) : null;
}
function parseAAConfirmation(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 128 * 1024) return null;
  const lines = body.split(/\r?\n/u).map(s => s.trim()).filter(Boolean);
  const indexes = lines.map((s,i) => /^Confirmation code: [A-Z0-9]{6}$/.test(s) ? i : -1).filter(i=>i>=0);
  if (indexes.length !== 1) return null;
  const start = indexes[0];
  const segments = [];
  for (let i=start+1; i<Math.min(start+120,lines.length); i++) {
    const day = lines[i].match(dayRE);
    if (!day || lines[i+1] !== '[airplane]') continue;
    const date = dateFrom(day);
    let j = i+2;
    if (/^\[https:\/\/www\.aa\.com\/content\/images\/email\/[a-z0-9./_-]+\]$/i.test(lines[j]||'')) j++;
    const [from, fromName, departure, flight, marker, to, toName, arrival] = lines.slice(j,j+8);
    if (!date || !airportRE.test(from||'') || !airportRE.test(to||'') || from===to ||
        !nameRE.test(fromName||'') || !nameRE.test(toName||'') ||
        !timeRE.test(departure||'') || !timeRE.test(arrival||'') ||
        !flightRE.test(flight||'') || marker !== '[destination]') return null;
    segments.push({date,from,fromName,departure,flight,to,toName,arrival});
    i=j+7;
  }
  // This adapter is intentionally limited to the tested direct overnight-return
  // layout. Route changes, cancellations, connections, and ambiguous receipts
  // remain in review pending a separate, tested interpretation.
  if (segments.length!==2) return null;
  const [a,b] = segments;
  if (a.date>=b.date || a.from!==b.to || a.to!==b.from) return null;
  const bookingReference=lines[start].slice('Confirmation code: '.length);
  return {
    carrier:'AA', bookingReference, start:a.date,end:b.date,destination:a.to,
    title:'Trip to '+a.toName, stops:segments.map(s=>s.flight+' · '+s.from+' '+s.departure+' → '+s.to+' '+s.arrival+' (local times)'),
    segments
  };
}
module.exports={parseAAConfirmation};
