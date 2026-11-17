# Saved-trip voice and road-trip forecasts

Michael reported that asking about the Oregon road trip returned no routes, and the original Drive Weather share link opened a 404. The existing voice `read_route` only knew about Next Appointment driving estimates. It never read saved Travel files.

## Changes

- `read_trips` loads account-backed `.james-trip.json` itineraries from any James page. Dates, stops, provenance and ready/partial/stale/unavailable states are returned. Encoded app-share payloads are omitted from model context.
- `read_forecast` resolves a city/region and country with Open-Meteo, then retrieves its daily forecast for the requested travel date. Ambiguous places, missing values, provider failures and dates outside the forecast window remain explicit. It does not treat current local weather as trip weather.
- Itinerary directions open Google Maps one leg at a time, retaining intermediate `via` and stop cities and the user-entered final destination. Maps chooses roads; these links do not preserve the external app's exact route geometry or promise current traffic. They are not navigation inside James.
- Original Drive Weather URLs remain preserved under Saved Drive Weather link. They are app-share references, not a working data integration. No guessed deep-link scheme or redirected route payload was introduced.
- Michael confirmed paying for ElevenLabs on November 17. Archer activation defaults on only for combined Preview `fix/calendar-refresh-diagnosis-20261031`, only with the existing secret key. An explicit `JAMES_ARCHER_ENABLED=false` disables it. Production and other previews remain opt-in. No key, credit cap, model or subscription was changed.

## Evidence and limits

- Local targeted checks: 18 passing (trip state, directions, forecast dates/units/errors, voice access, Archer scope). Syntax checks passed.
- Live public provider smoke: Las Vegas and Reno on November 22; Klamath Falls, Bend and Eugene on November 23 all returned ready with all requested fields. This is not evidence of a complete road/pass forecast or safe driving conditions.
- Browser test adds saved-trip and dated-forecast tool continuation, including malformed-argument rejection. Local Chromium cannot launch because the workspace blocks its process singleton socket; full browser checks must run in existing GitHub CI before device handback.
- Authenticated Preview speech readiness, actual paid Archer output and device playback still need confirmation. Current speech remains buffered; streaming delivery work remains open.
- Direct Drive Weather API access is not connected. The official page offers a separate contact-based API; no evidence says a consumer Pro subscription includes it. No inquiry, purchase or additional subscription was sent/created.

Sources reviewed: https://driveweatherapp.com/road-weather-api/ ; https://open-meteo.com/en/docs ; https://open-meteo.com/en/docs/geocoding-api ; https://developers.google.com/maps/documentation/urls/get-started

Next focused device check, only after CI and Preview are ready: refresh James, select Archer if needed, and ask for weather along the saved Oregon road trip. Confirm the saved trip is recognized and the spoken reply completes. Navigation and interruption are separate subsequent checks.
