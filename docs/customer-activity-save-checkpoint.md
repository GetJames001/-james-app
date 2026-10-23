# Customer Activity save integration — October 21, 2026

Status: isolated local implementation; NOT production verified or approved for release.

## Governing sources

- User replacement handoff and supplied James Master Checklist, October 21; the checklist's October 20 sequence is superseded where the October 21 decisions are explicit.
- Latest Lead conversation: https://chatgpt.com/c/6ad66cd9-ce20-83e8-9b0e-d3cf735c9593 — retrieved excerpts only; full transcript not accessible.
- James_Historical_Architecture_Decision_Audit_2026-10-20.md read; itself acknowledges incomplete historical transcript recovery.
- Existing accepted workspace PR #33 at 59a47de9eaa4b08cea1267a236dd79977e38a4bc.
- Existing record contracts PR #34 at 84b767a126643d49466bc472b66bf3ef31c6f6d7.
- Separate Today's Perspective PR #35 at 1a10059c456985fd4bf27ff58a70c92d7259cae4: previously verified 142 passed, 0 failed, 1 skipped, security workflow green BUT protected-preview-security job SKIPPED, Vercel preview reported successful by GitHub, separate Cloudflare failure. Unmerged and no review approval recorded at inspection.

## Preserved direction

Daily Briefing remains home. Customer Activity opens from its link, accepts updates, saves, returns to the briefing. One James owns the conversation. Up to five daily suggested stops must eventually use confirmed schedule and validated geography. Suggestions, attempted visits, actual meetings and completed obligations are separate. Never infer activity from elapsed time. Keep Calendar, Mail, Tasks, accepted design and stored wardrobe/artwork intact. No merge, deployment, paid AI call or account/security change is authorized by this checkpoint.

## This increment

- [x] Reuse #33 workspace and #34 records without changing either remote branch.
- [x] Implement authenticated GET/POST with existing session and same-origin protection.
- [x] Account-scoped storage and atomic compare-and-swap adapter; existing Calendar/Mail/Tasks keys untouched.
- [x] Manual customer entry and explicit activity outcome/time entry; no invented suggested customers in the persistent interface.
- [x] Save/reload UI, failed-save draft retention, conflict reload, uncertain acknowledgement reconciliation by record ID.
- [x] Nine focused model/handler/adapter checks pass with synthetic storage.
- [x] Browser verification with synthetic HTTP/store: save, page reload, attempt vs meeting, draft retention after failure/conflict, return to briefing; widths 320/390/820/1280. Browser: Chromium 153 from temporary alternative package after normal Playwright Chromium download failed. Production Playwright/browser CI still required.
- [x] Real disposable Redis 7.2.5: atomic CAS race, independent reload, account isolation, corrupt-record preservation, lost acknowledgement reconciliation and outage rejection. Temporary loopback REST fixture; not hosted provider verification.
- [ ] Authenticated hosted verification and user device acceptance.
- [ ] Continuous voice interaction; existing device keyboard dictation can enter text, but this is not James conversational voice integration.
- [ ] Five schedule/location-based daily recommendations.
- [ ] Completed obligation tracking and correction workflow.
- [ ] Release approval, merge, deployment.

This is progress on J14/J21/J26 and part of J13. No entire master-checklist milestone is marked complete.

## Known limits and next gate

Current host is single-owner authenticated; use its verified configured identity, never a request-provided owner. This is not multiuser readiness. The UI currently captures new activity but does not edit/delete historical activity. Follow-up text remains a proposed next step, not a created Task, sent email, booked visit or completed obligation. Manual customers have names only in this increment; verified addresses/contact enrichment remain ahead of territory suggestions.

Review and finish browser + disposable database verification before proposing a release. No real customer data or production database was touched. Do not push this branch without accounting for automatic preview deployments; the user's no-deployment instruction still applies.

## Verification result

Full existing-plus-new suite: 154 tests, 153 passed, 0 failed, 1 skipped (environment-gated deployed-security check). Run locally with temporary Chromium 153 launch override; no source dependency or production browser configuration changed. Syntax and whitespace checks passed. These are synthetic/local results, not live Redis or production verification.

## Sole-Lead reconciliation

User appointed this chat sole active Lead. Original Lead briefly resumed and stopped without final result; its unreported local actions remain unknown. Remote PR #35, #33, #34 and main were rechecked and remain at the exact revisions above. PR #35 has four commits, no reviews, and remains open/unmerged. Tests run 39636814479 succeeded. Workflow 39636814506 only ran manual-authorization; protected-preview-security was skipped. Existing workflow is restricted to old PR #9; rerunning is not a valid PR #35 verification route. No rerun or security change was attempted. Vercel deployment listing returned 403 and no Vercel CLI was available: GitHub preview success is the available evidence, production status remains unverified.

## Latest regression checkpoint

After the lost-acknowledgement and session-expiry browser cases exposed a Reload keyboard-focus issue, focus restoration was corrected. Current full suite with disposable Redis enabled: 155 tests, 154 passed, 0 failed, 1 skipped. Includes real local Redis CAS tests and browser recovery/session-expiry checks. Hosted security remains unverified.
