# James protected Preview security verification

This verification is browser-only. It does not require Git, Node.js, npm, Vercel CLI, a local repository checkout, or a personal Vercel API token.

The workflow is named **James Protected Preview Security Gate**. Its first, ordinary pull-request run never receives the Vercel bypass value and intentionally skips the protected probe. Only a repository-owner re-run of that exact workflow run can start the secret-bearing job. The re-run fails closed if PR #9 moved to another head, base, branch, repository, state, or actor.

Vercel documents Protection Bypass for Automation as available on all plans. The generated value is project-scoped and can bypass Vercel Authentication for every deployment in the `james-app` project until it is revoked. Use a separate, temporary value only for this review, store it only as the encrypted GitHub Actions secret below, and revoke it promptly after the run.

## 1. Create the temporary Vercel automation value

1. In a browser, sign in to Vercel and open the `james-app` project.
2. Open **Settings → Deployment Protection**.
3. Leave **Vercel Authentication** enabled for all deployments. Do not add an exception or sharable public link.
4. Under **Protection Bypass for Automation**, create a separate value named `GitHub Actions — James PR #9 review`.
5. Do not paste the generated value into ChatGPT, a URL, a PR, an issue, a command line, a document, or a message. Keep the Vercel page open only long enough to paste it directly into GitHub in the next section.

If the option is unavailable, requires a purchase, or the account does not have permission to create it, stop. Do not use a personal Vercel token or another credential as a substitute.

## 2. Store it as an encrypted GitHub Actions repository secret

1. In another browser tab, open `GetJames001/-james-app` on GitHub.
2. Open **Settings → Secrets and variables → Actions**.
3. Select **New repository secret**.
4. Enter this exact name:

   `JAMES_VERCEL_AUTOMATION_BYPASS`

5. Paste the Vercel value directly into the secret field and save it.
6. Clear the clipboard history. Do not display or copy the saved value again.

The workflow does not expose this secret to ordinary pull-request CI. It is mapped only into the protected probe step after the exact-head, owner, branch, base, deployment, and manual re-run checks pass.

## 3. Manually launch the exact-head protected run

GitHub only offers the **Run workflow** button for `workflow_dispatch` files already present on the default branch. PR #9 must remain unmerged, so this gate uses GitHub's browser-based **Re-run all jobs** control on the exact PR workflow run instead.

1. Open PR #9 and confirm Vercel reports the newest Preview as **Ready**.
2. Open **Actions → James Protected Preview Security Gate**.
3. Select the newest run for PR #9 and confirm its head commit matches the current PR head exactly.
4. The first attempt should show `manual-authorization` successful and `protected-preview-security` skipped. That confirms ordinary CI did not receive the secret.
5. Select **Re-run jobs → Re-run all jobs**.
6. Leave **Enable debug logging** unchecked, then confirm the re-run.

The gate verifies the repository owner initiated the re-run, the original actor is the owner, PR #9 is still open, and the event head is still the current PR head on the expected base and branch. It obtains the immutable and branch Preview URLs from GitHub's read-only Vercel deployment metadata; neither URL nor the bypass value is entered as workflow input.

## 4. Confirm the result

Both jobs must be green on the re-run:

- `manual-authorization`
- `protected-preview-security`

The protected job sends the bypass value only in Vercel's supported `x-vercel-protection-bypass` request header. The runner writes that header to a mode-`0600` temporary file, passes only the temporary filename to curl, never enables verbose or shell trace output, uploads no artifacts, and deletes the temporary directory after every request.

The suite must reach both Preview application gateways and require exact statuses, response headers, JSON bodies, redirects, and cookie behavior. Missing `X-Application-Gateway: enforced`, a Vercel SSO redirect, an unrelated `500`, or any other unexpected status fails the run.

## 5. Remove the temporary access

After the result is recorded:

1. In GitHub, return to **Settings → Secrets and variables → Actions** and delete `JAMES_VERCEL_AUTOMATION_BYPASS`.
2. In Vercel, return to **Settings → Deployment Protection → Protection Bypass for Automation** and revoke/delete `GitHub Actions — James PR #9 review`.
3. Confirm Vercel Authentication remains enabled for all deployments.

If any step fails, leave Vercel Authentication enabled, revoke both stored copies, and report only the job name and non-secret error. Never paste the bypass value into a support message or review comment.
