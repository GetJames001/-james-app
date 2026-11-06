# Concierge feedback: orb, location, voice panel and greeting

Continue the existing James build. Marin remains selected; no new voice provider, API key, purchase or video render. Full-app facelift remains a separate staged visual review, preserving Customer Information, Workbench, Mail and Calendar.

## Orb and controls

Michael rejected the older fiery orb, extra halo and detached activity dot. Existing dashboard references show a smooth gold/amber core, navy body and blue rim. Replace only the persistent in-app orb with a small native SVG treatment of that direction; remove the detached dot. Keep restrained phase feedback and reduced-motion support. The SVG is explicitly authenticated/allowlisted and included in the Vercel function package. Accepted entrance assets are unchanged.

Move voice choices, sample link and API/session-limit information into a separate Voice settings dialog. The active conversation panel retains status, transcript, AI-voice disclosure, mute, Stop reply and Close voice. No ElevenLabs wiring.

## Location and daylight

Existing geolocation/weather plumbing was present, but voice context only had display text. The existing weather provider now returns local-date sunrise/sunset and timezone when supplied. Provider/current weather remains usable if daylight is unavailable. App weather reference carries status, check time and rounded approximate coordinates; both voice and typed context can read it. Voice has a read_weather tool grounded in this reference. Current, last-known, denied, unknown and stale states remain distinct. Weather coordinates do not establish a verified routing origin/address, travel times or live traffic. Sunrise/sunset from a prior local date is explicitly stale.

Use my location/Update location stays visible in the Briefing weather area. Voice lookup itself never prompts for browser location. Only the existing permission flow obtains coordinates. Coordinates sent for weather are rounded to2 decimals. No reverse geocoding, routing provider or Calendar writes are introduced.

## Response speed

Current-information voice answers delegate to the existing text/search backend, then return to the live voice response. This adds serial work versus a simple spoken math answer. Preserve current-information search, configured model and identity checks. Request a concise spoken-first summary with a300-token output budget for voice research; typed answers retain800. Active-session diagnostics expose only phase and last research duration in milliseconds, never question/answer/location/token contents. No live latency benchmark was run; do not promise two-second researched valuations or claim measured improvement.

## Greeting clarification

Michael wants a generated, varied natural welcome offering the briefing, never an unsolicited rundown. The existing first voice-session prompt is changed accordingly; full read_briefing remains on request. Account/day-scoped local suppression prevents same-day voice reconnects from repeating the welcome. The saved guard records a welcome attempt, not proof that audio was heard. It is not a fixed recording.

Automatic post-login audio has not been enabled: voice still starts through the existing Talk/orb action. Browser autoplay/microphone permissions and exact transition timing need separate opt-in/device verification. Do not open the microphone silently or change the accepted entrance to force speech. Quick returns and navigation remain quiet.

## Validation

80 focused checks and5 browser flows passed. Coverage includes rounded/freshness-aware weather context, unknown/last-known location, local daylight provider requests, voice tool allowlist, concise-research budget while retaining search, authenticated SVG serving/packaging, no detached dot, settings separation, weather tool output, welcome attempt suppression, connection recovery, reduced motion, conversation isolation/End and automatic mail regression. Browser media/provider are synthetic. Real iPad location, new orb appearance, actual sunrise/sunset speech and researched response latency still need Michael's test.
