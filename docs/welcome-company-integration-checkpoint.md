# James welcome and company/contact integration — October 21, 2026

## Candidate and ownership
Isolated branch: work/welcome-company-integration-20261021.
Base: PR35 revision 1a10059c456985fd4bf27ff58a70c92d7259cae4.
Dot supplied welcome/theme patch applied to its exact base (e4c9f63), followed by the separate overnight Perspective fix (9c825ac). Company/contact implementation selectively brought forward from 010744ae1f58c1f57848e86cf832fbb743f9acb9. No wholesale module replacement. Current published Customer Activity remains 4f77a2a; this integration is local only.

## Changes
Minimal greeting and attributed Perspective intro, five-second transition, same-layout dark/light themes, briefing conversation controls. Company/contact editing, prior-contact card and activity save/reload retained. Light palette now covers company workspace, fields, history card and focus states. Calendar/Mail handlers and login/security configuration were not edited by this integration.

Resolved two integration-test assumptions: old Home intro button no longer exists in the approved minimal intro; startup ordering assertion now permits overnight refresh listeners between Perspective rendering and intro startup. Added fictional-company browser check for both palettes and unsaved-note retention across theme/workspace switches.

## Verification
Final command: JAMES_TEST_REDIS_BIN=/tmp/james-disposable-redis/src/redis-server NODE_OPTIONS='--require /tmp/james-browser-preload.cjs' npm test
174 checks: 173 passed, zero failures, one skipped. Includes browser/company persistence tests and disposable Redis atomic/reload/isolation/lost-reply tests. Only skipped check: authorized protected hosted-preview gateway probe. Local tests do not certify production, hosted security, or user acceptance of combined artwork. No merge, push, deployment, live provider call or security-setting change.

## Reconciled module requirements (open)
- Finance: editable entries, confirmed/estimated/unknown amounts, dated bills, goals/contributions, chosen next action, backup/restore. Older rich Finance source not located/read in this review; no replacement authorized by absence.
- Health: workout/check-in/product logging; review before save; correction history; dates/units; selected exports; goals/clinician restrictions; medical appointments/records. Older Health Journal files partially inspected and contain richer controls than starter; full source audit pending.
- Development: source → takeaway → practice → reflection, reading/listening library, career/résumé guidance.
- Wardrobe: one conversation beside editable outfit postcards; pin/remix; closet first; missing pieces; editable shopping preferences; no cost-per-wear; Pinterest retrieval planned, not verified.
- One James; Briefing home; full-screen workspaces with matching palettes; Exit/contextual done preserves unfinished work; stop speech does not exit. Enriched mockups remain proposals.
Supplied modules: 48 offline tests passed; fictional/in-memory prototypes remain separate. Shared-host persistence and browser/security integration open. No J07–J29 category marked complete.

## Remaining release gate
Recheck remote revisions before publishing. A new combined protected-preview deployment requires explicit approval under the handoff; hosted gateway test needs its authorized secret-bearing workflow. Do not treat previous skipped green workflow as a security pass. Production release remains separate.
