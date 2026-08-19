# Identity and user routes

- [Authentication, registration, recovery, OAuth, and account routes](auth.md)

All browser-authenticated endpoints accept either `Cookie: sid=<session-token>` or `Authorization: Bearer <session-token>`. `Accept: application/json` converts handler redirects to the logical response `{url:string}`; a normal browser receives HTTP 302.
