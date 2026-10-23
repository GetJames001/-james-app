# James conversation foundation — held after hosted failure

Extends the reviewed aabcfda candidate. Preview publication was authorized; hosted acceptance failed. The stable branch was restored by forward commit 91c4ef10a620a1b2201365cf5f80df839a0fa494 to the exact original tree edacf7d168c9f91acff14045e029667785024a7e. No merge or Production promotion occurred.

## Current investigation — 2026-10-23

Hosted checks did not produce a visible AI reply. End displayed success while a subsequent lifecycle GET still reported the same active generation. The cause of the hosted stall remains unproven. No provider, browser, or storage failure has been established as the cause.

A definite local UI defect was found: every End result other than `unconfirmed` was displayed as success, including `closed` (local identity absence) and `superseded`. The isolated candidate now requires `ended` to display success. When a start response was lost, End reads the authenticated server head and closes that exact identity before reporting success. An uncertain result blocks a fresh ask until closure is confirmed. Sign-out cannot be overwritten by a late End response.

Validation: `node --test tests/conversation*.test.js tests/auth.test.js` — 37 passed, zero failed or skipped. Coverage includes lost start response with committed server head, uncertain closure/retry, late End after revocation, and a typed request through the actual classic runtime's default loader. The fixture uses in-memory storage and a controlled provider response; this is not hosted browser or real-provider acceptance.

The diagnostic candidate is isolated from PR #36 on `investigate/conversation-host-20261023`. The restored stable Preview remains in place. Hosted request/response diagnosis and end-to-end acceptance are still required before republishing this increment.

## Behavior

The James request area uses the recovered conversation identity and bridge controllers. Typed requests and the existing one-utterance dictation button share the same request handler and current-page history. End cancels local pending presentation and input/audio, clears current-page history, and requests durable closure of the exact conversation head. An uncertain closure is shown explicitly and can be retried. Late replies cannot overwrite the latest accepted answer or an unsent draft. Private API failures preserve the draft.

The server authenticates the conversation lifecycle route with existing session/host/same-origin controls. Account identity is server-selected. A new `james:conversation:v1:` namespace stores lifecycle metadata using atomic compare-and-swap. No customer record migration or provider credential change is included. The existing OpenAI connection and fast/Council routes are reused; no new model or paid voice session is configured.

## Limits

- This is not completed continuous audio. Browser dictation still captures one utterance, and live microphone/device/provider acceptance remains open.
- Only lifecycle metadata is durable. Message history remains in the current page and clears on reload/End/sign-out; no durable memory claim.
- Ending local work cannot undo an already accepted provider request or consequential action. This increment creates no new consequential tools.
- Controller fixtures, signed-session route checks and disposable Redis checks are local evidence. Hosted UI/storage acceptance must be recorded separately after deployment.
- Existing working login/intro artwork, Calendar, Mail, Tasks and Customer Activity remain the release baseline. Historical protected security evidence applies to aabcfda only, not automatically to this new revision.

Keep Original Dot's continuity audit read-only until Lead Dot prioritizes its findings. Keep Production staging/promotion and physical-device QA gates open.
