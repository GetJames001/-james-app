# James public privacy-page implementation plan (review only)

## Goal
Publish an accurate, publicly accessible privacy policy for James without relaxing the existing Vercel Authentication policy on the James application. The privacy contact privacy@getjames.ai has been tested for inbound delivery.

## Separation boundary
- Keep Vercel Authentication on all existing James deployments and endpoints. Do not add a global bypass, disable SSO, or make the current app publicly accessible.
- Publish a separate, static, public privacy-policy site on a distinct Vercel project or Cloudflare Pages site, after owner approval.
- Use a distinct hostname such as **privacy.getjames.ai** initially; do not promise **www.getjames.ai/privacy** until an explicit, reviewed path-routing mechanism is available. A DNS CNAME cannot route by URL path.
- The public site must contain no application code, credentials, API endpoints, user data, tracking, or private asset references.

## Pre-publication requirements
1. Complete factual privacy disclosures: data controller identity, active integrations, third-party processors and AI use, retention/deletion and revocation procedures, contact and effective date. Review Google API Services User Data Policy and Limited Use disclosures.
2. Review the final policy text with the owner. Do not publish the existing internal draft as a complete policy.
3. Choose a separate hosting project and exact public URL; verify ownership of getjames.ai and that DNS changes affect only the proposed privacy subdomain.
4. Verify HTTP 200, valid HTTPS certificate, no login, and accessibility in a private browser session.
5. Verify existing James production remains protected on /, /api/google/events, /api/microsoft/mail, and /api/tasks; ensure no production alias or deployment protection changes.
6. Review tests, changes, and deployment/rollback plan; obtain explicit authorization before publication.
7. Enter the tested policy URL in Google Cloud Branding; confirm OAuth publishing/verification requirements separately. Do not reconnect Google until specifically authorized.

## Status
Plan only. No hosting provisioned, no DNS or Vercel changes, no deployment, no OAuth modification.
