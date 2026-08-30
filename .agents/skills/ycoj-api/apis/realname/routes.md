# Real-name route reference

| Route | Methods / operations | Access |
| --- | --- | --- |
| `/home/realname` | GET form; POST `{realName,school}` | `PRIV_USER_PROFILE`; unverified users allowed |
| `/home/realname/result` | GET status | `PRIV_USER_PROFILE`; unverified users allowed |
| `/manage/realname` | GET list with optional `page`, `status`, and case-insensitive username substring `uname` filter; POST `approve` / `reject` / `revoke` | Super administrator (`PRIV_ALL`) |

Logged-in users who have not submitted, or whose latest application is still not `approved` after the seven-day grace period, are redirected away from other feature HTTP routes. Users inside the grace window may use those routes. Public versioned UI assets (`/lazy/:version/:name`, `/resource/:version/:name`, `/plugins/:version/:name`) are not redirected. WebSocket handshake does not throw `RealnameRequiredError`; the `/websocket` gateway rejects channel subscriptions for profile users who are neither approved nor within the grace period.
