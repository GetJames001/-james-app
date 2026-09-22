# James Preview credential setup

Use this only after PR #9 has passed code review. The helper runs locally, prompts for the password securely, and does not make network requests or write credentials to disk.

1. On Michael's Windows computer, download or clone the reviewed PR #9 repository.
2. Open Windows PowerShell in the repository folder. Do not put the email, password, hash, or secret in the command line.
3. Run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Generate-JamesPreviewCredentials.ps1
   ```

4. Enter the intended login email at the first local prompt.
5. Enter the intended password at the masked local prompt. The plaintext password remains in the local PowerShell process and is never transmitted by the helper.
6. The helper prints exactly three generated values. In Vercel, open the `james-app` project, then **Settings → Environment Variables**.
7. Create these variables for **Preview only**:

   - `JAMES_AUTH_EMAIL`
   - `JAMES_AUTH_PASSWORD_HASH`
   - `JAMES_SESSION_SECRET`

8. Paste each generated value directly from the local PowerShell window into its matching Vercel field. Do not paste any value into ChatGPT, GitHub, a URL, a command argument, a ticket, or a message.
9. Redeploy the PR #9 Preview so it receives the Preview variables. Close the PowerShell window and clear clipboard history if any value was copied through the Windows clipboard.

The helper is excluded from Vercel deployment by `.vercelignore`. It uses PBKDF2-HMAC-SHA256 with 310,000 iterations, a random 16-byte salt, and an independent random 32-byte session secret.
