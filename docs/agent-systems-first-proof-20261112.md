# James background work: contracts and first proof

Prepared November 12, 2026 (Pacific). Status: source audit and bounded implementation assignment; isolated domain/process proof is now implemented (see task-execution-proof-evidence-20261112.md). No new hosted background service is activated.

## Checkpoint and protected work

Repository `GetJames001/-james-app`; integration branch `fix/calendar-refresh-diagnosis-20261031`; inspected head `4012695b5cdde4b5801f4d451d7ae2aefa3b40cd`, tree `441429fd16a47aaeced79bc3dd3b78612559fb95`.

Existing Preview: https://james-app-git-fix-calendar-refresh-diagnosis-fe3b3a-james-cb7a.vercel.app/ . Main Production remains `5953549b64558a2cb6e9b6f9e86acf9e295642b8`; external-wake branch remains `98f6499d733d6a288adf71c88d87f647a87eed9a` at the latest recorded check. No reset, force push, Production promotion, new plan or paid test.

Exact integration head passed real Chromium CI43331938053/job131578513717: 512 total, 511 passed, zero failed, one skipped protected Preview security gate. Native:445 total,443 passed,zero failed,two skipped. Both Vercel Preview contexts succeeded. That is not complete release/security acceptance. Vercel scoped runtime logs still403; earlier approved dashboard capture timed out. This is an access blocker, not proof of project deletion.

Accepted: Calendar, Workbench, Customer Information, entrances/panels/timing, All Files search/match checks, selected Wardrobe journeys, and foreground automatic current-location departure estimates on three consecutive real iPad refreshes. Do not repeat these tests or redesign their screens. Voice foreground multi-turn use was reviewed; continuous cross-device/background/locked-screen voice was not proved.

Mail: a fresh existing-Preview inbox refresh still timed out at inbox_messages. Earlier inbox display was intermittent. Personal owner profile remains unverified, not a proven mismatch. Preserve the existing grant and allproactive@hotmail.com preference; no account reset or invented outage-recovery date. The latest UI fix distinguishes unavailable refresh from a working connection while retaining loaded messages. Invalid Microsoft redirect registration and account-administration access remain separate open items.

Wardrobe is a separate private Sites application. Do not edit, merge or infer its current source from this main-repo checkout. Main-account/Sites-account binding and outfit-plan calendar transport remain unresolved.

## Actual code versus desired capability

| Responsibility | Existing evidence | Boundary |
|---|---|---|
| Account identity | `lib/auth.js` configuredIdentity and authenticated server routes | Owner is server derived. Current deployment is configured-owner based, not a general multi-user directory. Never accept model/client-selected owner. |
| Conversation lifecycle | `lib/conversation/head-store.cjs`, `storage.cjs`, `lib/routes/conversation.js` | Account-hashed Redis key, atomic CAS, generation and idempotent End receipt. Stores lifecycle metadata, not a durable transcript/task executor. |
| Turn and voice coordination | `conversation-runtime.js`, `conversation-ui.js`, `voice-session.js` | Shared identity and navigation, stale-response rejection, interruption. Recent text is bounded browser sessionStorage (four pairs/10,000 characters); voice closes when hidden. This is not server-side cross-device memory. |
| Workbench persistence | `lib/workbench/storage.cjs`, `workbench/remote-store.mjs` and existing workbench domain/receipts | Owner-scoped versioned storage and operation receipts can inform the new contract. Do not turn projects into running jobs or modify their schema. |
| Legacy Task Pad | `api/tasks.js` | Authenticated array under global `james:tasks`, whole-document SET; no per-owner task ledger, leases, scheduling or outcome receipts. Preserve existing data; do not extend this global key for unattended work. |
| Attention collection | `lib/routes/attention-scan.js` and source adapters | Saved review evidence and foreground collection; not proof of all-folder coverage or closed-app execution. Source failures must remain distinct from empty results. |
| Prior background-mail draft | PR74, branch `draft/mail-background-worker-20261106`, head `12f3f1017c9bb44c3289fd6918a4e2223b4346b1` | Open, unmerged, disabled. Fixed Preview-only receiver, Ed25519 signatures, nonce replay rejection, 180-second lease and separate cron worker. Not a generalized task engine. |

PR74 activation was explicitly approved November6; do not ask for the same approval again. It was blocked by provisioning/access. No worker project, signing keys, CRON_SECRET, receiver flag or real scheduled ticks were established in the inspected evidence. Reconcile its old collector interface and latest paging/compaction changes before reuse; do not blindly merge the old gateway or activate a broad mailbox monitor.

## Architecture decision

Keep James as the single conversational host. A server-owned task ledger is the common truth for typed, voice, scheduled and event-triggered work. Independent workers execute bounded steps behind James; they do not introduce separate user-facing assistants or independent approval authorities.

Extend the established Node/CommonJS application and existing scoped Redis/CAS/receipt patterns. First implement a provider-independent domain core and synthetic process-recovery proof. Keep the storage and execution adapters replaceable. Do not scaffold a replacement app, install another agent framework or replace the working voice runtime to complete this increment.

Evaluate a hosted durable execution adapter after the core proof. Vercel Workflow is a candidate for persisted steps and waits, subject to current framework/package compatibility, access, usage costs and data-retention review. It is not installed or selected by this assignment. A timer in an open tab or an HTTP response left running is not durable execution.

### Shared task contracts

All commands require an authenticated, server-derived owner; worker capabilities are narrower than a user session. Never manufacture or expose a user session token as the general worker authorization mechanism.

| Contract | Required fields and invariants |
|---|---|
| Task | schemaVersion,taskId,owner/workspace scope,revision,objective,kind,input references/digests,optional originating conversation identity,createdAt,updatedAt,status,checkpoint,dependencies,pendingDecision,authorization reference,budget,lease,result/evidence references. One task can outlive a voice conversation; ending speech does not cancel it. |
| Command | operationId,taskId,expectedRevision,action and validated payload. Same operationId and digest returns the recorded result; reused ID/different digest rejects. CAS conflict returns current revision; never silently overwrites. |
| Schedule/event | source account/capability,provider event identity/version,cursor or scheduled occurrence,timezone,effective scope,authorization expiry,enabled/cancel control. Deduplicate delivery and reconcile updates/cancellations. Old forwarded events are not automatically new trips. |
| Lease/checkpoint | workerId,fencing generation,expiry,step ID,attempt,retryAt and durable checkpoint. Only current owner/fence can commit. Expired workers cannot publish a late success. Blocking one task does not hold another task's lease. |
| Authorization | issuer,scope,action digest,input versions,exact target/recipient/attachments/terms,total limit/currency where relevant,expiry,revocation and consumption rules. Recheck immediately before consequential action. Corrected material details invalidate obsolete approval. Worker/model claims are not user approval. |
| Outcome | Keep workflow progress separate from external outcome: prepared/requested/confirmed/failed/unknown. A webhook acknowledgement, opened composer or timeout is not a verified send/order. Unknown outcomes reconcile by provider evidence before retry. |
| Evidence/audit | append-only bounded event IDs,task/operation references,time,coarse status,source version,redacted receipt or result digest. No credentials, private message bodies or precise location in logs. Result artifacts remain in the owner's scoped storage. |
| Notifications | owner-scoped durable outbox and delivery IDs; queued/attempted/delivered/failed/unknown are distinct. In-app status is not proof of push delivery while the app is closed. |
| Budget | maximum concurrent tasks,steps,attempts,wall time and provider cost reservation/settlement, plus per-day limit. Retry and idle work count. Stop or block on exhausted budget; no unlimited retry loop. |

Internal states: queued,running,waiting_for_input,waiting_for_approval,blocked,paused,cancelling,cancelled,completed,failed,outcome_unknown. Store retryAt separately. UI groups these into Working, Needs you, Blocked, Completed, Failed and Unverified inside existing Workbench/Needs Attention. No new competing dashboard.

Use the existing storage backend with a reviewed owner-scoped J30 namespace. Do not migrate or delete legacy Task Pad data in this increment. A later explicit versioned migration must reconcile legacy owner assumptions and preserve recoverable originals. No raw transcript synchronization is implied by task persistence; server conversation memory requires its own bounded contract and retention controls.

## Separate Agent Systems Builder assignment

Start from the inspected integration head on `work/agent-systems-first-proof-20261112`. Work only within the following ownership. A separate builder has not been launched by preparing this assignment.

| Owner | Allowed work |
|---|---|
| Agent Systems Builder | New `lib/task-execution/**`; `tests/task-execution*.test.js`; synthetic fixtures under `tests/fixtures/task-execution/**`; isolated process harness under `tools/task-execution-proof/**`; this design document and a focused evidence note. |
| Lead/integration | Existing auth/gateway/routes,conversation/voice host,Workbench UI,legacy Task Pad,package/lockfiles,Vercel configuration,PR74 integration and all deployments. Builder supplies reviewed proposed seams; does not edit these files. |
| Independent regression reviewer | Verify authorization/isolation,fixtures and recovery independently; rerun existing full/browser/security checks on the exact integration candidate. Do not remove legacy assertions or reinterpret skipped gates as passes. |
| Wardrobe track | Separate Sites owner; no files or data owned by this assignment. |

First bounded deliverable: task state machine, validated commands, injected owner-scoped store/CAS port, receipts, step scheduler with leases/fences, cancellation and cost/retry bounds. Use deterministic synthetic adapters with zero paid/model/real provider calls. Reuse existing CAS patterns without changing shared modules. A versioned storage adapter may use disposable local Redis for the proof; no live database access.

Adapters must return preparation artifacts or verifiable receipts, not free-text claims of success. An adapter reconciliation method handles unknown outcomes. Fake external-action tests should model a lost response and authoritative lookup without ever sending a real message or buying anything.

### First proof and pass evidence

1. Enqueue two fictional tasks through the same task contract: prepare an agenda from a fixture calendar, and prepare a follow-up draft from fictional customer inputs. Use a persisted store outside the worker process. No James tab, microphone, live mailbox or model is needed.
2. Block the draft task on a deliberately missing fixture input. Let the agenda continue independently. Verify both status records and no busy loop on the blocked task.
3. Kill the worker after a recorded agenda checkpoint, restart it, reclaim its expired lease and resume from persisted progress. Verify the old fenced worker cannot commit afterward. A second independent authenticated test client sees the same records; this is simulated second-device evidence, not Michael's actual Android acceptance.
4. Supply the missing fictional draft input, resume and finish. Replay duplicate commands/events and reconcile a simulated lost external response: one recorded result per operation, no duplicate fake action. Test account isolation,concurrent writes,cancel during execution,stale approval,budget exhaustion and unavailable storage.
5. Attach exact commit,commands,fixture identities,checkpoint/receipt evidence and passed/failed/blocked results. Local synthetic process proof is not a real hosted closed-app scheduler or push-notification pass.
6. Lead then wires the core behind disabled authenticated routes and an existing compact Workbench status surface. Prove real hosted scheduled runs with all James clients closed, worker restart recovery and results on a second signed-in device. Review the concrete access/cost change before provisioning; do not change plans or expose credentials.

No real mail scan,calendar write,email/text send,reservation,purchase,application submission,bank operation or external AI subscription is part of the first proof.

## Native engine versus narrow Grok Bot proof

| Option | Evidence and tradeoff | Decision |
|---|---|---|
| James-owned ledger with native execution adapter | Fits existing identity,storage,approval and clean UI. Requires worker hosting,dispatch/recovery and actual closed-app verification; current Vercel provisioning access is unresolved. | Preferred core ownership. First build synthetic/offline proof, then select and review hosting. |
| Vercel Workflow adapter | Official docs describe persisted execution,retries,external-event waits and recovery across crashes/deployments. Current app has neither workflow nor AI SDK installed. Managed run inputs/outputs and usage need review. | Candidate execution transport, not a replacement James or an approved paid installation. |
| Grok Bot routine webhook | Official Grok Bot docs describe a routine-specific POST endpoint with Bearer key. HTTP200 acknowledges startup, not completion; result is described in Bot chat. This differs from Grok-chat automation webhooks using Standard Webhooks/202. | Optional later one-task fictional proof only. A supported machine-readable completion/callback/reconciliation contract,account eligibility,cost and terms must be verified before choosing it. No new account,key,connection,routine or paid run now. |

If a Grok Bot proof is later approved, send only a fictional task ID and bounded fixture input. James retains the canonical task,authorization and outcome evidence. Authenticate/replay-protect any callback; reject changes to scope,recipient,budget or approval state. Treat response200 as requested, never completed. Without an authenticated supported completion path, the proof fails the unattended-integration requirement; manual Bot-chat inspection is not a production adapter.

Grok Bot product identity,cloud work and routine webhook behavior were checked in current official documentation November12. This is not evidence that the complete app can be embedded,that its subscription covers James's use,or that external model/API billing grants Bot-app access. Terms/account eligibility and pricing remain activation decisions. Muse remains an experience reference; no embeddable Muse runtime is established here.

Official references checked (capabilities only,not a licensing opinion):

- https://docs.x.ai/grok-bot/overview
- https://docs.x.ai/grok-bot/faq
- https://docs.x.ai/grok-bot/skills-routines-and-automations
- https://x.ai/legal
- https://vercel.com/docs/workflows

## Phases and the next user review

Phase1: isolated ledger/worker/restart/isolation proof. Phase2: supported hosted execution and compact Workbench integration; actual closed-app and second-device journey. Phase3: server-side bounded conversation memory and one read-only real preparation adapter. Phase4: first reviewed email route with authorization,outcome reconciliation and notifications. Phase5: event-driven trip recognition,approved travel/purchase workflows and additional connections using the same engine.

Mail recovery,protected release checks,Wardrobe account/calendar binding,accessory visual evidence,measured speed/costs,voice auditions and the wider connection wish list remain open alongside this program. No completion implied by this plan. The next Michael review is one concrete closed-app/second-device journey after engineering evidence is ready; no setup or hypothetical questionnaire is needed to prepare Phase1.
