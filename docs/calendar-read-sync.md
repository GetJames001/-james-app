# Google Calendar read synchronization

This change refreshes the existing Google connection initially, on foreground return,
on entry to Briefing or Appointments, manually, and every 60 seconds while either
calendar page is visible. Requests are shared, separated by at least five seconds,
and bounded by a 30-second client deadline. Server reads have an eight-second
individual request deadline and a 25-second overall budget, including response parsing.

Selected non-holiday calendar names are displayed so Michael can verify the source.
No calendar ID or work/personal account identity is assumed. Reads cover the previous
24 hours through the next 90 days. Today's events use the device timezone. The grid
covers 7 AM–7 PM; the Appointments list also retains out-of-hours and all-day events.
All-day ends are exclusive; overnight and multi-day events intersecting today remain.

Pagination and resource limits are disclosed as incomplete coverage. A failed,
malformed or truncated source retains its last successful in-memory events. Successful
empty sources clear only their own old events. Only a complete source-list response
can remove previously known source names. Failed refreshes retain prior events with
an explicit stale warning; unavailable or incomplete data never establishes a clear
schedule. These caches do not survive reload, sign-out or a new document.

No calendar creation/update, OAuth consent, account connection, local storage,
Redis task mutation, Odoo/ZoomInfo import or production deployment is introduced.
The existing server retrieves the existing refresh token; provider event calls are GET.

Acceptance: controlled provider tests cover pagination, empty/error/malformed results,
timeouts and method/auth boundaries. Domain tests cover day boundaries, DST, partial
merge, lifecycle, visibility, deduplication and retry. A mocked browser regression
covers safe provider text and preservation of events/source names during failure.
A later read-only physical-device check should confirm expected Google source names,
foreground return, manual refresh and navigation. This does not prove calendar writes
or establish that every owned calendar is a work calendar.
