# Personal Mail read/unread updates

Opening an unread Personal Mail message explicitly marks it read. The detail control can mark it unread again, or retry marking read after failure. Viewing the list, restoring the previously displayed detail, and automatic/manual refresh do not write message state.

The existing authenticated `/api/microsoft/mail?account=personal` endpoint accepts PATCH with exactly `{messageId, isRead}`. Authentication and same-origin protection precede provider access. Work-account updates and other fields are rejected. Graph receives only `isRead`. A successful response requires Microsoft to return the requested state. A separately fetched inbox count replaces the briefing count only when verified; otherwise the prior count stays and the user is prompted to refresh. Requests are bounded to 15 seconds.

The UI serializes mutations and deduplicates repeated identical requests. A mutation invalidates older read responses. It updates message dots only after a confirmed result and preserves the prior state/count on failure. Marking unread while detail remains open does not immediately mark it read again during re-render or refresh.

## Microsoft consent

Microsoft requires delegated `Mail.ReadWrite` for this Graph operation, including personal accounts. This is broader mailbox permission even though this application mutation accepts only read status. Personal connect/callback request it; Work connection remains unchanged. Normal GET and reply POST retain their existing refresh scopes. Existing connections continue to read; insufficient mutation permission produces a reconnect link. The user must reconnect Personal Mail and complete Microsoft's consent screen. No credentials or consent are changed by publishing this code.

Provider reference: https://learn.microsoft.com/en-us/graph/api/message-update?view=graph-rest-1.0

## Acceptance

Use synthetic provider responses for automated gateway/auth/method/validation, confirmed read/unread and count, permission/error/timeout, token rotation, UI pending-state, restoration and stale-read checks. After authorized deployment and user consent, open one selected unread message and confirm its dot and both mailbox/briefing counts update; mark it unread and confirm reversal. No message is sent, deleted, or moved by these controls.
