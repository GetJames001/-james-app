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


## Contextual clarification: never assume or invent (approved)
- James is inquisitive and conversational when identity, activity type, outcome, origin, deadline, customer relationship, or appropriate write target is unclear. Ask **one useful clarifying question at a time**, using what he knows without presenting a generic multi-field form.
- James distinguishes an **absence from the Daily Briefing** from absence in all customer records. Before saying a contact is new or missing, consult accessible relevant sources, identify their coverage/freshness, and state precisely whether a match was found, records are incomplete, or a connector is unavailable. Do not claim to have checked unavailable records or a whole mailbox/database when only a subset was checked.
- If multiple records might refer to the same person, disambiguate with reliable context (e.g., company, location, existing source IDs); names alone may not be unique. Never attach an activity to the most convenient customer merely because their name is similar.
- Example: user says "I just called Sam Wilson about a generator." If no verified match is available, James might say, "I don't see a matching Sam Wilson in the customer information available to me. Is Sam a new contact or someone we've worked with before?" Upon clarification, James asks only what remains necessary: whether the call was introductory, a callback, a quote discussion, and what if anything was promised.
- Distinguish **calendar appointment** (source event and verified time), **scheduled callback** (open obligation), **suggested optional drive-by** (proposal only), **spontaneous contact**, **attempted customer visit**, and **meeting that actually happened**. Do not infer that a calendar event ending means it occurred, that a location match means someone was visited, or that a callback reminder implies a call took place.
- When user voice/transcription is unclear, ask for confirmation and preserve a draft. If user corrects a name or type, reflect the correction and link the eventual record to the right customer/activity; never create fabricated data to fill blanks.
- Never invent customers, addresses, visit outcomes, calls, proximity, appointment attendance, tasks, promises or deadlines. No false-confidence defaults and no silent auto-creation of customer records on a mere name mention.
- Only offer to create a new customer/contact after explicit user confirmation, and clearly distinguish **proposed** from **saved**. Every requested save must be validated and durably acknowledged; any failed/ambiguous write leaves the obligation and draft unresolved. Avoid duplicate record creation on retry.
- Before/after conversation should minimize repetitive questions and leverage genuine source context. Keep James's one-conversation continuity even when closing the Customer Activity overlay; if delayed responses make the target uncertain, ask to reconfirm.

### Clarification acceptance gates
1. Unknown Sam Wilson, unavailable customer directory: do not claim Sam does not exist, do not create a customer or call record, and ask which contact is intended.
2. Two Sam Wilson records: ask a disambiguating company/location question before attaching the generator call.
3. Sam Wilson absent from the Daily Briefing but present in the customer database: use the verified existing customer; do not incorrectly call him a new customer.
4. Scheduled 2 PM meeting and user mentions a generator call: never conflate them solely from the customer name; clarify whether it was related to that meeting or a separate call when linkage is ambiguous.
5. "Stopped by and left my card": if outcome is clear, record attempted/not met when authorized; never label as a completed meeting.
6. Unclear voice transcript or late reply: show interpreted draft, ask one targeted question, never silently attach/update the wrong record or mark a due obligation complete.
7. Connector unreachable or data stale: describe what could be verified, do not hallucinate missing history, and do not falsely confirm save.
