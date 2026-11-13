# Disabled private schedule build probe

Pinned parent: PR89 `31b6d7d73f6ccf652519a80b91f007e0bcdcc0b2`, tree `f5a3741cab3e94280e891dfdecc9caa3c426b3a3`. All 342 recovered source blobs match. Local recovery ancestry is a snapshot; publish with the actual remote parent. This branch is separate from accepted integration4012695 and PR90's Task Pad fix.

The current Vercel Schedules documentation supports Preview/private function targets, but James uses a catch-all gateway. This probe tests whether Vercel builds a function with only the private `schedule/v1beta` trigger alongside that unchanged gateway. It adds no `schedules` or `crons` declaration, dependency, credential, enabled flag or environment change. No schedule is registered and no background worker is activated. The target returns generic503 for every call and cannot access storage, accounts, models or notifications. It has no gateway mapping or public rewrite. Protected deployment access is unchanged.

The function inventory explicitly classifies the permanently disabled private target, staying within the existing twelve-function inventory limit. Tests cover its no-action behavior for every method and forged metadata; full Chromium/Redis regression and dependency audit run without protected credentials. Passing local tests alone does not establish Vercel build compatibility or scheduler execution.

Required build evidence: exact commit, successful Preview deployment, resource/build listing showing `api/proof-schedule` with its private trigger, and no created schedule. If the platform rejects the configuration or drops the resource, retain the failed evidence; do not alter the accepted gateway or weaken protection to obtain a pass.

After compatibility, the actual transport still needs server-bound fictional owner/proof identity, strict event parsing, runtime deadline and stop behavior, bounded admission/attempts, recorded provider execution IDs, secure result inspection, notification outcome evidence and a concrete resource/cost/cleanup plan before activation. The existing thirty-minute task window stops admitting work; it does not stop platform invocations or billing. An explicit schedule disable/delete is therefore part of the run plan. Dynamic one-time schedules currently target queues; do not assume a one-time private-function target exists.

No live task, mailbox/calendar or separate Wardrobe data is touched. No real-world action or delivered notification is implied. Do not request Michael's second-device check until the engineering journey is ready.

Official references checked November13: https://vercel.com/docs/schedules · https://vercel.com/docs/schedules/configuration · https://vercel.com/docs/schedules/limits
