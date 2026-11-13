# J30 dispatcher: bounded hosted proof proposal

November 12, 2026 (Pacific). This is a proposal and engineering checkpoint, not an activated schedule or an approval to spend. The independent builder owns new dispatcher/trigger/outbox modules only; lead retains runtime integration and hosting.

## Source and evidence boundary

Pinned base: GetJames001/-james-app at1c4edc1e46b4197f17c3b844c0d1d6ca877d3505, the default-off PR87 task API/storage/Workbench increment. New branch work/agent-systems-dispatcher-20261112 was created from that exact commit. Existing working integration stays4012695b5cdde4b5801f4d451d7ae2aefa3b40cd and Production remains unchanged. No live REST store, schedule, notification sender, worker credential, external adapter or task flag is introduced by these pure modules or synthetic tests.

First deliverable uses explicit due instants with IANA timezone metadata. It does not parse cron expressions, calculate DST recurrence, ingest actual provider events, or run itself. A supported external invocation is still needed. Do not call a browser timer, an injected test clock or the synthetic process harness a hosted scheduler.

## Current official hosting options

Official documentation was checked November12. Choose after project access, actual build compatibility and scoped spend/privacy review; no option has been installed or activated.

| Option | Fit | Open gate |
|---|---|---|
| Vercel Schedules static private-function target, using the existing James-owned ledger | Current beta supports Preview branches and IANA timezones. A private target has no public URL; the schedule handler receives a stable execution ID for duplicate delivery. Keeps dispatcher ownership independent from hosting. | Verify beta availability and exact build-output/private-target routing for this CommonJS gateway app. No rewrite may expose the private function. Confirm Preview target isolation and bounded function/storage use, then review a small activation diff. |
| Vercel Schedules path target | Can invoke an existing-style authenticated handler on an isolated Preview. | Public route needs a dedicated server secret; a schedule header is not authentication. New persistent access must be reviewed before creating/storing it. Never reuse James's session cookie or pass owner/approval from a payload. |
| Legacy Vercel Cron Jobs | Familiar HTTP trigger, but documented to invoke Production only. | Does not satisfy a Preview-only proof without a distinct isolated worker project. Do not promote main Production or silently create a separate paid project to work around this. |
| Vercel Workflow transport | Managed persisted steps/waits can complement James's task contracts for longer jobs. | SDK is not installed; current app is plain CommonJS. Requires separate package/build compatibility, scope, retention and cost review; no framework rewrite merely to obtain a scheduler. |
| Grok Bot webhook | Optional later fictional adapter comparison. | Supported authenticated completion/reconciliation, eligibility, terms, costs and privacy still unverified. Start acknowledgement is requested, not confirmed. No account, key, subscription or Bot routine created. |

New Schedules and legacy Cron are different capabilities. Current Schedules documentation explicitly permits Production, Preview branches and custom environments; legacy Cron remains Production-only. Schedules is beta and its limits/behavior can change. Dynamic Schedules currently target queues; the static private-function path is the smaller initial compatibility candidate. Function/path schedule failures are not automatically retried; the durable dispatcher must reconcile due pending work on later ticks. Duplicates and late catch-up deliveries remain possible.

## Small hosted acceptance proposal

After applicable approval and access recovery, use one isolated Preview scope and two fictional zero-provider-cost preparation registrations. Proposed schedule: two controlled scheduled invocations, with a conservative15-minute cadence and an explicit stop/disable check afterward; no indefinite every-minute polling. The scheduler invocation may be jittered, so acceptance checks use its scheduled occurrence and actual receipt rather than promise second-exact execution.

Keep maximum2preparations admitted per tick, bounded active wait, finite attempts/delay, no model/API/media spending, no real mailbox/calendar writes and a hard registration capacity. Do not load private emails or real customer data for this proof. Existing worker/adapters must honor their execution deadline; JavaScript Promise.race only bounds waiting and cannot terminate arbitrary hung adapters.

Verify: both registrations are persisted before clients close; one blocks without stopping the other; restart/expired leases reconcile the same task/artifact; duplicate occurrence delivery cannot repeat preparation; cancellation suppresses future dispatch and notification; failed/unknown delivery remains distinct from delivered; a supported notification sender provides a verifiable receipt. Then read results on a second actual signed-in device. In-app outbox/status is not push-delivery evidence.

A notification sender is a separate activation choice. Until selected and authorized, only durable synthetic outbox behavior is tested; do not send Michael emails/texts/pushes from this work.

## Cost and privacy boundaries

Schedules use the resources of their targets: function invocations/compute and storage, or queue usage if selected. No all-inclusive cost is established by a small job count or Michael's earlier Pro upgrade. Actual team plan, remaining credits/usage, Redis pricing and project spend controls must be verified before enabling recurring work. For the initial two-run fixture proof, record invocations, active duration and read/CAS counts; zero provider cost is not zero hosting cost.

Current Workflow pricing lists events at$0.02per1,000, data written at$0.50/GB and retained data at$0.50/GB-month, with function compute separate. Illustrative Workflow-only arithmetic for1,000events,1MBwritten and1MB-month retained is about$0.021 using decimalGB; it excludes compute, Redis, model/search/provider calls, notifications and retries, and is not a quoted total or a recommendation to activate Workflow. Previous cached step-based prices conflict with the current product page, so do not reuse old estimates.

Persist only scoped fictional input/result and coarse operation receipts for the proof. No credentials, session tokens, email bodies or private location in logs. A future Workflow service stores additional execution inputs/results/events and needs explicit retention review; keeping James's canonical ledger does not remove that provider storage.

## Access and activation gates

Read-only project lookup by both the known project ID and name under the known team returned404/not_found through the current connection. Earlier runtime logs/listing returned403. The permitted signed-in dashboard fallback now succeeds: James Pro workspace, james-app settings, and exact project ID prj_SeUz2jQJ2KqxZFMALQsKloLicijw were visibly confirmed. No sign-in, permission, team, project, credential or setting was changed. This establishes that the project exists and the dashboard session can read it; API connection visibility remains unresolved. Do not ask Michael to register accounts or reset working grants. Scheduler management/target compatibility and activation access still require their own concrete verification.

Lead must present the exact scheduled target, isolated environment, new credential/access scope if any, maximum usage/run count, stop control, retention and any charge before applying an activation diff. No infrastructure, plan or Production change is authorized by this document.

Official sources checked:
- https://vercel.com/docs/schedules
- https://vercel.com/docs/schedules/configuration
- https://vercel.com/docs/schedules/handle-runs
- https://vercel.com/docs/schedules/limits
- https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs
- https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing
- https://vercel.com/docs/workflows/pricing
