# Bounded private scheduler transport — November 13, 2026

Continuation of draft PR91, based on its verified disabled-build commit `76df1f7e5fc2f9df47569d5d43d182b43388b97c`. Integration owner retains this branch and the hosted transport. Task Pad PR90, accepted integration4012695, main5953549 and separate Wardrobe are not part of this change. Local recovery commits are snapshots; publish only with the actual remote parent.

## Implemented, default off

- The existing `api/proof-schedule.js` remains a private `schedule/v1beta` function. There is still **no `schedules` or `crons` declaration**. The catch-all gateway has no route to the worker.
- Pin `@vercel/schedules`0.0.3 for official CloudEvent parsing. Its transitive Zod4.1.11 was flagged by `npm audit` (GHSA-mrhx-c7xc-m3w5); override to patched4.6.6. Local audit after installation: zero known vulnerabilities. No install scripts run.
- Parsing metadata is **not authentication**. The platform's private function boundary must be verified on the exact deployment. Public forged-header attempts must hit the authenticated gateway, never the worker. Protected hosted checks include direct, `.js` and gateway-query paths.
- Before any storage call, require Preview, exact scheduler branch, exact James project ID, two explicit enable flags, and an approved40-character commit matching `VERCEL_GIT_COMMIT_SHA`. Server configuration supplies owner, fresh proof ID, exact schedule ID and a maximum30-minute window.
- Accept only `james-fictional-proof`, default namespace, static source, `*/15 * * * *`, and exactly two quarter-hour occurrences. Reject early and more-than-two-minute-late events. Static schedule jitter must be1minute for this proposal.
- Durable atomic admission binds each occurrence to the provider execution-ID digest. At most two attempts per occurrence; duplicate, concurrent, changed-ID or already-checked deliveries do not repeat a tick. A lost admission reply leaves a20-second lease; fresh processes recover after expiry.
- Every operation has a shared10-second transport deadline and at most180 outgoing storage requests. Engine calls also recheck the execution window. The function's platform maximum remains15seconds. These are admission/transport limits for fictional adapters, not a claim that arbitrary JavaScript or external actions can be forcibly undone.
- A fourth isolated document, `james:task-proof-control:v1:<hash>`, binds owner/proof/configuration. Existing scoped ledger/dispatch/outbox documents and their CAS/lease rules remain authoritative. No legacy Task Pad or real mailbox/calendar/customer record is loaded.
- Owner-only session/CSRF controls at `/api/james/hosted-proof` expose `arm`, `resume`, `stop` and redacted read-only status. No client tick, arbitrary task, owner, approval, worker lease or completion endpoint exists. Stop persists before cancellation, survives restart/outage/expiry and cannot be reversed by arm. A cancellation failure stays unavailable/reconcile-required.
- The private `/hosted-proof` page is an isolated test interface, hidden while disabled. It registers the two fictional tasks, reads results on another authenticated client and accurately labels queued/unknown/cancelled notices. It has no worker timer. It does not modify the accepted visual shell or claim a new design/voice is complete.
- No notification sender is connected. A queued outbox record is not delivery. Preparation is not a real-world action.

## Verification and limits

Focused local tests cover exact configuration gates; metadata rejection before I/O; independent blocked/ready tasks; stale/duplicate admission; lost acknowledgement and restart; per-occurrence attempt caps; stop during outage and after expiry; mid-run window expiry; corrupt/config-mismatched control data; SDK parsing; owner/CSRF/gateway boundaries; deadline/request budgets. Existing dispatcher tests retain deeper task/notification lease and cancellation-race coverage.

CI adds real disposable Redis admission races and a real Chromium fixture opening a fresh browser client after the first client closes. Those are engineering fixtures, **not provider-scheduled hosted runs or Michael's device acceptance**. Attach the exact CI/head/deployment and protected-security results in PR91 before claiming them passed. Earlier PR89 security evidence does not certify this new transport.

## Concrete activation proposal — not applied

Target: existing `james-app` project, Preview branch `work/hosted-schedule-compatibility-20261113`, private function `api/proof-schedule`, only a reviewed exact commit. No production promotion, new project, subscription, model/API spending or new external-action permission.

The proposed static activation diff is only:

```json
{"schedules":{"james-fictional-proof":{"schedule":"*/15 * * * *","timezone":"UTC","jitter":1,"function":"api/proof-schedule"}}}
```

Do **not** copy this into `vercel.json` yet. A deployment with this declaration creates recurring platform invocations even if the handler is disabled or its window expires. Four admitted ticks is not a hard cap on scheduler invocations or billing. Before activation, confirm current plan/usage/Redis rates, the specific incremental spending allowance, and actual ability to inspect and disable this Preview schedule. API project lookup previously404; dashboard read access is not proof of scheduler-management access.

Required server settings, scoped to this Preview branch: existing owner/storage configuration reused without disclosure; `JAMES_HOSTED_PROOF_ENABLED`, `JAMES_HOSTED_SCHEDULE_ENABLED`, `JAMES_HOSTED_PROOF_APPROVED_HEAD`, fresh `JAMES_HOSTED_PROOF_ID`, actual `JAMES_HOSTED_PROOF_SCHEDULE_ID`, `JAMES_HOSTED_PROOF_START_AT`, `JAMES_HOSTED_PROOF_END_AT`. No new bearer credential is proposed. Registering a schedule to discover its ID must itself be within the activation approval and stopped if the review cannot finish.

Operator sequence after engineering/cost/activation approval:

1. Bind the final Ready deployment to its exact reviewed commit; pass protected gateway and forged-scheduler-header probes on immutable and branch URLs. Confirm private resource configuration.
2. Verify schedule management and a working disable path before scheduling. Choose a window beginning shortly before the first quarter-hour, containing two occurrences and their jitter within30minutes. Record exact schedule ID and environment.
3. Set only approved branch-scoped variables and deploy the approved activation diff. Arm from the authenticated private test page so both fictional registrations persist before clients close.
4. Close all James clients. Require provider execution-history records and matching execution-ID digests; a manual invocation or test process is not evidence of scheduled work. First occurrence should prepare the agenda while the follow-up blocks. Read from a fresh client, then use the permitted fictional detail to resume before the second occurrence, if this is the approved journey. Record restart/cancellation/duplicate cases separately without conflating synthetic tests with hosted observations.
5. Stop owner work, verify cancellation outcomes, **disable the platform schedule**, verify disabled state and no further runs, and remove the schedule declaration to prevent recreation. Only then clear temporary proof flags/approval metadata. Do not rely on handler expiry or a failed HTTP response to stop billing.
6. Retain small fictional evidence for review; no deletion of existing records. There is no automatic cleanup in this candidate. Any later fixture cleanup is scoped to these four fresh proof documents and requires a reviewed retention decision.

The first hosted run can establish task progress and queued/cancelled notification outcomes. Actual closed-app notification delivery requires a separately supported, authorized sender/receiver and a verifiable receipt. Do not label the complete second-device journey ready until that limitation is explicit and the engineering checks are complete.

Official references: https://vercel.com/docs/schedules/handle-runs · https://vercel.com/docs/schedules/configuration · https://vercel.com/docs/schedules/limits · https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
