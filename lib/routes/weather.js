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
    temperature_unit: 'fahrenheit'
  });
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error('Weather provider unavailable');
    const { current } = await response.json();
    if (!Number.isFinite(current?.temperature_2m) || !Number.isInteger(current?.weather_code)) {
      throw new Error('Invalid weather response');
    }
    return res.status(200).json({ current });
  } catch {
    return res.status(502).json({ error: 'Weather provider unavailable' });
  }
};
