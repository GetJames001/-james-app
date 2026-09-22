# James Vercel Live Council v0.4.0

This package is the deployment bridge between the current James website and the six-seat Executive Council.

## Files to add to the James repository

- `api/council.js`
- `api/[...route].js` (application, authentication, and health routes)
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

## Private prototype authentication

James requires three server-only Vercel Environment Variables:

- `JAMES_AUTH_EMAIL` — Michael's exact allowed sign-in identity.
- `JAMES_AUTH_PASSWORD_HASH` — a PBKDF2-SHA256 password hash, never a plaintext password.
- `JAMES_SESSION_SECRET` — an independently generated random value of at least 32 bytes.

Generate the password hash locally without committing the password or hash:

```sh
read -rs JAMES_PASSWORD_TO_HASH
export JAMES_PASSWORD_TO_HASH
node scripts/hash-password.js
unset JAMES_PASSWORD_TO_HASH
```

Add the resulting hash directly to Vercel, then remove the temporary shell value.
Never place any of these values in frontend code, a URL, browser storage, Git, or logs.

The application session lasts eight hours in an `HttpOnly`, `Secure`,
`SameSite=Strict` cookie. Keep Vercel Authentication enabled for all deployments
until this application boundary has passed review and has been deployed to
production.

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
