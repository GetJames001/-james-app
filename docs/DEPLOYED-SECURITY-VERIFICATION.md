# James deployed security verification

Run this only after the PR Preview has deployed the exact commit under review. It uses Vercel CLI's authenticated `vercel curl` command, which obtains a temporary deployment-protection token for the signed-in Vercel team member. It does not require changing Vercel Authentication, creating an automation-bypass secret, or placing a secret in Git, chat, a URL, or a command argument.

## One-time local setup

Open Windows PowerShell in the reviewed repository checkout and run:

```powershell
npm install --global vercel@latest
vercel login
vercel link --project james-app --scope james-cb7a
vercel whoami
```

Complete Vercel sign-in only through the official local browser flow. Never paste a Vercel token, login code, password, or protection token into ChatGPT, GitHub, a command argument, or the repository. The local `.vercel` directory is ignored by Git.

## Exact-head gateway probe

Replace the immutable URL below with the immutable deployment URL tied to the final PR commit. Keep the branch URL as the second value.

```powershell
$env:JAMES_SECURITY_USE_VERCEL_CLI = "1"
$env:JAMES_SECURITY_PREVIEW_URLS = "https://IMMUTABLE-PREVIEW.vercel.app,https://james-app-git-security-single-user-auth-james-cb7a.vercel.app"
npm run test:deployed-security
Remove-Item Env:JAMES_SECURITY_USE_VERCEL_CLI
Remove-Item Env:JAMES_SECURITY_PREVIEW_URLS
```

The probe uses curl's `--request-target` with `--path-as-is`, so raw dot segments are transmitted without client normalization. Every application-boundary response must contain `X-Application-Gateway: enforced`, exact status and security headers, and no private fixture signatures. A Vercel SSO redirect, unrelated `500`, missing gateway marker, or unexpected status fails the test.
