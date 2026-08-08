# James Vercel Live Council v0.4.0

This package is the deployment bridge between the current James website and the six-seat Executive Council.

## Files to add to the James repository

- `api/council.js`
- `api/health.js`
- `lib/` (all files)
- `vercel.json`
- `package.json`
- `council-test.html` (temporary internal test page)

## Vercel secret

Create a Vercel Environment Variable:

`OPENAI_API_KEY`

Do **not** put the key inside any GitHub file.

Optional:

`JAMES_DEFAULT_MODEL`

## After deploy

Visit:

`/api/health`

Expected:

```json
{
  "ok": true,
  "service": "james-live-council",
  "version": "0.4.0",
  "openai_configured": true
}
```

Then visit:

`/council-test.html`

Enter a question and click **Run Executive Council**.

That will be the first billable, provider-backed six-seat Council meeting.

## Important

This release does NOT alter the current intro or Daily Briefing UI. It adds the Council safely alongside the existing site. After the endpoint passes its live test, the next release will connect the existing James input/voice interface to `/api/council`.
