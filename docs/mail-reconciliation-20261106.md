# Mail reconciliation checkpoint

This update extends the deployed foreground automatic sweep, independent of the disabled background-worker draft PR74. Keep the accepted entrance, Calendar credentials, Customer Information and Workbench unchanged.

- Retain only the latest observed metadata version per message rather than accumulating superseded versions.
- Prune handled-version hashes only when their evidence has been superseded or provider-confirmed absent; unchanged handled messages remain suppressed.
- Recheck up to25 saved message IDs per source per sweep, rotating with a persisted cursor. Current-page Hotmail messages avoid redundant reads. Gmail checkpoints still reuse unchanged current-page metadata.
- Hotmail checks membership through the Inbox-scoped message GET. Gmail checks message label IDs. Only a provider404 or a verified Gmail message without INBOX removes saved Inbox evidence. Missing from the latest page alone, being read, a sent reply, errors, timeouts and permission failures never establish absence/completion.
- Removed suggestion evidence does not delete source mail or complete a user-created task. Provider failure retains the previous source with stale coverage. Existing optimistic revision conflict protection remains.

Verification:88 focused tests passed, including provider adapter tests for archived/deleted/existing/permission-failed messages, rotation, failure preservation, compaction, handled/Undo, mail refresh, Gmail consent isolation and gateway/read-state guards.

Remaining: newest-page discovery is still25 per source. Old saved suggestions reconcile in25-item batches, so up to12 sweeps can be needed for300 known messages. This does not scan all folders or infer fulfillment from replies. The snapshot remains bounded at300 distinct messages/source and1MiB; compaction removes superseded versions but does not silently evict unresolved suggestions at capacity. No closed-app worker is active; PR74 records its Vercel access blocker and Michael's existing activation approval.
