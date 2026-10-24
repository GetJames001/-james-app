# Conversation release preparation — October 23

Publication authorization: Michael approved publishing after independent review and remaining release checks. Do not ask for the same approval again. Approval does not convert an untested build into a verified release.

## Preserved references

- Independent-review candidate remains 63ab958cd82f2a3e612b08ee9bd15549d908a6b9 on investigate/conversation-host-20261023, deployment 9QeWz2RB122myN8bE9boEkCWUeA2.
- Stable PR #36 remains 91c4ef10a620a1b2201365cf5f80df839a0fa494 until integration is reviewed.
- Production main remains 5953549b64558a2cb6e9b6f9e86acf9e295642b8.

## Release cleanup

Remove the temporary model inventory GET endpoint and on-screen connection trace. Preserve bounded transport aborts, truthful error status, draft retention and server-confirmed closure. Remove exact-branch model selection and the implicit failed-model fallback. The Fast handler requires the non-secret server configuration JAMES_FAST_MODEL; absent/invalid configuration returns a fixed 503 before provider work. Model access failures remain 502 and must not revoke a valid James session. Existing credentials/auth/CSRF/account isolation are preserved.

Configure JAMES_FAST_MODEL=gpt-5.6-luna for the final candidate before hosted testing. This is the existing connection's model that actually answered on 63ab958. Preserve store:false, low reasoning for that model and the 800-output-token cap. Do not change credentials or broaden permissions. A separate staged Production deployment must verify its own configuration; Preview success does not certify Production configuration.

## Validation recorded before publication of this cleanup

- Focused conversation/provider/auth suite: 50 passed, zero failed/skipped.
- Broader server/source/Redis run: 193 reported tests, 192 passed, zero failed, one skipped hosted security gate. It excludes files named *.browser.test.js and explicitly excludes the embedded Calendar browser-rendering test. This is not a full-suite pass. The 50 focused checks overlap this count.
- Disposable real Redis adapter/atomicity/recovery test passed using local loopback and synthetic credentials.
- Full local browser run blocked by missing matching Playwright Chromium 151 download; an official older Chromium 141 download succeeded but startup was rejected by the environment's Unix-socket restriction. No environment-security bypass was attempted. Browser and exact-final-revision hosted acceptance remain open.

## Remaining release gates

1. REVIEW DOT independently verifies the supplied 63ab958 candidate; record passed/failed/blocked/untested results.
2. Configure the clean candidate's model and verify actual typed reply, persisted End after reload, new generations, pending End, failed-request recovery, navigation and sign-out on the exact new revision. Run CI/browser/security checks without treating skipped probes as passes.
3. Reconcile final source diff and integrate into PR #36 without overwriting its stable baseline. Update its description around the final release, including approval and all outstanding gates.
4. Test a Production-configured staged build without assigning live domains. Preserve existing Calendar, Mail, Customer Activity and storage boundaries; no unapproved real-data writes.
5. Publish only after required independent/device/security/staging gates pass. Michael's publication approval is recorded; report the actual final URL/build and verified outcome.

Historical diagnostic documents in this branch describe investigation states; this readiness document governs release preparation. Temporary diagnostic endpoints and the branch-specific model override must not return in the final diff.
