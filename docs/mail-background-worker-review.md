# Background mail worker — activation review

Status: draft, disabled. Foreground automatic refresh is independently deployed in PR73.

A separate Vercel project rooted at `mail-monitor-worker` can run once per minute while James is closed. This is the worker project's Production deployment only; do not promote the main James application. It calls only the fixed existing Preview branch's collector. Native Vercel cron does not target Preview deployments directly.

## Access boundary

The worker receives a new Ed25519 signing key and CRON_SECRET, never Google/Microsoft OAuth credentials. The receiver holds the public key, is disabled by default, and accepts only the fixed Preview branch/host. Signed requests expire after 60 seconds; durable nonce rejection and a 180-second execution lease prevent replay and overlap. In-process collector invocation uses a 60-second owner session, never returned externally. Responses/logs contain coarse status only. Existing Calendar grants and mail tokens remain unchanged. No sending, deletion, task creation, or Calendar writes.

## Approval and activation

Explicit approval is required before creating/activating this new private-mail service. After approval, create the separate worker project from the reviewed branch/root, generate keys without printing them, configure the worker's private key and CRON_SECRET securely, and add only the public key plus `JAMES_MAIL_BACKGROUND_ENABLED=true` to the existing Preview branch scope. Review existing deployment protection before activation; do not weaken protection globally. Verify two real scheduled ticks while the browser is closed and confirm saved source timestamps advance. Disable by removing the receiver flag; revoke/rotate the worker signing key if necessary. Do not claim the worker is live until this verification passes.

## Current limits and follow-up

The collector checks up to 25 Inbox messages per source, not all folders or every historical message. Gmail history checkpoints avoid repeated metadata reads when unchanged. Source failures retain prior results with stale coverage. Handled decisions suppress an unchanged version, with a transient 10-second UI Undo; evidence remains in the existing bounded store.

Deleted/moved messages and sent replies are not yet reconciled into saved attention evidence. A reply does not necessarily complete an obligation. Existing storage bounds are 300 source versions, 600 handled hashes, and 1 MiB; capacity failure is visible, but compaction is not implemented. Before sustained always-on use, add reconciliation and bounded retention/compaction so old evidence cannot accumulate indefinitely. No automatic push alerts or guaranteed instant detection: foreground checks every 30 seconds while visible; proposed closed-app cron checks approximately once per minute, subject to hosting/provider availability. Assess provider/API usage after activation; do not promise a fixed all-inclusive cost.

Validation: five focused security tests cover disabled/Production rejection, expired/tampered signatures, payload injection, replay, overlap, failure redaction, cron authentication, fixed target and signature verification. PR73 has 102 focused tests and seven browser flows passing; its Preview deployment reports success.
