# Rolling Inbox coverage and storage handling

Continue the user-passed PR75 Preview, without changing the entrance, Calendar grants, Customer Information or Workbench.

## Behavior

Every visible-app check still inspects the newest25 Inbox messages. The saved server-side cursor also advances one older25-message page per account on subsequent checks. At the end it records a completed rolling pass and starts another. Mail can change during traversal; this is not an atomic all-folder scan. A failed older-page fetch preserves new mail, reports partial coverage and restarts from a current cursor. Gmail latest-page cache remains; opaque cursors/checkpoints/reconciliation IDs are stripped from the public Gmail response and the public attention projection.

Previously found suggestions continue rotating provider membership checks. Replies alone do not resolve obligations. No sends, deletions, read-state mutations or Calendar writes are added. Gmail remains read-only and Hotmail remains primary.

## Storage

Superseded metadata versions are compacted. Non-suggestion mail not in the current returned pages leaves the temporary inventory. Unhandled suggestions remain until handled, changed or provider-confirmed outside Inbox. After the10-second Undo window, a later sweep replaces handled subject/preview/sender metadata with a small message ID/fingerprint stub. The fingerprint suppresses unchanged items; changed content can become reviewable. Other sources and user-created tasks are preserved. Reconciliation can eventually remove stubs whose messages leave Inbox.

A source capacity limit applies to300 active records rather than handled stubs. Reaching it preserves old evidence, shows an explicit capacity warning, and permits the other account to keep updating. Existing600 decision fingerprints and1MiB snapshot bounds still apply; this is bounded storage, not unlimited history. No unresolved suggestion is silently evicted at capacity.

## Verification and remaining boundary

97 focused tests passed on the final shared Gmail deadline/partial-status adjustment;4 browser flows passed on the unchanged client code. Tests cover rolling cursors, stale older-page errors, public cursor redaction, more than300 handled messages, routine-mail compaction, Undo timing, version suppression, source capacity isolation and existing OAuth/read-state/navigation behavior.

Closed-app scheduling is separate and remains disabled in draft PR74. Michael's approval is already recorded. Connector access remains404 for the exact verified James project and403 for creation even after team approval/reconnection. No repeated consent request is justified without new evidence. Main James Production is not promoted.
