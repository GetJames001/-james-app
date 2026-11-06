# Existing Google access audit — November 5, 2026

Michael confirmed Hotmail is primary and Gmail secondary, rarely used for sending. Preserve Hotmail as the default outbound identity; defer Gmail sending. Existing approval gates for outgoing messages remain.

Verified the existing ChatGPT Gmail and Google Calendar connections return the same Michael account profile. These are working connected-service identities, not proof that the separately hosted James OAuth client has a Gmail grant. Earlier Job Assistant evidence documents missing forwarded messages, so direct Gmail reading is useful even if Gmail outbound is deferred.

Add authenticated GET /api/google/capabilities to inspect the existing James Google token-refresh scope response. It only reads the established branch-specific saved Calendar grant and performs its normal refresh. It never writes tokens, requests expanded scopes, creates another OAuth client, reveals credentials or accesses email content. Explicit returned Gmail read scope is granted; explicit scopes without Gmail are not_granted; missing provider scope metadata is unknown, not evidence of disconnection. Gmail send is intentionally not checked.

14 focused checks passed, covering the access response, no secret leakage, absent scope metadata, no provider work before guards, existing isolated Google token storage, preview flow and canonical callback behavior. Hosted capability result follows deployment.

Prior saved-mail bridge correction is verified live at merge 1a5ec8446cc124db1d8f68458507628dece8a1f1: 25 Hotmail message identities were saved and the review restored after a fresh page load. This remains foreground/bounded and does not replace Dot or Job Assistant's scheduled reviews. 90 focused checks passed after fixing inherited live request-header forwarding. No tasks, outgoing messages or Calendar events were changed by live collection verification.
