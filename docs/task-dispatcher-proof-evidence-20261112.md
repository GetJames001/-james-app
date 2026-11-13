# Isolated dispatcher/trigger/notification proof

November12,2026(Pacific). Base1c4edc1e46b4197f17c3b844c0d1d6ca877d3505; continuation branch work/agent-systems-dispatcher-20261112. Separate Background Engine Builder implemented only four new task-execution modules and its focused test file. Lead supplied separate independent/process checks, a proof-only CI workflow, hosting proposal and this evidence note. No existing runtime/core/UI/configuration file is changed in this increment.

## Implemented boundaries

Trusted server callers register explicit due instants and IANA timezone metadata for zero-cost agenda/follow-up fixture kinds only. Registration version/command digests, deterministic occurrence/task/operation IDs and exact replay protect duplicate creation. Updated pending versions cancel the old pending occurrence; attempted work cannot silently become a new version, and revoked IDs cannot resurrect. Stored records validate shapes, digests, bounded capacities and owner-hashed namespaces.

Dispatcher claims bounded concurrent occurrences with leases/fences. It replays the deterministic create receipt before checking current state, so a committed create with a lost acknowledgement never resets or duplicates a task. A blocked task does not stop another. Explicit core resume changes inputVersion and requeues the same task. Expired claims cannot publish late completion/notification. Wait deadlines signal abort; adapters/transports must cooperate because a JavaScript timer cannot forcibly terminate arbitrary execution.

Cancellation uses durable revocation plus notification suppression. Independent QA found a delayed-create race that initially left a queued task after cancellation. The fix persists cancellationPending/reconcile_required, reconciles revoked occurrences on later ticks and checks after delayed creation; a late-created task is cancelled before dispatch. Unknown creation outcome never becomes a blanket verified cancellation. Already completed artifacts or delivered notifications are not undone.

Notification outbox is distinct from task completion, with stable IDs and owner scope. Send/reconcile attempts are bounded. Unknown or expired delivery attempts reconcile before any resend; only known-not-delivered permits a later resend. Delivered requires a nonempty bounded receipt ID. Missing/malformed receipts and budget-exhausted unknown delivery remain unknown. Durable suppression tombstones stop late enqueue; existing delivered evidence is preserved. No actual notification transport is connected.

## Verification

Focused builder plus lead checks:23passed/0failed/0skipped. Lead-owned independent checks use separate stores and real child processes. An actual clock due instant is not dispatched early. One fictional task blocks; the other process writes one artifact and is forcibly killed before final acknowledgement. After lease expiry, a fresh process reconciles the same artifact and completes, while blocked work remains blocked. Another tick creates no duplicate task, artifact or queued notice. Log DISPATCHER_PROCESS_EVIDENCE explicitly records providerCalls=0, browserRequired=false, actualDeviceTest=false and hostedSchedulerTest=false.

Additional checks cover owner isolation, corrupt/digest-tampered data, unavailable storage, changed registration payload, replay, lease fencing, explicit resumed input version, bounded retries, cancellation/create race, wait timeout/abort signal, notification store failure independence, notification receipt requirements, expired send reconciliation and fenced late delivery reply. No pre-existing assertions were removed.

Full native and real-Chromium/Redis exact-revision CI results must be attached after publication; pending at this document's creation. Existing PR87 exact-base full suite already passed536total/535passed/0failed/1skipped. The skipped protected Preview security gate remains open and is not satisfied by these fixtures.

## Open gates

No hosted REST dispatch/outbox adapter, authenticated scheduler receiver, real scheduled invocation, recurring/DST schedule generator, live provider event ingestion, actual push/email/SMS notification, real iPad/Android result handoff, server conversation memory, general consequential-action authorization or paid work is introduced. Generic read/CAS and worker/notifier ports remain injected. Bounded storage/audit capacity fails closed; production archival and daily spend accounting remain later gates. Adapter deadlines and cancellation must be proved for each real transport. An uncertain or already-in-flight external notification cannot be unsent.

Current official hosting comparison is in task-dispatcher-hosted-plan-20261112.md. New beta Vercel Schedules supports Preview branches; legacy Cron does not. Known project ID/name lookups under the known team currently return404 via this connection, while existing linked builds succeed. A permitted read-only signed-in dashboard check confirmed James Pro, james-app and the exact known project ID. Dashboard read access is available; API connection visibility remains unresolved. No permissions, services, secrets, recurring configuration, plan or Production change made. Main integration4012695 and accepted user journeys remain preserved.

## Independent review corrections

A separate read-only QA agent identified three additional concrete issues before publication: a notification-store outage while reconciling historical cancellation could stop unrelated admission; persisted delivered state could lack its required receipt; and a final-attempt crash after authoritative core completion could falsely exhaust dispatch and drop its notice. Builder fixes isolate cancellation/notification errors, cancel core tasks even while notification storage is down, require persisted delivery receipt/attempt evidence, and use a fresh reconciliation-only fence to recover already completed work without another execution attempt. Original deterministic creation receipt/plan is validated before adopting any existing task. Lead independent regression cases and builder cases cover all three. Unknown cancellation stays pending until both task outcome and notification suppression verify.

New trigger/outbox audit entries carry unique validated UUID event IDs, and duplicated persisted entries fail closed. These are bounded prototype audit records; they do not establish production archival or arbitrary provider exactly-once delivery.
