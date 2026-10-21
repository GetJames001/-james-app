# James — Proactive Day Orchestration and Customer Activity
Status: User-approved product behavior; implementation backlog. No live location access, proactive notifications, CRM import, Odoo sync, or voice-to-record persistence is implied by this document.
Owner: James (one assistant and one continuous conversation).
Last clarified: 2026-10-21.

## Core promise
James should continuously reconcile what matters in the user's day: verified fixed appointments, customer opportunities, callbacks, proposals, email deadlines, open tasks and available time. The user should not have to remember to open a separate Customer Activity dashboard or manually assemble the day's plan.

The Daily Briefing remains the existing home. A discreet Customer Activity link opens a large floating workspace without navigation. Closing it returns to the same briefing state. The same conversational James understands typed instructions and spoken instructions and can take context-aware actions **only when those integrations are verified**.

## Morning plan
1. Read the user's **verified** fixed appointments and their local start/end times. Mark stale, unavailable, incomplete, or permission-denied sources explicitly.
2. Retrieve the user's own customer records, last contact and outcome history, next actions, promises and follow-ups.
3. Propose **up to five** flexible customer drop-bys, not five invented obligations. The candidates are relevant and useful—not uniformly random—including a diversity of neglected accounts and important opportunities when appropriate.
4. Evaluate location, travel feasibility, opening/visit constraints, expected visit duration, calendar gaps, customer priority, and what should be done first. If customer address or travel feasibility is unknown, label it as unknown; don't claim a route or travel time.
5. Present brief reasons ("near your 11:30 appointment", "no contact in three weeks", "open follow-up") with clear approval, replacement, reorder, defer and skip choices. The user must approve a suggested stop before it becomes an accepted personal plan.
6. Suggested stops are **not** added as Google Calendar appointments and never misrepresented as reserved meeting slots or confirmed customer visits.

## During the day
- Reassess on useful, permissioned triggers: day/agenda change, confirmed appointment completion, task completion, user asking "what next?", check-in, or location context **if separately granted and technically supported**.
- Suggest the next-best action across all commitments: visits, call-backs, emails, proposal/deadline work, travel buffer, and practical open windows. Do not limit recommendations to the chosen five customers.
- A prompt such as "John's Windows is two blocks away" requires a reliable customer address, grounded user position at the time, and a checked routing/distance source. Without any of these, say that proximity is unverified.
- Recalculate after delays, canceled meetings, travel, rejected visits, and completed activities; never silently move confirmed appointments.
- Respect user attention: quiet hours, priority and interruption thresholds, no repeated nudges, explicit snooze/dismiss, and no unsupported always-listening or background-GPS promises.
- If proactively notifying in the background requires platform permissions or a scheduled agent, identify and separately approve those prerequisites. No production claim before live mobile/background checks.

## Activity closeout
- James asks for a concise result after a planned or user-reported visit, by voice or typing: customer, actual outcome, notes, follow-up, date/time, and whether the customer was actually met.
- Track suggested, approved, attempted, missed, met, deferred, and canceled **distinctly**. A card drop is an attempted visit, not a meeting.
- Every record is linked to the correct customer and has author/source and timestamp; avoid duplicate attempts and history loss.
- Present interpreted speech as editable text and ask for confirmation when identity, outcome, date, or obligation is ambiguous; transcribed speech must not silently become a false visit.
- Save atomically with version/concurrency protection. Show "Saved" only after the storage system confirms durability. Preserve an unsaved draft on error and make reopening/recovery possible; never quietly close or erase failed saves.
- Create reminders, tasks, outbound email or calendar entries only with separately authorized action and appropriate confirmation; avoid duplication on retry.
- Keep Odoo integration deferred until work/company authorization and CRM field mapping are agreed. Likewise defer importing ZoomInfo records until the user prepares the export and approves access/field selection.

## Five examples to pass acceptance testing
1. Fixed appointments + two gaps, five eligible customers: return no more than five feasible flexible suggestions; none written to Google Calendar.
2. Customer nearby but GPS unavailable: do not claim "two blocks away"; identify location verification as missing.
3. Three calls and a proposal deadline conflict with an optional visit: prioritize the deadline and viable short callback window; surface tradeoffs, not automatic rescheduling.
4. User says "I left my card; John wasn't there": classify as attempted/not met; create proposed Thursday call and persist it only on confirmed save. Keep history intact.
5. Failed saved activity and a late/double reply: never show a false success, never clear the unsaved note, and never duplicate a follow-up.

## Engineering stages and gates
A. Independent source-of-truth model, customer outcome and follow-up contracts; no live data.
B. Authenticated owner-scoped durable storage and atomic CAS, failure handling, saved/reopen acceptance checks.
C. Floating overlay integrated with protected API; offline typed path first, then James's unified conversation/voice capture with explicit interpretation and consent.
D. Verified source adapters for Calendar, Tasks, Mail attention and customers, status/staleness handling.
E. Transparent, explainable daily recommendation algorithm with up to five optional visits and complete-day priority reconciliation.
F. Explicitly permissioned location + grounded proximity check, attention/quiet-hours controls and validated proactive notification mechanism.
G. Optional ZoomInfo import and Odoo bridge after separate review, approvals, and safe dedupe/migration.

Do not claim stages B–G are implemented merely because interface fixtures or a model exist. No merge, production release, external sync, or credential change without the established review/approval process.
