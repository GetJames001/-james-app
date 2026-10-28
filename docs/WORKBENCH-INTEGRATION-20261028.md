# Recovered Workbench host adaptation

Base: 1bd8f93fcf4864b64a72ad8b367d2b4521022dd9. Working Preview unchanged.
Recovered base ZIP SHA256: 6d22d4fbf298b0de95ba30fde6f0da2bac31ea47631dfe2cef7b5b02046028c7. Documented five-file correction extracted with byte/hash checks; HTML and generated page hashes verified. Lead and independent reviewer each ran all 46 supplied tests successfully.

Reuse recovered UI/domain/session modules. Add current James auth, same-origin gateway, Workbench-only Redis keys, atomic document+receipt CAS, protected assets, navigation and current conversation scope. No old host HTML, public identity-header trust, D1 migration, new conversation owner or real external action.

Local adapter/backend/VM suite: 201 passed, 0 failed, 2 skipped before final independent stale-End regression. Independent focused review: 24 passed, 0 failed/skipped. Final suite result must be recorded separately. Browser-inclusive run failed due missing Chromium; official download returned truncated archives. No browser pass claimed.

Outstanding: actual hosted browser/database/CAS/readback, device/theme, synthetic integration UI flow, full canonical voice/tool bridge, and demonstrated forced-revocation recovery/export. Opening Workbench requires an existing ready James conversation; End is not silently reversed. Imported UI accurately discloses disconnected voice/generation/uploads. Source/VM evidence is not Live release approval.
