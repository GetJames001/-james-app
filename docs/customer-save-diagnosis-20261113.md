# Customer Activity save investigation — 13 November 2026

Base: accepted integration source `4012695b5cdde4b5801f4d451d7ae2aefa3b40cd`.

An unchanged Customer Activity browser check failed on PR92 commit `1176217bcc185dbf26e0fb53b993f62cc9a0c887`, run 43526891894 attempt 1, job 132234758776. The autofill/dictation journey waited 30 seconds for the overlay to close. The same commit passed on the next attempt; that does not establish a fix or a root cause.

This isolated diagnostic candidate changes no application code. The existing fictional practice journey runs 20 times with fresh browser contexts, with no failure retries. On failure it reports only synthetic form values, visible validation/save status, click targets and page errors. Existing saved-record failure, conflict, lost-acknowledgment and duplicate-write browser checks also run. No account, saved customer data, voice Preview or production setting is used or changed.

A passing diagnostic run means the original problem was not reproduced in that run. Do not close the issue or call it fixed without evidence of a cause and a targeted regression.
