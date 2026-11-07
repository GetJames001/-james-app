# Builder 5 checkpoint — November 6 evening, Las Vegas

## Preserve

Working branch: `fix/calendar-refresh-diagnosis-20261031`. Production is untouched. Preserve approved entrance scenes and positioning, Marin, Calendar reading, separately approved Calendar creation, Gmail read-only, primary Hotmail, Customer Information, Workbench, existing clothes and their originals. No new credentials, image credits or deployment deletions are authorized by this checkpoint.

## Verified before tonight's final increment

Michael passed location/routing, then live appointment creation for Fontainebleau and Albertsons. Direct Google Places checks returned Dairy Queen branches and Albertsons at 6730 N Hualapai Way. A subsequent Routes call still worked after Places API was added to the existing key. Test departure locations were cleared. Existing Calendar/Gmail credentials were not replaced.

## Tonight's increment

- Explicit live-location option while James is visible. Precise coordinates stay in memory, are cleared on hide/page exit, and are sent directly to Google Maps only for requested nearby searches and routing. Only the opt-in preference persists. No background tracking, home inference or location from profile/timezone.
- Nearby Places uses a fresh accurate device point. Explicit named city/area bypasses the device bias. No fixed Las Vegas or US boundary. Both voice and typed research use the same Places adapter. Typed provider requests do not contain device coordinates. Ordinary questions retain the single provider call; Places tool calls add a bounded lookup/continuation within the existing deadline.
- Live position can supply the routing origin unless an explicit departure address was chosen. A meaningful movement invalidates the old estimate. Traffic estimates still require an explicit estimate request; automatic periodic traffic refresh is not included.
- Timed reminders have a separate owner/branch store with compare-and-swap updates and duplicate-create protection. Existing Task Pad and Calendar are unchanged. Reminders have a title and due time, no invented venue or duration. Due alerts while James is open offer Done/Snooze; My Tasks also offers rescheduling. Missed reminders remain due on return. Voice can create/read reminders; text research does not execute reminder or Calendar writes.

## Next session — ordered work

1. Review Michael's live-location/typed-chat and timed-reminder acceptance. Closed-app reminders need a separate push/delivery design; do not promise them from browser timers.
2. Integrate James Wardrobe into navigation and Briefing with useful outfit/day context, then apply the approved spacious navy/gold direction. Current `index.html`/`app.js` contain no Wardrobe connection. Recovered source exists at `recovered-voice/corrected/run/source/review-source/rue-current.html`, with `account-wardrobe.js`, `editorial-card.js`, `editorial-cutout.js` and video intake. The account store uses `/api/rue/wardrobe` and authenticated photo endpoints with revision-aware saving and guarded legacy migration. It is not just local sample cards. Verify the current private closet and identity before integrating; never transplant private images by copying browser cache.
3. Compare every current James module with the approved full-screen spacious references. Consolidate navigation and remove redundant controls; move voice transcript, samples/settings and diagnostics off the main canvas. Preserve functional modules. Finance, Health/appointments and Personal Development remain in the plan. No empty cards just for decoration.
4. Measure voice/research timings before optimizing. Protect conversation identity checks; don't remove authentication to save latency. Separate basic answer time from current-information search. No two-second claim without measurement.
5. Wardrobe photo quality: preserve originals, verify Google-style clean garment cards against actual clothes; existing ISNet cutout is not body-to-garment reconstruction. Audit before paying for image generation.
6. Resume the existing disabled PR74 closed-app mail worker when secure provisioning is available. User approved activation; Vercel connector repeatedly returned empty projects/404/403 despite browser access. No worker/key/cron was activated. Do not repeat connection-consent loops.
7. Closet wall display: existing accepted ambient concept; trusted-device opt-in and wake/notification support need verification. No always-listening or password removal by implication.
8. Complete the broader integration inventory: travel itineraries to reviewed Calendar entries, Attention/task ownership, Workbench/files/customer linking, Finance/Health/Development. Maintain one James assistant.

## Known limits / risks

- Existing legacy `/api/tasks` replaces the whole shared Task Pad and lacks conflict protection. The new timed-reminder store is separate so it cannot overwrite those tasks. Audit/migrate the legacy API later.
- Live location cannot reliably run with the web app closed or suspended by iPadOS. Resume only with granted permission; don't infer an active position from a stale cache.
- Current photo/card and AARU sources are recovered snapshots. Compare with the latest source before implementing the Wardrobe bridge.
- Preview readiness is not Production approval. Keep working rollback links and deployment history. Vercel cleanup requires identified candidates and separate deletion approval.

## Wall Display increment — review next morning

Built as an opt-in mode under Settings → Display mode, with Regular and Wall display. Reuses existing still JPEGs from five approved entrance scenes; no videos were converted/rerendered, no new imagery or credits used. Background picker includes Waterfront morning/evening/night, Moonlit Forest and Aurora from Orbit. Personal photo upload/slideshow and motion backgrounds are not included.

Ambient mode shows time, date, existing weather/next appointment, and Today / Explore / Reminders. Existing due-reminder alert cards remain above the ambient view until Done/Snooze/Reschedule. A tap returns to the app or starts the existing voice flow; after 30/60/180 seconds of inactivity, it returns to ambient when no voice session or review dialog is active. Existing entrance/authentication and regular mode are preserved.

Screen Wake Lock is requested while Wall mode is visible, released on hide/exit/Regular mode, and reacquired on foreground return when the browser permits it. Evening dimming is a visual dim from 8 PM to 7 AM, not system brightness or ambient-light sensing. Room-light sensor integration remains unconnected. Wall mode does not remove sign-in or prevent the OS from suspending the browser; session checks retain the existing authentication boundary.

Hey James is a separate opt-in local-only recognition path. Requires browser support for SpeechRecognition.processLocally and local availability; unsupported browsers retain tap-to-wake. A local language-pack download can be initiated explicitly from settings. No cloud recognition fallback; no paid voice session is held open as a wake listener. Local microphone abort/end is confirmed before opening the existing realtime voice connection. Listening pauses on hidden/active conversation and stops in Regular mode. Commands spoken in the same breath as the wake phrase are not buffered; repeat after the normal conversation connects. Browser autoplay/permission restrictions can still require a tap.

Validation before deployment: 30 focused checks and three browser flows passed, including synthetic local-recognition/wake-lock handoff, persistent reminder cards, evening dimming, idle return, foreground pause/reacquire, Regular-mode cleanup, existing voice and mail refresh. Real always-on reliability, wake-phrase sensitivity, room noise and playback on Michael's actual wall-tablet make/model/OS/browser remain a next-morning device test. Do not claim Google Home-equivalent hardware wake from locked/suspended tablet state.


## Wall conversation correction — local only
Michael clarified that waking the wall tablet must keep it on the wall screen. Updated the existing wall overlay to show spoken questions and streamed answers, plus typed follow-ups through the existing James conversation service. No automatic Daily Briefing navigation on wake or background tap. Explicit tiles/page navigation still open the full James page. Back to ambient clears the wall text; inactivity returns to ambient only when no request is pending and voice is not connecting, thinking or speaking. Due reminder alerts remain above the wall screen.

Publishing remains blocked after the prior GitHub create-tree request was rejected. No retry, new remote commit, PR, deployment or Production change was attempted. The shared preview does not contain this wall build. Real tablet microphone/wake-phrase support still needs device testing; automated speech tests use fixtures, not live microphones.

Validation: 30 focused wake/auth/voice-route checks and 3 browser flows passed, including wall-only voice text, typed follow-up, ambient inactivity, explicit navigation, persistent reminders, dimming, wake-lock cleanup, regular voice across pages and automatic mail refresh.
