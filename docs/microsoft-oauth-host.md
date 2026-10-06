# Microsoft Mail reconnect host correction

Authorization previously set host-only state cookies on the user's James domain, but both authorization and token exchange hardcoded the callback to james-app-seven.vercel.app. The browser therefore did not send the state cookie after Microsoft returned to the other domain.

Both steps now derive the callback from the validated request Host, through a shared helper. Forwarded headers, Origin and query parameters cannot choose the callback. State-cookie validation, private gateway and host restrictions remain enforced.

## Deployment prerequisite

Confirm these **Web** redirect URIs are registered on the existing Microsoft application before merging/deploying:

- https://getjames.ai/api/microsoft/callback
- https://www.getjames.ai/api/microsoft/callback

Retain the existing legacy redirect URI. Do not rotate credentials or change scopes for this correction. Microsoft requires the redirect URI to match a registered URI exactly. Preview hosts also need registration if live OAuth is explicitly tested there; synthetic tests do not require registration.

After deploying, start a fresh reconnect from James; an old callback URL cannot be retried. Michael must personally complete Microsoft sign-in and consent. Then verify opening unread mail updates its dot and count and Mark unread reverses the change.

Regression tests cover complete synthetic connect/callback round trips on both production domains and the legacy host, unchanged secure host-only cookies, matching authorization/token-exchange URI, invalid-state rejection without provider access, and spoofed/untrusted host rejection. Live consent remains a user verification step.
