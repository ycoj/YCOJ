# `POST /checkin`

Description: create today’s UTC+8 check-in, or return today’s existing record.

Request: `type Request = {}`. Example: `POST /checkin` with `{}`.

Response: `type Response = { created:boolean; record:ReturnType<typeof toCheckinRecord>; streak:number }`. Example: `{ "created":true,"record":{"date":"2026-08-19","streak":4},"streak":4 }`; repeat example `{ "created":false,"record":{"date":"2026-08-19","streak":4},"streak":4 }`.

Auth: `PRIV_USER_PROFILE`, `Cookie: sid=...` or Bearer sid. JSON response; rate limit applies on creation.
