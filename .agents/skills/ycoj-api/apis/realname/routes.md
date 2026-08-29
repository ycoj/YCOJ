# Real-name route reference

| Route | Methods / operations | Access |
| --- | --- | --- |
| `/home/realname` | GET form; POST `{realName,school}` | `PRIV_USER_PROFILE`; unverified users allowed |
| `/home/realname/result` | GET status | `PRIV_USER_PROFILE`; unverified users allowed |
| `/manage/realname` | GET list; POST `approve` / `reject` / `revoke` | Super administrator (`PRIV_ALL`) |

Unverified logged-in users are redirected away from all other feature routes until an application is approved.
