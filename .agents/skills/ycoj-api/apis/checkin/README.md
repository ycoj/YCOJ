# Check-in API

## `POST /checkin`

Requires the logged-in user's `PRIV_USER_PROFILE` privilege. Authenticate with `Cookie: sid=...` or `Authorization: Bearer <sid>`. The handler is idempotent for the UTC+8 “today”: it returns the existing record without incrementing the streak when already checked in. `Content-Type: application/json` is recommended.

Request: `POST /checkin` with `{}` (no operation suffix or required fields).

Response: `{ created: boolean; record: { date: string; content?: string; streak: number; [key: string]: unknown }; streak: number }`. Example: `{ "created": true, "record": { "date": "2026-08-19", "content": "...", "streak": 4 }, "streak": 4 }`.

The endpoint can return the same shape with `created:false` on repeat calls. Rate limiting is applied only when creating a new record (5 requests per 60 seconds); external hitokoto failure is reported as an error.
