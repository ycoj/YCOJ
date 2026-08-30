# Identity and user routes

- [Authentication, registration, recovery, OAuth, and account routes](auth.md)

All browser-authenticated endpoints accept either `Cookie: sid=<session-token>` or `Authorization: Bearer <session-token>`. `Accept: application/json` converts handler redirects to the logical response `{url:string}`; a normal browser receives HTTP 302.

Real accounts may have an optional administrator-managed `accountExpireAt`. Missing means unlimited. At/after that instant, the next authenticated request, login, or new connection atomically bans the account with `PRIV_NONE` and deletes all of its tokens; an active browser request continues as a guest. Existing long-lived connections are checked when they reconnect, not closed by a background scheduler. Extending or clearing an expiration restores privileges only when the ban was created by this automatic expiration process.
