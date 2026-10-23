# Integrated James release candidate

This branch is the configured review lane for PR #36. It integrates the clean conversation application delta from b253ede033803e8481b4625a19ba8d2c251fecfe and the isolated Chromium fixture from 14cf7020678d5a02c9b0c0e957b401297587d273 onto 91c4ef10a620a1b2201365cf5f80df839a0fa494. Calendar, Microsoft Mail and Customer Activity implementations are unchanged.

Do not promote until this exact revision passes CI, authenticated hosted conversation and integration checks, independent review, owner-authorized hosted security checks, and staged Production verification. Keep prior immutable deployments available for rollback. Preview configuration is not proof of Production readiness.

Required server configuration: JAMES_FAST_MODEL must name an explicitly supported model; there is no implicit fallback. Existing Google branch configuration must remain scoped to this review lane. No credentials should be copied to other branches for convenience.

Local focused verification: 54 passed, zero failed or skipped. Prior isolated CI: 229 passed, zero failed, two intentionally skipped gates; the latter are not release acceptance passes. Run combined CI after this commit and record its exact head and deployment.
