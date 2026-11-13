# Isolated task-execution proof

November 12, 2026 (Pacific). Implementation on work/agent-systems-first-proof-20261112, based on integration4012695. No runtime routes, production storage, credentials, external services or UI are activated.

## Local evidence

Command: `node --test tests/task-execution.test.js tests/task-execution-process.test.js` from this branch checkout. Ten focused checks passed, zero failed/skipped. The wider native run included the existing integration suite:455 total,453 passed,zero failed,two skipped. Full real-browser CI remains pending until its exact published revision is verified.

The process test uses disposable SQLite solely as a synthetic atomic-CAS fixture. It starts separate worker processes, blocks the follow-up on missing fictional input, then forcibly kills the agenda worker after its checkpoint and prepared artifact are persisted but before the completion receipt. A new worker reclaims the expired lease and reconciles the existing artifact. The agenda completes while the follow-up stays blocked. Supplying fictional input resumes the follow-up; duplicate concurrent dispatch does not duplicate its artifact. Replayed original create commands return their receipts without resetting current task state. A separate process reads the same persisted results; a different synthetic owner sees an empty scope.

Observed:2 tasks,2 prepared artifacts,forced process death,restart recovery,lost acknowledgement reconciliation,independent blocking,duplicate-command replay,duplicate-worker protection,and0 provider/model calls. Other checks cover CAS conflict,expired-worker fencing,cancellation,approval input digest/expiry,steps/attempts/active-time/concurrency/zero-spend bounds,corrupt data and storage failure. Audit entries contain IDs,type,time and status; no input bodies or credentials.

## Limits that remain open

- This proves domain/process persistence and a second independent process, not a real hosted scheduler or a signed-in iPad/Android journey. The fixture directly supplies a fictional trusted owner; actual authenticated gateway integration is not installed.
- Only registered preparation adapters exist. Completion is restricted to outcome prepared. There is no real email/text/purchase/bank adapter, general consequential-action authorization or provider receipt verification. The fake artifact reconciliation is not a guarantee of exactly-once effects from arbitrary external services.
- No continuous scheduling,push notification,server conversation transcript memory,real Redis task-store adapter,production migration or retention/archival UI has been enabled. Task/receipt capacity fails closed instead of silently dropping evidence; long-running archival/operational handling is a later gate.
- Automatic backoff for arbitrary provider failures,revocation callbacks and general cross-service policy enforcement remain later adapter work. Fixture source failures block and release the task lease.
- The legacy Task Pad,existing conversation/Workbench records,Calendar/Mail grants,Wardrobe Site and accepted screens remain unchanged.

Lead owns the new proof-only CI workflow. It runs the existing complete native/browser suite and disposable Redis verification on the isolated branch; it does not deploy a scheduler or set secrets. Hosted protected Preview security and actual closed-app/device acceptance remain separate open gates.
