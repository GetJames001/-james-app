# James protected Preview security verification

This verification is browser-only. It does not require Git, Node.js, npm, Vercel CLI, a local repository checkout, or a personal Vercel API token.

The workflow is named **James Protected Preview Security Gate**. Its first, ordinary pull-request run never receives the Vercel bypass value and intentionally skips the protected probe. Only a repository-owner re-run of that exact workflow run can start the secret-bearing job. The re-run fails closed if the approved release PR moved to another head, base, branch, repository, state, or actor.

This revision is a local preparation, not authorization to publish the workflow, open a release PR, change repository settings, create a bypass credential, or run the probe. Each requires the existing approval gates. No release PR number is assumed. Once separately approved, the owner sets Actions repository variables `JAMES_SECURITY_APPROVED_PR` to that open PR number and `JAMES_SECURITY_APPROVED_HEAD` to its full reviewed 40-character head SHA (including this workflow change). Missing values disable authorization. A new commit requires renewed exact-revision approval. The branch is restricted to `review/customer-activity-save-20261021`, with Production base `5953549b64558a2cb6e9b6f9e86acf9e295642b8`. A changed base requires a reviewed workflow update, not a bypass.

Vercel documents Protection Bypass for Automation as available on all plans. The generated value is project-scoped and can bypass Vercel Authentication for every deployment in the `james-app` project until it is revoked. Use a separate, temporary value only for this review, store it only as the encrypted GitHub Actions secret below, and revoke it promptly after the run.

## 1. Create the temporary Vercel automation value

1. In a browser, sign in to Vercel and open the `james-app` project.
2. Open **Settings → Deployment Protection**.
3. Leave **Vercel Authentication** enabled for all deployments. Do not add an exception or sharable public link.
4. Under **Protection Bypass for Automation**, create a separate value named `GitHub Actions — James release review`.
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

This gate uses GitHub's browser-based **Re-run all jobs** control on the exact approved PR workflow run. Do not merge to obtain a Run workflow button.

1. Open the owner-approved release PR and confirm Vercel reports the newest Preview as **Ready**.
2. Open **Actions → James Protected Preview Security Gate**.
3. Select the newest run for that PR and confirm its head commit matches the current PR head and `JAMES_SECURITY_APPROVED_HEAD` exactly.
4. The first attempt should show `manual-authorization` successful and `protected-preview-security` skipped. That confirms ordinary CI did not receive the secret.
5. Select **Re-run jobs → Re-run all jobs**.
6. Leave **Enable debug logging** unchecked, then confirm the re-run.

The gate verifies the repository owner initiated the re-run, the original actor is the owner, the approved PR is still open, and the event head is still the current approved PR head on the expected base and branch. It obtains the immutable Preview URL from GitHub's read-only Vercel deployment metadata and checks the fixed branch host; neither URL nor the bypass value is entered as workflow input. A successful first attempt with the probe skipped is not a security pass.

## 4. Confirm the result

Both jobs must be green on the re-run:

- `manual-authorization`
- `protected-preview-security`

The protected job sends the bypass value only in Vercel's supported `x-vercel-protection-bypass` request header. The runner writes that header to a mode-`0600` temporary file, passes only the temporary filename to curl, never enables verbose or shell trace output, uploads no artifacts, and deletes the temporary directory after every request.

The suite must reach both Preview application gateways and require exact statuses, response headers, JSON bodies, redirects, and cookie behavior. Missing `X-Application-Gateway: enforced`, a Vercel SSO redirect, an unrelated `500`, or any other unexpected status fails the run.

## 5. Remove the temporary access

After the result is recorded:

1. In GitHub, return to **Settings → Secrets and variables → Actions** and delete `JAMES_VERCEL_AUTOMATION_BYPASS`.
2. In Vercel, return to **Settings → Deployment Protection → Protection Bypass for Automation** and revoke/delete `GitHub Actions — James release review`.
3. Clear both approval repository variables after recording the result.
3. Confirm Vercel Authentication remains enabled for all deployments.

If any step fails, leave Vercel Authentication enabled, revoke both stored copies, and report only the job name and non-secret error. Never paste the bypass value into a support message or review comment.
