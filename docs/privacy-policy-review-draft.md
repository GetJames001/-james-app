# James Privacy Policy — internal review draft (NOT PUBLIC)

Status: DRAFT. Do not deploy, publish, or link from Google OAuth until all verification gates below are complete.
Contact: privacy@getjames.ai (forwarding delivery tested by owner on 2026-10-20).

## Overview
James is a personal assistant that can display authorized calendar information and help organize messages, tasks, and daily activities. This policy will describe data practices for the features actually enabled at publication.

## Google Calendar
The current Google Calendar integration requests the read-only scope `https://www.googleapis.com/auth/calendar.readonly`. James obtains a Google access token using an OAuth refresh token stored server-side in a Redis-backed store. The Calendar read route requires an authenticated James session. The integration does not request Google Calendar write access.

## Other integrations
James has Microsoft mail and task-related functionality. Before publication, verify each active provider, scope, fields processed, and whether message contents or metadata are sent to any AI provider. Do not imply unverified processing practices.

## Security
James uses authenticated sessions, restricted application routes, and server-side token handling. Security is not absolute. Confirm actual production deployment protections before describing them as guaranteed.

## Contact and choices
For privacy questions contact privacy@getjames.ai. Users may revoke Google's authorization through their Google account. The application's procedure for removing stored tokens and other retained data must be verified before publication.

## Required before public release
- Identify the data controller/legal entity and contact details.
- Inventory active integrations, data recipients, AI subprocessors, storage and backups.
- Verify data retention, access/deletion procedures, and how to exercise rights.
- Document Google API Services User Data Policy / Limited Use compliance accurately.
- Decide how to serve /privacy publicly while preserving Vercel Authentication for all other routes; test unauthenticated access and fail-closed behavior.
- Obtain owner's approval of final policy text and exact production/security change.

This document is a drafting artifact only, not a statement of completed compliance.
