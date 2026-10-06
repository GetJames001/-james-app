# Direct Capture

Capture is independent of imports, Odoo and ZoomInfo. Michael can enter or use
keyboard dictation for a Work/Personal callback, next action or appointment draft,
review its exact fields, then explicitly save it in James. Records can be edited,
completed or reopened using version-bound confirmation. Callbacks display open
captured entries; existing Tasks and their `james:tasks` storage are unchanged.

Appointment drafts are James-only records, visibly labeled **Not added to Google
Calendar**. They do not enter the live Google appointments list, affect the next
confirmed appointment, invite anyone or send messages. Device-local start/end are
converted into explicit instants with the displayed IANA timezone. Nonexistent or
repeated clock-change times are rejected rather than guessed. Changing a draft on
a different timezone device displays and reconfirms that device's local times.

The authenticated gateway dispatches GET/POST `/api/capture` to a non-function
module. POST requires same-origin validation before parsing or accessing storage.
Records use a separate owner namespace derived from the configured identity hash,
independent of session-secret rotation. This remains a single-owner application;
changing the configured identity selects a different namespace and requires an
explicit migration decision. No user-supplied storage namespace is accepted.

Each record is limited to a 200-character title/contact, 2,000-character notes and
a supported enum/date schema. Bodies are capped at 12 KiB, records at 500. Existing
stored values are fully validated. An atomic EVAL checks the exact raw snapshot,
expected revision and operation fingerprint before HSET; operation replay keys
expire after 24 hours. Identical retries reuse the same operation ID and payload.
Changed payloads under that ID conflict. Updates preserve creation time. Network
failure retains confirmation/form content; ambiguous saves must be verified by
retrying the same confirmation before it can be discarded. This retry state is
in memory only; abandoning/reloading the page requires checking saved records
before entering the same item again. Corrupt storage fails closed without clearing records.

Tests use synthetic records and a modeled Redis transport, including concurrent
revision conflicts. They do not execute Lua against live Redis. Browser coverage
checks iPad layout, confirmation/retry identity, safe text, filtering and explicit
calendar-draft wording. A controlled later test should verify atomic behavior on
an isolated store before a Production write smoke test is authorized.

No live Redis, Google/OAuth changes, connected-data actions, deployment or task
migration is performed during implementation. This increment does not make
James capable of writing appointments into Google Calendar.

The calendar status polish keeps successful status compact and places source,
timezone and read-window details behind a native expandable disclosure. Partial,
stale and unavailable warnings stay visible. The greeting uses the device clock
immediately at application startup rather than waiting for the minute timer.
