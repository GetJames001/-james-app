# James conversation foundation — Preview increment

Extends the reviewed aabcfda candidate. This increment is approved for Preview publication, not merge or Production promotion.

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
