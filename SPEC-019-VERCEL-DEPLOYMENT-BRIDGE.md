# SPEC-019 — Vercel Live Council Deployment Bridge

Goal:
Deploy the Executive Council as a server-side API without disturbing the stable James UI.

Acceptance criteria:
- `/api/health` reports whether the provider secret is configured without revealing it.
- `/api/council` accepts POST requests only.
- API key remains server-side.
- Existing intro and briefing files require no changes for this deployment.
- A temporary internal test page can run a live Council meeting after deployment.

Rollout:
1. Upload deployment bridge files.
2. Configure OPENAI_API_KEY in Vercel.
3. Verify health endpoint.
4. Run one live Council test.
5. Only then wire the production UI to the endpoint.
