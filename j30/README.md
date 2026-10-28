# J30 isolated browser-computer proof of concept

This continues GetJames001/-james-app. It creates no assistant, model session, repository, production route, account connection or paid service. The code is not registered in the live gateway. Browser execution defaults to disabled. No live Browserbase/E2B session has been run.

## Selection and exact integration

Select Browserbase REST Sessions + the existing pinned Playwright 1.62.1/CDP runtime for browser-only research. E2B Desktop is the later candidate when a task requires desktop applications, a filesystem and an authenticated desktop stream; it is unnecessary for the shopping pilot. Neither provider is infrastructure supplied by ChatGPT Work.

`browserbase.cjs` creates a fresh 60-second session through `POST https://api.browserbase.com/v1/sessions`, connects using Playwright CDP, and opens an isolated context with service workers/downloads disabled. It exposes only fixed-store search and product readback, not arbitrary click, fill, credentials, shell or JavaScript tools. Shopping input such as “Compare desk lamps under $50” becomes a public IKEA US catalogue query. At most three product pages are read; product name/price must agree between JSON-LD and rendered body text. Receipts include URL, observation time, currency, availability metadata and evidence hash. Ranking compares observed price only, not shipping, taxes, stock or comprehensive product suitability.

HTTP requests are restricted to public HTTPS www.ikea.com/us/en/ GET/HEAD paths; account/cart/checkout/payment paths and other origins are denied. WebSockets are explicitly closed. Provider allowedDomains is defense in depth, not independently verified network isolation. No proxies, automatic CAPTCHA solving, login persistence, logging or recording are requested. A site challenge stops the run; no bypass is attempted. Retailer compatibility remains unverified until a permitted live run.

`shopping.cjs` consumes the existing James `{accountId, conversationId, generation}` and current-turn fence. It revalidates authenticated scope before execution, between steps, after async checkpoint reads, and before reporting. `host.cjs` is an unregistered handler factory: supply existing requireAuth/configuredIdentity and conversation head store, rather than accepting a client account ID or creating a new conversation. It fails closed unless explicitly enabled. Existing api/tasks.js is a persistent Task Pad, not a durable executor; its records are not overwritten or reused as browser state.

For eventual host integration register the bounded research capability on the existing conversation bridge and mount an isolated authenticated handler. Use an appropriate research-request deadline (the ordinary fast-composer deadline is 30 seconds), preserve a task ID in James's current task context, and report the stored status/receipts. Do not claim this registration or hosted database integration is already complete.

`checkpoints.cjs` provides actual atomic, mode-0600 developer file checkpoints with exclusive locks and scope-hashed names. Recreating the store resumes saved progress without re-reading confirmed products. This is not a hosted Redis adapter: Vercel's ephemeral filesystem is unsuitable. An account-scoped transactional hosted checkpoint/lease adapter and its independent tests are required before mounting on James Preview. No stable host files, credentials, existing Task Pad, Customer Activity or Workbench data are modified.

## Persistence, approvals and lifecycle

Task progress survives worker/store restart. Browser cookies/tabs deliberately do not: each resume opens a fresh anonymous session and uses the saved product checkpoints. Browserbase Contexts can retain sensitive authentication data; keepAlive is documented as paid-plan-only. Neither is enabled or tested here. E2B documents filesystem/memory pause-resume; no E2B sandbox or stream was created.

Purchases, cart writes, account connections, logins and subscriptions are hard-denied in this pilot, even if included in the natural-language request. A later consequential-action implementation needs separate scoped approval and readback; no such approval path is exposed now. Public page data is reference evidence and cannot authorize another action.

Two sessions maximum per task, 60 seconds maximum per session. Finalization requests REQUEST_RELEASE, closes the CDP browser, and requires terminal session readback. Uncertain creation, interrupted locks and unconfirmed cleanup prevent blind retries and retain reconciliation state. Cancellation preserves earlier verified receipts, suppresses late results and releases the browser when control returns. This is not a claim of immediate upstream cancellation or an independently verified provider billing cap.

Provider API keys/CDP connection URLs remain server-only and never enter checkpoints, public replies or logs. Each browser has a new incognito context. Both enabled and usageApproved must be set by trusted server configuration; user text cannot set them. No keys or flags have been provisioned.

## Costs checked October 28, 2026

| Provider | Published pricing | Pilot implication |
| --- | --- | --- |
| Browserbase | Free $0, 1 browser hour, 15-minute session maximum. Developer $20/month, 100 browser hours then $0.12/hour. | Attempt free only after explicit account/setup authorization and verification of the actual account's allowance/billing. The public pricing page also says plans can scale beyond included usage, so a zero-charge guarantee is not inferred from marketing alone. |
| E2B | Hobby free with $100 one-time credits; compute usage separate. Default 2 vCPU + 4 GiB rates sum to $0.000046/second, approximately $0.1656/hour. Pro $150/month plus usage. | Not provisioned. Desktop configuration, persistence and stream access need separate live verification and authorization. |

No provider usage, subscription, purchase, model call or account connection was performed. Missing Browserbase project/API credentials and separate authorization for an allowance-verified no-charge pilot block the real public-shopping demonstration. Do not put credentials in chat. No new OpenAI key or model is needed for this deterministic pilot.

## Verification commands

From the existing repository root, with its locked dependencies:

    node j30/preflight.cjs
    node --test tests/j30.test.js tests/j30.browser.test.js

Preflight is presence-only and makes no provider request. Source tests cover scope isolation/revocation, cancellation, atomic restart/resume, duplicate execution, action denial, budgets, cleanup, credential boundaries and default-off behavior. Chromium tests operate a real browser against intercepted synthetic merchant HTML; they are not live retailer/cloud-provider evidence. Exact CI results are recorded in the draft PR after execution.

## Primary references

- https://www.browserbase.com/pricing
- https://docs.browserbase.com/welcome/quickstarts/playwright
- https://docs.browserbase.com/reference/api/create-a-session
- https://docs.browserbase.com/reference/api/update-a-session
- https://docs.browserbase.com/platform/browser/core-features/contexts
- https://docs.browserbase.com/platform/browser/long-sessions/overview
- https://e2b.dev/pricing
- https://docs.e2b.dev/sandbox/persistence
- https://github.com/e2b-dev/desktop
- https://playwright.dev/docs/api/class-browsercontext
