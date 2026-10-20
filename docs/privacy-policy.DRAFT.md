# James Privacy Policy — working draft (NOT FOR PUBLICATION)

Status: DRAFT. This document is not an effective privacy policy. Do not expose as /privacy or submit to Google until factual review and approval are complete.

## Scope
James is a personal AI assistant under development. Its current integrations may access calendar, email, and task information when authorized.

## Google Calendar
The reviewed application requests the Google Calendar read-only OAuth scope `https://www.googleapis.com/auth/calendar.readonly`. It reads calendar information to display schedules and related information. The current callback stores a Google OAuth refresh token in a server-side Redis-backed store.

## Authentication and security
The reviewed application uses an authenticated session and restricts access to the owner. The repository includes protections for session cookies and application host validation. No system can guarantee absolute security.

## Use of information
Connected data is used to deliver authorized James functions. Any claims about use of Google user data must comply with the Google API Services User Data Policy, including Limited Use requirements.

## Third parties
Google and Microsoft integrations, hosting infrastructure, storage services, and any AI processing providers must be accurately identified and their relevant processing practices verified before publication.

## Retention and deletion
**Verification required:** Document actual retention periods for tokens, messages, event data, task data, logs and backups; how to disconnect accounts and delete stored data; and any residual backups.

## Sharing
**Verification required:** Confirm all recipients and processing providers, purposes, and whether information is used for model training, advertising, or other secondary purposes. Do not claim absence of sharing without evidence.

## Contact and effective date
**Verification required:** Designated privacy contact, effective date, operator identity, and applicable legal disclosures.

## Release blockers
1. Validate each statement against production configuration and actual data flows.
2. Confirm deletion, retention, subprocessors and privacy contact.
3. Have the owner approve final wording.
4. Design a narrowly scoped public /privacy route that preserves application and Vercel deployment protection for all other paths.
5. Test public anonymous access to /privacy and denial of private routes.
6. Only after approval, publish and enter the verified URL into Google Cloud Branding.
