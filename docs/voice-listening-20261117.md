# Voice listening failure follow-up — November 17, 2026

Michael reports Listening with no question or reply text. This does not establish an ElevenLabs output fault; the microphone-to-Realtime path remains the first device check.

Changes: surface correlated provider request errors, failed responses and turn timeouts to the host; close the microphone with actionable status instead of silently waiting. Ignore expected cancellation and stale request errors. Watch initial outbound audio metadata and ended tracks; distinguish no outgoing audio from no detected speech. No raw microphone capture is added. Allow up to 12 tool calls per response so five city forecasts can complete; preserve turn correlation and no automatic paid retries.

Automated verification: targeted coordinator checks cover current vs stale failures, cancellation, timeout and five forecast calls. Browser coverage adds zero outbound packets, no detected speech with packets present, quota errors, and correlated transcription failure. Full branch CI must complete after this commit. Synthetic media/provider tests do not establish physical iPad/Android microphone or Archer audibility.

Live inspection reached James sign-in. Vercel connector runtime logs returned 403 for this project. No credentials changed and no billing action taken. Exact cause of Michael's physical-device failure is not yet confirmed.

Drive Weather: user reports two years of phone-app access. Official support and road-weather API pages describe the app account and a separate contact-based API; app purchase alone is not verified API access. Existing app-share route still unverified, not a connected API. No invented URI scheme, vendor inquiry, new purchase or key request. Continue using saved James itinerary for city/date forecasts and maps actions, clearly separate from Drive Weather.

Sources: https://driveweatherapp.com/support/ ; https://driveweatherapp.com/road-weather-api/ ; https://developers.openai.com/api/docs/guides/realtime-vad ; https://developers.openai.com/api/reference/resources/realtime/server-events
