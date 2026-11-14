# Customer Activity save investigation — 13 November 2026

Base: accepted integration source `4012695b5cdde4b5801f4d451d7ae2aefa3b40cd`.

An unchanged Customer Activity browser check failed on PR92 commit `1176217bcc185dbf26e0fb53b993f62cc9a0c887`, run 43526891894 attempt 1, job 132234758776. The autofill/dictation journey waited 30 seconds for the overlay to close. The same commit passed on the next attempt; that does not establish a fix or a root cause.

This isolated diagnostic candidate changes no application code. The existing fictional practice journey runs 20 times with fresh browser contexts, with no failure retries. On failure it reports only synthetic form values, visible validation/save status, click targets and page errors. Existing saved-record failure, conflict, lost-acknowledgment and duplicate-write browser checks also run. No account, saved customer data, voice Preview or production setting is used or changed.

A passing diagnostic run means the original problem was not reproduced in that run. Do not close the issue or call it fixed without evidence of a cause and a targeted regression.

## Narrow related repair

The first diagnostic candidate744aa248 passed32/0/0 in run43533469697/job132256628006, including all20 original save-and-close repetitions. The original intermittent overlay failure remains unexplained.

Review found a separate deterministic gap in the company-only Save handler: it constructs its payload and validates cached details before `commit()` captures current field values. Autofill or dictation without input events can therefore save old company/contact details and bypass current-value validation. Capture actual fields before validation/payload construction, with the existing busy/uncertain guards. Keep unsaved activity drafts separate.

A new saved-record browser case verifies actual company/contact values, blank-contact rejection without a write, retained activity drafts and lost-acknowledgment reconciliation without duplicate writes. A CI-only baseline probe removes precisely the two added statements and requires the stale-value assertion to fail, then restores the candidate before the full Chromium/Redis suite. No production data or voice Preview is used. Final evidence is recorded in the PR and master checklist; no deployment security result is inherited from PR91/92.

## Candidate-specific hosted security continuation

Incoming runtime b58500e9 passed532total/531passed/0failed/1ordinary protected-test skip in run43533855288/job132257930104, audit0. The accepted-file baseline reproduction succeeded. This is separate from the unproven intermittent close failure.

The customer branch now has its own exact-PR93/base4012695/owner-rerun security binding and reviewed immutable/branch deployment mapping. The existing encrypted automation credential is restricted to the gated job; ordinary CI never receives it. Added unauthenticated customer-script/API and alternate-method probes; corrected the old logout assertion to the existing Strict cookie policy. No application runtime change in this continuation. Full CI now uses the normal one original close journey; the optional bounded20-run diagnostic remains available for new evidence, and prior20-run results remain recorded. Do not count a skipped ordinary test as a hosted pass or inherit another candidate's result.
## Hosted gate correction — November 13, 2026 (Pacific)

Head `9e0f3eab514bfa8133cadc98566eeff4c6ab57bb` passed the full suite (516 total, 515 passed, zero failed, one ordinary protected-test skip; audit zero) in run43537960259/job132271433434. Ready Preview `https://james-j4yaznmij-james-cb7a.vercel.app/`, deployment GihWP8cmtwanYfVyfhMVNwC5zU1u, was verified in the Vercel dashboard. The candidate-specific security attempt2 (run43537960306/job132273291223) then failed 4/1/0 because the new probe expected401 from `/api/customer-database` but received404.

Source review confirms an existing intentional distinction: Customer Activity is authenticated, while Customer Vault is enabled only on its original and accepted integration branches. This isolated repair branch is outside that allowlist; it does not activate Vault or access saved Vault records. The security workflow now explicitly requires the exact private gateway404/NOT_FOUND response for Vault, including queried and alternate-method paths, while all authenticated Activity and asset routes still require401. An arbitrary platform404, successful payload, redirect, cookie or missing gateway marker cannot pass. Runtime routing, feature allowlists and account data remain unchanged. This is a correction to the test's scope, not a newly discovered data exposure or proof of a signed-in Vault journey.
