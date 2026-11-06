# Gmail mail review — November 6, 2026

Michael's screenshot confirmed Gmail API enabled in the existing James AI Assistant project, followed by “Gmail reading connected.” This is the saved, separately scoped Gmail grant; Calendar credentials were not replaced. Hotmail remains the primary sender. No additional consent, Gmail sending, replacement credentials or paid service is introduced.

## Implemented scope

- Authenticated GET `/api/google/gmail/messages` uses only the separate owner/branch Gmail token key, refreshes in memory, and reads one bounded Inbox page (up to 25 message identities plus header/snippet metadata). No paging controls or arbitrary mailbox selectors are accepted. Failed detail reads make the page fail rather than imply complete coverage.
- Existing foreground POST `/api/attention/scan` checks Hotmail and connected Gmail independently, saves one combined optimistic-concurrency snapshot, and preserves all previous evidence. A source failure marks only that source stale and does not erase its saved candidates or block the other source. No background schedule or notification was created.
- One existing To Do review queue shows source labels and individual last-check/failure status. Gmail identities are namespaced so they cannot collide with Hotmail identities. Forwarded copies across providers are retained separately pending later correlation; no duplicate automatic tasks are created because no automatic tasks are created at all.
- Opening a Gmail source reads plain text within the existing Mail detail page. It does not invoke Hotmail's attachments, reply or read-state actions. HTML-only mail may show a snippet; rich formatting and attachments are deferred. Late results cannot reopen a page after navigation or account-state change.
- The original Attention evaluator and snapshot store remain authoritative. Candidates remain uncertain evidence requiring review, not verified obligations. Older pages, Spam/Junk, Trash/Deleted, Sent reconciliation, full semantic extraction, itinerary imports and Calendar writes remain unimplemented.

## Validation

90 focused checks passed before browser verification, covering separate grant usage, route guards, bounded reads, read-only requests, distinct identities, source failure isolation and saved evidence. Existing consent diagnostics, replay tests, Calendar isolation and login bootstrap tests passed. Browser verification and hosted verification recorded below when complete.

## Preservation

Accepted entrance, videos and preference behavior are unchanged. Customer Information, Workbench, credentials, existing Calendar tokens and Production are unchanged.

Browser validation completed: all 3 browser flows passed (Gmail source reader and navigation race, existing Hotmail review, saved-review restore/failure/logout handling). Chromium was installed as an isolated test runtime after the default browser download failed; no application dependency or lockfile changed. Final count: 90 focused unit/integration checks plus 3 browser checks passed. Hosted combined-source collection remains to be verified through the signed-in user's Check recent mail action; no claim is made that live Gmail Inbox contents have already been collected.
