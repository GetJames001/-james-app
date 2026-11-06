const { requireAuth } = require('../auth.js');

module.exports = async function weather(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  if (!requireAuth(req, res)) return;

  const { latitude, longitude } = req.query;
  const valid = (value, limit) =>
    typeof value === 'string' && value.trim() !== '' &&
    Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;
  if (!valid(latitude, 90) || !valid(longitude, 180)) {
    return res.status(400).json({ error: 'Invalid weather location' });
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: Number(latitude).toFixed(2),
    longitude: Number(longitude).toFixed(2),
    current: 'temperature_2m,weather_code',
    temperature_unit: 'fahrenheit',
    daily: 'sunrise,sunset',
    timezone: 'auto',
    forecast_days: '1'
  });
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error('Weather provider unavailable');
    const { current,daily,timezone } = await response.json();
    if (!Number.isFinite(current?.temperature_2m) || !Number.isInteger(current?.weather_code)) {
      throw new Error('Invalid weather response');
    }
    const localTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value);
    let daylight={status:'unavailable'};
    if(typeof timezone==='string'&&timezone.length<=100&&/^\d{4}-\d{2}-\d{2}$/.test(daily?.time?.[0])&&localTime(daily?.sunrise?.[0])&&localTime(daily?.sunset?.[0])&&daily.sunrise[0].startsWith(daily.time[0])&&daily.sunset[0].startsWith(daily.time[0])){
      try{new Intl.DateTimeFormat('en-US',{timeZone:timezone});daylight={status:'ready',date:daily.time[0],sunrise:daily.sunrise[0],sunset:daily.sunset[0],timezone};}catch{}
    }
    res.setHeader('Cache-Control','private, no-store');
    return res.status(200).json({ current,daylight });
  } catch {
    return res.status(502).json({ error: 'Weather provider unavailable' });
  }
};
