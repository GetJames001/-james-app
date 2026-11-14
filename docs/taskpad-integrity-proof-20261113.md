# Task Pad integrity candidate — November 13, 2026

Logical base: accepted integration `4012695b5cdde4b5801f4d451d7ae2aefa3b40cd`, tree `441429fd16a47aaeced79bc3dd3b78612559fb95`. All 305 recovered blobs match the remote Git tree. Local recovery history is only a snapshot; publish this delta with the real remote parent, never push snapshot ancestry over the existing branches.

## Change and ownership

The legacy Task Pad previously replaced `james:tasks` without checking another client's edits, accepted HTTP-200 storage error envelopes as a save, and returned an empty list for corrupt data. The browser also cleared loaded tasks after a failed refresh and permitted edits before a successful load.

This isolated candidate owns `api/tasks.js`, the Task Pad sections of `app.js`, their tests and a credentials-free CI workflow. PR89's task engine, the accepted integration branch and the separate Wardrobe Site are untouched.

- GET supplies a SHA-256 revision of the exact stored value. Missing storage is distinct from corrupt or unavailable storage.
- POST requires the revision and atomically compares the full prior value before writing, using the existing customer-activity CAS Lua script. A stale or racing writer gets 409 without overwriting the winner.
- Existing array format and unknown task properties remain intact. This is not a migration or cleanup. Invalid records are left untouched and reported unavailable.
- Input limits: 2,000 tasks, 1 MiB serialized array, unique nonempty string IDs up to 256 characters, nonempty titles up to 2,000 characters. No record truncation or inferred metadata repair.
- Storage has a five-second transport deadline, rejects redirects, bounds streamed responses and validates error envelopes and commit results. Upstream messages never reach the client.
- The UI blocks edits during loading, unavailability and saves; retains loaded records and typed drafts; refreshes after a conflict or uncertain response without automatically repeating the write. New task IDs use UUIDs. An acknowledged save does not erase a newer title typed while the save was pending.
- **Every Vercel Preview is read-only for this candidate's legacy Task Pad.** There is no live-write opt-in flag. It may show the authenticated owner's existing tasks but POST returns 403 before storage access. This protects the shared live database while engineering validation uses fictional isolated stores.

## Verification

Local focused auth, Task Pad and retained-content checks: **36 passed, zero failed**. Local native regression suite: **455 total, 452 passed, zero failed, three environment-dependent skips**. The newly added actual-Redis test is one of those skips because this local runtime lacks Redis.

The two browser tests could not launch locally because the installed Playwright package has no matching Chromium executable. No browser assertions ran; this is not a product acceptance pass. The candidate workflow installs pinned-lockfile dependencies, Chromium and disposable local Redis, then runs the complete suite and dependency audit without protected deployment credentials. Attach its exact head/results before claiming browser or Redis completion.

New tests cover two-client stale writes, a commit-time race, actual Lua CAS against disposable Redis, corrupt/invalid/oversized storage, storage error envelopes, malformed inputs, missing revisions, session/CSRF/method checks, Preview no-write behavior, lost responses, preserving other-client additions/drafts, unavailable empty states, disabling edits and late read suppression. Fixture transport is local or fake; no live task writes are required.

## Release limits

The existing old Production and Preview endpoints can still write the old shared key without CAS. This candidate cannot retroactively constrain those older deployments. A later release must coordinate all writers or use a separately reviewed versioned-storage migration with preserved records; merely deploying another Preview does not secure all existing writers. Single-owner legacy storage is not new multi-account isolation.

No live-data read/write was needed for these tests. No main/accepted-branch change, production promotion, migration, service activation, account change or Wardrobe edit is included. PR89's five protected security checks remain evidence for PR89 only; they do not automatically certify this candidate.

## Background proof remains separate

PR89 remains `31b6d7d73f6ccf652519a80b91f007e0bcdcc0b2`. A new read-only Vercel lookup still returned project-not-found through the connector; earlier dashboard access is not evidence of API visibility. No setting or access change was made.

Current official documentation confirms new Schedules supports Preview branches and private function targets; legacy Cron is Production-only. The private function must have only the `schedule/v1beta` trigger, and no public route/rewrite. Function-target compatibility with James's catch-all build must still be demonstrated. One-time dynamic schedules currently support queue targets, so a one-time private function cannot simply be assumed. Target usage consumes platform resources; no zero-cost or plan-change claim follows from fictional tasks.

Next hosted work: a disabled/private-function build compatibility probe, exact Preview/source verification, current usage and bounded activation/stop plan, then provider-scheduled execution evidence with clients closed. Do not substitute a manual request, CI process or queued outbox item for a real scheduled run or delivered notification. Michael's one actual second-device journey follows engineering readiness.

References: https://vercel.com/docs/schedules · https://vercel.com/docs/schedules/configuration · https://vercel.com/docs/schedules/limits
