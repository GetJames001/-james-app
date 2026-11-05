# James workspace consolidation — November 5, 2026

Isolated first implementation increment, following Michael's approval to consolidate overlapping functions. Preserve the accepted entrance and existing records. Finish functional verification before another visual; compare the next visual with the actual app, preserving spaciousness and useful functions.

## Implemented

- To Do has Needs attention and My tasks, using the existing task store and saved Attention review. Saved review remains available in a disclosure; no saved records were migrated or deleted.
- Connected personal Inbox messages now produce conservative review suggestions based on mailbox flags, importance, explicit response requests, bill reminders and career-response signals. The existing Microsoft read endpoint supplies flag and importance metadata. Suggestions remain text, including any embedded email instructions.
- Review in Mail opens the original through the existing reader. Draft a task only fills the existing form; Add task remains the explicit save action. An unfinished task draft is retained.
- Failed refreshes keep suggestions visibly stale; a verified empty response clears them. Review refresh uses the existing foreground Mail controller. Sign-out clears the view.
- All Files is reachable from Workbench, through its existing guarded navigation. Existing project assets and account access boundaries remain intact. Files and the unused Conversations entry no longer occupy top navigation.
- Marin is recorded as Michael's selected friendly voice, changeable later.

## Boundaries and next work

This is not a complete semantic or scheduled mailbox scanner: it checks messages loaded from the personal Inbox, initially the existing 25-message page. It does not cover all older mail, Spam or Trash, run when the app is closed, import Job Assistant/Dot's state, or create tasks automatically. Review suggestions are not proof a bill is genuine or a deadline is correct. Task drafts currently carry the subject, not a durable provider message association.

The All Files entry does not migrate files or add project associations. Existing Workbench project assets remain in their projects. Health/Finance record boundaries are unchanged. Consolidation of contextual files needs inspection before any data-model change.

Next: verify a hosted candidate with the existing configuration; test voice negotiation and audibility with Marin; then connect confirmed mail review items to durable tasks and cross-device follow-through. Existing assistant tool reads do not yet include these mail suggestions. Only after the functional paths pass, prepare a revised visual beside current James, retaining each full-screen workspace and removing redundant decoration. Finance, Health and Wellness, Personal Development, Wardrobe and ambient closet display remain in the approved scope; this increment does not claim to implement those integrations.

## Validation

61 focused checks passed, including actual-app Chromium coverage of suggestion rendering, inert hostile email text, draft preservation, no automatic task/mail writes, stale retention and verified empty results; plus existing Mail gateway, conversation, voice simulation, Files and Workbench navigation checks. No live mailbox, real microphone, hosted deployment or physical-device acceptance is claimed by these checks. Production, accepted preview branches, credentials and entrance media were not changed.
