# To Do clarity, handled suggestions and call to action

Michael checked recent mail and asked how Needs attention differs from My tasks, how to clear already handled mail, why the older saved review appeared separately, and whether connection instructions still belong on the main screen. He requested a glow when To Do contains work.

## Behavior

- Needs attention contains uncertain mail suggestions. Review in Mail opens the source; Draft a task fills a draft and Add task saves it. Neither reading nor drafting automatically resolves a suggestion.
- Mark handled records an explicit decision for the current saved message version in the existing owner-scoped Attention snapshot. No source mail, task, calendar event or evidence is deleted or marked complete. The handled decision survives scans/reloads/devices. Undo is available under Handled suggestions. New content versions can appear for fresh review.
- A steady gold outline/glow appears on To Do for active suggestions, unfinished saved tasks or other saved attention items. No pulse or flashing. Handled suggestions and completed tasks do not create that cue.
- Mail settings/reconnect controls and older saved-review coverage/history are retained under one collapsed section. The older evidence inventory is explicitly not a count of unfinished tasks. Detail state clears on departure without losing stored data.

## Persistence and safety

POST /api/attention/decision requires James authentication, same-origin protection, strict JSON, a known current review key and one of handled/undo. It reuses the existing snapshot store with optimistic concurrency; a changed message or revision conflict cannot silently overwrite new evidence. Only a bounded list of version hashes is added to provenance. Account selection and client-supplied mail are not accepted. Source mail and Tasks transports are not called.

Once a saved review exists it is authoritative for the visible suggestions, preventing ordinary live Inbox refreshes from resurrecting handled items. Failure leaves the current suggestion visible. Logout suppresses late callbacks and clears the visible cue.

## Verification

94 focused unit/integration checks and 6 browser flows passed (100 total). Includes handled persistence across repeated scans, undo, changed-version resurfacing, provider separation, strict request guards, conflict handling, UI save failure, reload/scan persistence, glow state, Gmail read-only source opening, original task deletion/undo/failure handling, saved-review focus/layout and account-state clearing. Existing consent diagnostics and Calendar isolation tests passed.

Browser test fixtures were aligned with the existing To Do → My tasks navigation and collapsed review-details placement; no obsolete sidebar Tasks entry was restored. The saved-view test counts Attention writes rather than unrelated application startup traffic.

The accepted entrance, videos, Customer Information, Workbench, credentials and Production are unchanged. This does not add Sent-mail reconciliation, automatic completion, whole-mailbox scanning or background monitoring.
