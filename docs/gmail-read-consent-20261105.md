# Gmail read consent — November 5, 2026

Michael has five minutes and authorized continuing. Prepare the actual read-only Google consent step using existing James OAuth configuration; no new account/client/secret. Hotmail stays the primary/default sender; Gmail sending deferred.

To Do → Mail connections → Enable Gmail reading submits an authenticated same-origin POST, then opens Google's account selection/consent page for gmail.readonly, incremental grants and offline access. Reuses the registered existing callback URL. Gmail-prefixed random state uses a separate secure HttpOnly cookie; callback requires the James session, matching state, explicit granted read scope and successful Gmail profile read. Gmail token/profile save uses an owner/environment/preview-branch namespace distinct from every Calendar token. No mail is sent or changed. Google consent must be performed by Michael; do not grant expanded access on his behalf.

22 focused tests passed including existing Calendar callback/token isolation, Gmail state/scope/profile/save failures and no secrets in response. No consent was granted during testing. Consent alone does not implement Gmail collection or semantic review. Next is integrating the granted Gmail reader into the existing bounded Attention pipeline and showing source/coverage; then folder/window/Sent reconciliation and Travel draft imports. If Google rejects verification, inspect Gmail API enablement and existing OAuth project configuration before proposing another connection.

Underlying combined Preview before this increment: 99688e21fc9082909965152b46d01567aeb5ecd5. Saved Hotmail review remains verified with 25 identities persisted/restored; Calendar and Marin were user-tested. Original closet wall-display mockup remains the agreed reference; longer wall-device session is proposed, not implemented. Pause when Michael leaves; no claim of background work after the turn.

## Forbidden initiation correction — November 5 evening

Michael reported FORBIDDEN. Reproduced the hosted form POST: James rejects it before Google. The app's no-referrer policy suppresses the form navigation Origin, so the existing CSRF gate correctly denies it. Replaced form navigation with an authenticated same-origin fetch POST returning a validated Google authorization URL, then same-window navigation. The CSRF gate, no-referrer policy, Calendar grant, existing credentials, and Gmail scope are unchanged. Inline failure status permits retry.

Validation: 27 focused tests passed, including real auth rejecting absent/null/foreign Origins and allowing only matching Origin; JSON initiation; safe client navigation and failures; existing Calendar callback/storage and login bootstrap checks. Chromium fixture with no-referrer response verified the real browser sends its Origin for fetch POST and navigates to the synthetic Google chooser. Live hosted verification still required after deployment; no Google consent granted by agent.

## Safe callback diagnostics — November 5 evening

The initial failed live callbacks returned 503, then later callbacks returned 400. The precise original stage/provider cause is not known; a disabled Gmail API is only a possibility. Clearing the state cookie before token exchange means refresh of an already handled callback correctly fails state validation and cannot reveal the original provider error.

Added structured `JAMES_GMAIL_CONNECT_FAILED` entries with only: independent random diagnostic ID, controlled stage, HTTP status (or null), exact allowlisted provider reason (or null), and controlled internal reason. The error page displays these safe fields, correlates with logs, and instructs a fresh connection rather than callback refresh. Provider free text, descriptions, URLs, codes, state, cookies, tokens, secrets, email addresses and exception objects are never passed to the diagnostic sink. Malformed/oversized JSON retains only status; network/timeouts have no invented status. Storage error payloads never supply a provider reason. Logger failures do not alter the authorization result.

State equality/format checks and cookie deletion timing are unchanged. Gmail uses its existing separate token key; Calendar handlers/configuration/credentials are unchanged. No sign-in or permission granted by the agent.

Validation: 46 focused tests passed. Coverage includes configuration, OAuth 400/401, Gmail 403/429, recognized versus unrecognized provider reasons, storage HTTP failures, invalid/oversized response, network/timeout, secret canaries, denied/wrong state, replay after success and every failed provider stage with deleted browser cookie, retained-cookie provider-code replay (invalid_grant; no second save), and failing log sink. Existing Gmail initiation, Calendar grant isolation/callback and login bootstrap tests pass.
