# Workday Pilot — synthetic CSV import

This first increment tests importing and reviewing synthetic work records. It is not a live company-data integration. Use only the bundled `assets/workday-pilot-synthetic.csv` or synthetic fixtures that follow its schema. Do not upload customer contacts, company exports, equipment records, pricing, or other employment data.

## What to check

1. Open the Workday Pilot and load the bundled synthetic CSV.
2. Review the parsed records and any validation or identity conflicts before accepting the import.
3. Confirm repeated imports do not silently duplicate or overwrite records. Resolve the displayed conflicts explicitly.
4. Review the source-linked account/action information. Work prioritization and scheduling belong to a later increment; this import screen does not generate a workday plan.
5. Export the accepted synthetic dataset before a full page refresh, signing out, navigation away from James, or closing the tab.

## Memory boundary

Pilot data is always memory-only in this increment. No localStorage, IndexedDB or server persistence is added. Records survive navigation between James's internal pages while the document remains open. A full refresh, signing out, navigating away from James, or closing the tab loses the records. Export first to keep a synthetic backup; it is not a company-system backup. There is no cross-device synchronization.

The Sign out action clears and hides the in-memory pilot and invalidates pending reads before the existing logout flow continues. Returning through a browser-history cache reloads the document. This adds no new authentication mechanism or persistent account binding. The existing James authentication boundary remains in use. Clear the synthetic pilot explicitly when finished if keeping the James page open.

## Deliberate limits

- No real calendar is written, updated, or deleted.
- No company database or company record is accessed or changed.
- No global Redis-backed Tasks record is read, seeded, imported, or changed by the pilot.
- No OAuth scopes, tokens, account connections, or reconnection flows change.
- No Mail mutations or paid/model calls are part of this test.
- The only export in this increment is a JSON synthetic pilot backup. There is no activity-transfer export or verified FieldServio import format yet.

The gateway protects the pilot scripts, stylesheet and synthetic fixture under the existing James authentication boundary. The fixture is synthetic; protected delivery does not make real company-data use approved.
