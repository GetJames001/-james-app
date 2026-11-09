# Privacy processing inventory — code-evidence review, 2026-10-20

This is a source-level inventory, not a production data-retention audit or finalized legal policy. Do not publish as a privacy notice without owner review.

| Feature | Verified source behavior | Unresolved disclosure |
|---|---|---|
| Google Calendar | `api/google/connect.js` requests `calendar.readonly`; `api/google/callback.js` stores a refresh token in Redis; `lib/google/events.js` reads calendar lists/events using a refreshed access token. | Redis retention, backup/deletion path, actual Google API Limited Use compliance, account controller identity. |
| Microsoft Mail | `api/microsoft/mail.js` reads a stored token and uses Microsoft Graph to retrieve inbox counts and a bounded recent message page, including subject, sender, body preview and body. Its declared scope includes `Mail.Read` and `Mail.Send`. | All mail write actions, exact data storage, retention and any sharing. Do not claim mail is read-only. |
| AI email triage | `api/microsoft/triage.js` sends selected email information to the OpenAI Responses API with `store:false`. | What fields are submitted, OpenAI retention and processing terms applicable to the account, and whether any other AI endpoints handle user information. |
| Tasks | `api/tasks.js` reads and writes a persistent Task Pad via Redis. | Retention and user deletion mechanism. |
| Attention | `lib/routes/attention.js` reads an Attention snapshot through Redis. | Snapshot producer, full data lifecycle, expiration and deletion. |
| Authentication | `lib/auth.js` creates signed HttpOnly Secure SameSite=Strict session cookies with an eight-hour maximum. | Any upstream hosting logs, third-party access controls and deletion requests. |

## Security observation for separate remediation
`api/microsoft/triage.js` currently includes an error-logging statement that may log provider response data. Verify whether this path can expose personal content in logs and harden separately; do not expand the privacy release to change Mail code without review.

## Release blockers
1. Confirm controller/operator identity, full provider list and data processing terms.
2. Verify actual retention/deletion across Redis, logs, backups and third parties; provide a working deletion-request procedure.
3. Confirm external AI processing and user consent/disclosures.
4. Approve accurate final text and host a separate public static policy page, without weakening James authentication.
5. Verify public HTTPS access and Google OAuth publication requirements before changing Google authorization.
