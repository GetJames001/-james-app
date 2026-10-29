# Production test-task cleanup plan

This document records the proposed next step. It does not authorize or perform a Production data change.

## Storage mechanism

James Tasks are stored in the existing Production Redis service as one JSON array at the string key `james:tasks`. The authenticated `/api/tasks` endpoint reads that key and replaces the complete array when saving.

The two confirmed test titles are:

- `Fix James weather card`
- `Water the plants`

## Narrow removal procedure

Use a separately reviewed, one-time atomic Redis operation from the controlled Upstash browser console. The operation must:

1. Read only `james:tasks`.
2. Decode the current JSON array without printing task contents.
3. Select entries whose `title` exactly equals one of the two confirmed titles.
4. Abort without writing unless exactly one entry matches each title.
5. Preserve every nonmatching task object and preserve their order.
6. Replace `james:tasks` atomically with the filtered JSON array.
7. Return only the number removed and the final task count—not task bodies, credentials, or other Redis keys.
8. Verify through the authenticated Tasks UI that only the two confirmed entries disappeared.

Do not use `DEL`, `FLUSHDB`, a wildcard scan, a full-database export, or the `/api/tasks` whole-array save path for this cleanup. Do not change Redis credentials or touch OAuth, Mail, Calendar, Weather, or other Production records.
