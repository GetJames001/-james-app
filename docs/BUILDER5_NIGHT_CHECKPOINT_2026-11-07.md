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
