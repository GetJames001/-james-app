# Recovered Workbench host adaptation

Base: 1bd8f93fcf4864b64a72ad8b367d2b4521022dd9. Working release Preview and Production are unchanged.

Recovered ZIP SHA256: 6d22d4fbf298b0de95ba30fde6f0da2bac31ea47631dfe2cef7b5b02046028c7. Documented five-file correction verified by byte/hash checks. Lead and independent reviewer each reproduced 46/46 recovery checks.

The recovered UI/domain/session modules use the current James authentication, protected assets, same-origin Workbench gateway, account-scoped Redis namespace, atomic document/receipt CAS, and existing conversation owner. No legacy host page, trusted client identity header, D1 migration, additional assistant, or real external action.

On composer commit 0f97a187ce2b691fcb164a434e195e8b8325eba0, CI reported 243 passed, zero failed, two skipped. Hosted synthetic testing verified a real project-aware response, cancellation with no late presentation, and saved draft readback after refresh. Independent Review Dot confirmed the saved draft in a fresh authenticated tab. User confirmed a project-aware response on a phone. This is not complete Live acceptance.

## Reload continuity correction

The direct typed Workbench -> Briefing -> James handoff succeeded on the hosted composer build. Reloading the page then asking what had been worked on reproduced the missing-context answer. Recent turns existed only in page memory.

The correction retains up to four confirmed turn pairs, bounded to 10,000 text characters, in same-tab session storage. Workbench turn history records the bounded project title and objective with the request, rather than retaining a full project snapshot. Restoration requires authenticated ready identity verification and exact account/conversation/generation equality. Malformed, oversized or mismatched cache is discarded. Explicit End, sign-out, revocation and current authentication rejection purge it. Cancelled, failed, pending replies and unsent drafts are excluded. Storage failure does not prevent ordinary conversation. Pagehide suspends pending work without ending shared James; persisted browser return remounts Workbench through verified navigation. Stale authentication responses cannot erase a newer completed turn.

Lead and independent Review Dot each reproduced 43/43 focused source/adapter tests, zero failures/skips. A Chromium regression covers actual reload recall and End clearing. Exact-commit full CI and hosted corrected-build reload acceptance must be verified separately. Local full browser testing is blocked by the unavailable Chromium executable; source tests do not establish browser acceptance.

This cache provides same-tab continuity only. It is not authenticated server transcript persistence, guaranteed new-tab or cross-device continuity, or a claim that upstream model computation stops on cancellation. Full voice/tool integration, device/theme acceptance, cross-account hosted isolation, provider-failure acceptance, Next Appointment, branch Calendar configuration and release checks remain open. No Production release approval is implied.
