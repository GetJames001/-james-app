# REVIEW DOT — hosted conversation verification handoff

Status: candidate awaiting hosted verification; not a release pass.

Stable PR #36 remains at 91c4ef10a620a1b2201365cf5f80df839a0fa494. Its app tree is the original approved tree edacf7d168c9f91acff14045e029667785024a7e. Do not merge or promote based on this handoff.

Candidate branch: investigate/conversation-host-20261023. Resolve its exact deployed revision and URL before testing; do not substitute the stable branch. Existing login/authentication and provider configuration must be reused without weakening security or sharing credentials.

## Independently verify

1. Sign in normally. Record browser/device, candidate commit and deployment identifier.
2. Submit a harmless typed request asking for a short fixed reply. Require a visible response, not merely a successful deployment or request initiation.
3. Expand Connection diagnostics. Record stage timestamps and HTTP statuses only. No credentials, prompts, customer details, calendar or mail content should be included in shared evidence.
4. End the conversation. Require server-confirmed End, then navigate directly to `/api/james/conversation` in the same signed-in host. Verify `status: ended` for the same generation. A local message alone does not pass.
5. Reload and confirm the persisted head remains ended before starting again. A fresh request must create a new conversation ID and next generation.
6. End during a pending reply; ensure late replies do not appear. Preserve an unsent draft. Repeat End and check it does not close a subsequent conversation.
7. Sign out during a pending request or End. No late reply or status may override signed-out state. Private routes must reject unauthenticated requests.
8. Check Calendar, Mail and Customer Activity on the stable Preview with read-only actions. Do not create real activities or reconnect providers solely for this test. New branch OAuth configuration may differ; report that separately from regressions.

Report passed, failed, blocked and untested separately. Local evidence is 37 focused checks passing; it is not hosted acceptance. Hosted reply stall has no proven cause yet. End's false success classification is a confirmed local UI defect corrected in the candidate. Any exact blocker must include the first failed boundary and observed evidence.

Continuous voice, background notifications, durable transcript memory and Production readiness are outside this increment. Review findings from Original Dot remain pending Lead Dot prioritization.
