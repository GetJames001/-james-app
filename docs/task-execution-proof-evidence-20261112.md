# Isolated task-execution proof

November 12, 2026 (Pacific). Implementation on work/agent-systems-first-proof-20261112, based on integration4012695. The authenticated task API and existing Redis REST/CAS adapter are implemented behind a default-off, branch-specific Preview flag. No live task storage, credentials, external services, scheduler or UI are activated.

## Local evidence

Command: `node --test tests/task-execution.test.js tests/task-execution-process.test.js` from this branch checkout. Ten focused checks passed, zero failed/skipped. The wider native run included the existing integration suite:455 total,453 passed,zero failed,two skipped. The original c38d17e proof passed full Chromium CI43352508001 and43352515987:522 total,521 passed,zero failed,one skipped protected Preview security gate. The subsequent authenticated API/storage increment passed464 local native checks:461 passed,zero failed,three skipped (including disposable Redis without its CI binary). Full browser/Redis verification for that new increment remains pending until its published revision is checked.

The process test uses disposable SQLite solely as a synthetic atomic-CAS fixture. It starts separate worker processes, blocks the follow-up on missing fictional input, then forcibly kills the agenda worker after its checkpoint and prepared artifact are persisted but before the completion receipt. A new worker reclaims the expired lease and reconciles the existing artifact. The agenda completes while the follow-up stays blocked. Supplying fictional input resumes the follow-up; duplicate concurrent dispatch does not duplicate its artifact. Replayed original create commands return their receipts without resetting current task state. A separate process reads the same persisted results; a different synthetic owner sees an empty scope.

Observed:2 tasks,2 prepared artifacts,forced process death,restart recovery,lost acknowledgement reconciliation,independent blocking,duplicate-command replay,duplicate-worker protection,and0 provider/model calls. Other checks cover CAS conflict,expired-worker fencing,cancellation,approval input digest/expiry,steps/attempts/active-time/concurrency/zero-spend bounds,corrupt data and storage failure. Audit entries contain IDs,type,time and status; no input bodies or credentials.

## Limits that remain open

- This proves domain/process persistence and a second independent process, not a real hosted scheduler or a signed-in iPad/Android journey. The fixture directly supplies a fictional trusted owner; authenticated gateway integration is now implemented and tested with synthetic sessions; real hosted activation and device acceptance remain open.
- Only registered preparation adapters exist. Completion is restricted to outcome prepared. There is no real email/text/purchase/bank adapter, general consequential-action authorization or provider receipt verification. The fake artifact reconciliation is not a guarantee of exactly-once effects from arbitrary external services.
- No continuous scheduling,push notification,server conversation transcript memory,live Redis task-store activation,production migration or retention/archival UI has been enabled. Task/receipt capacity fails closed instead of silently dropping evidence; long-running archival/operational handling is a later gate.
- Automatic backoff for arbitrary provider failures,revocation callbacks and general cross-service policy enforcement remain later adapter work. Fixture source failures block and release the task lease.
- The legacy Task Pad,existing conversation/Workbench records,Calendar/Mail grants,Wardrobe Site and accepted screens remain unchanged.

Lead owns the new proof-only CI workflow. It runs the existing complete native/browser suite and disposable Redis verification on the isolated branch; it does not deploy a scheduler or set secrets. Hosted protected Preview security and actual closed-app/device acceptance remain separate open gates.

## Authenticated API and storage increment

Lead added one exact gateway route, `/api/james/task-execution`, using existing session authentication, configured server identity, host validation, same-origin write checks and private/no-store responses. The route is disabled unless the explicit task flag, Preview environment and isolated branch all match. No environment flag was changed. Production and other branches cannot enable this pilot.

The API supports status reads and owner create/resume/pause/cancel commands for zero-cost fictional preparation kinds. Worker claim/checkpoint/reserve/completion and consequential approval commands are not client APIs. Client-selected owners are rejected. Results omit raw inputs, leases, approvals and operation history. A retried create after later progress returns current task status while retaining the original operation revision.

The REST adapter reuses the existing atomic CAS script and bounded-response reader in a new owner-hashed task namespace. It rejects arbitrary storage keys, malformed or oversized data, unexpected Redis types and failed reads. An outage never becomes an empty task list. Neither the legacy Task Pad key nor other account records are migrated.

Added tests cover actual gateway authentication, wrong-account sessions, same-origin writes, disabled flag behavior, forbidden worker commands, duplicate replay after completion, bounded errors, atomic CAS races and lost write acknowledgement. A disposable real Redis test covers reload, isolation, corrupted records and outage. A Chromium test uses two separately authenticated browser contexts and the actual gateway/storage adapter over a synthetic transport: the first browser closes before a fictional worker runs, then the second browser reads its completed preparation and retains it after reload. This proves a browser/API/storage boundary with fictional identities, not a deployed scheduler or actual iPad/Android handoff. No real provider/model call or external action occurs.
