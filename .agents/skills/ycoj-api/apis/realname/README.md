# Real-name verification

Logged-in users who are not a super administrator (`priv === -1`) or a judge service account must submit a real name and school and wait for super-admin approval. Until the latest application is `approved`, HTTP handlers other than the allowlisted account/auth/realname/utility routes and public versioned UI assets (`/lazy/:version/:name`, `/resource/:version/:name`, `/plugins/:version/:name`) return `RealnameRequiredError` and redirect to `/home/realname` or `/home/realname/result`. WebSocket handshake does not throw `RealnameRequiredError`; the `/websocket` subscription gateway rejects unverified profile users at subscribe time unless the connection is a privileged gateway.

- [Submit and result](user.md)
- [Super-admin review](manage.md)

Auth is `Cookie: sid=<token>` or `Authorization: Bearer <token>`. HTML denotes a server-rendered body. Redirects are 302, or `type Redirect={url:string}` / `{"url":"/…"}` for JSON-accepting callers.
