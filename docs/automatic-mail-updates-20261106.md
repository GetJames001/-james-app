# Automatic foreground mail updates

Michael wants James to have current information on opening and to surface matching attention items without pressing a sweep button. This replaces the prior manual-only saved review behavior.

## Delivered behavior

- The existing personal-mail refresh controller starts immediately, refreshes on foreground return, and polls every 30 seconds on any visible James page. Navigation does not create extra competing polling loops. Existing 5-second event deduplication and in-flight sharing remain.
- The same cadence triggers the existing saved Attention collector for Hotmail and connected Gmail. The manual Check recent mail button remains a backup. An immediate collection also starts when the review component mounts.
- Source reads run concurrently. Gmail checks the provider history ID and reuses the last verified bounded page metadata only when history is unchanged; changed history forces fresh list/detail reads. No permission, OAuth credential or Calendar token changes.
- Saved data remains visible with timestamps during refresh/failure. A disconnected Hotmail inbox cannot erase the independent Gmail review. Refreshing a mailbox does not rebuild an open message/reply composer. Buttons retain focus and expanded review guidance stays expanded.
- Logout invalidates pending refresh results and stops polling. Hidden tabs stop timed checks; returning triggers a fresh check. This is foreground automation, not a closed-app monitor or an OS push notification.

## Handled suggestions

The accumulating handled-card section is removed. Only the last successful handled action offers Undo for 10 seconds in the current session; it is not a 30-day archive. Public saved-review responses no longer return full handled-card payloads. Internal version decisions remain so an unchanged handled message is not reintroduced. New content versions remain eligible. Original emails, tasks and retained review evidence are not deleted.

## Remaining scope

Recent Inbox coverage remains bounded at up to 25 returned messages per source per collection. Full folder paging, Sent/reply/deletion reconciliation, deeper semantic extraction and storage compaction are separate outstanding work; this increment does not claim whole-mailbox completeness or guaranteed identification of every urgent message. Existing source-capacity/byte limits fail visibly rather than silently pruning unresolved evidence.

The existing app has no configured scheduled collector. Vercel native cron targets Production deployments, so the current Preview cannot itself be scheduled natively. A separate, approval-gated worker is the next step; main James Production must not be promoted as a shortcut.

## Verification

102 focused unit/integration checks passed, plus seven browser flows passed across targeted runs. Covers default 30-second cadence, immediate startup/foreground checks, all-page updates, hidden-tab pause, stop/late-result guards, Gmail unchanged-history reuse and changed-history rereads, saved decisions, transient Undo expiry, public suppression of handled cards, reply draft preservation, source failure isolation, existing task actions and Calendar isolation. Tests that formerly expected no collection on startup now distinguish automatic collection from prohibited implicit decision/task writes.
