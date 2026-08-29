# Real-name verification

Logged-in users who are not a super administrator (`priv === -1`) or a judge service account must submit a real name and school and wait for super-admin approval. Until the latest application is `approved`, HTTP and WebSocket handlers other than the allowlisted account/auth/realname/utility routes return `RealnameRequiredError` and redirect to `/home/realname` or `/home/realname/result`.

- [Submit and result](user.md)
- [Super-admin review](manage.md)

Auth is `Cookie: sid=<token>` or `Authorization: Bearer <token>`. HTML denotes a server-rendered body. Redirects are 302, or `type Redirect={url:string}` / `{"url":"/…"}` for JSON-accepting callers.
