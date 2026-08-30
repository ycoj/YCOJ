# YCOJ API documents

This is the routing index for the backend contracts present at source revision `9ee423517944` (2026-08-28). It covers all 137 literal HTTP route registrations, five literal connection registrations, and the indirectly registered `/api/:op` HTTP/connection transport. Routes from optional packages or conditional configuration are documented but exist at runtime only when their package or feature is enabled.

The default base URL is `https://ycoj.cc/`. Every documented route is relative to that base. Prefix a path with `/d/{domainId}` when selecting a domain by URL rather than host; for example, `/p` in domain `school` becomes `https://ycoj.cc/d/school/p`.

| URL or operation | Documents | Includes |
| --- | --- | --- |
| `/p`, `/p/*`, `/problem/*`; problem `/api` ops | [Problem](problem/README.md) | Search, detail, create/edit, submit/hack, files, solutions, statistics, compatibility/import routes, problem queries/mutation |
| `/contest`, `/contest/*` | [Contest](contest/README.md) | Lists, details, creation/editing, problem list, management, bulk submit, files, users, print, balloons, scoreboard, onsite-toolkit routes |
| `/homework`, `/homework/*` | [Homework](homework/README.md) | Creation/editing, attendance, files, code, scoreboard |
| `/training`, `/training/*` | [Training](training/README.md) | Lists, plans, editing, files and downloads |
| `/record`, `/record/*`, `/record-conn`, `/record-detail-conn` | [Record](record/README.md) | Submission search/detail, rejudge/cancel, live record streams |
| `/status`, `/status/*` | [Status](status/README.md) | Judge/system status and updates |
| `/checkin` | [Check-in](checkin/README.md) | Daily check-in mutation |
| `/home/realname`, `/home/realname/result`, `/manage/realname` | [Real-name](realname/README.md) | User submission/result plus super-admin review; users who have not submitted, or whose review is still unfinished/rejected after a seven-day grace period, are blocked from other feature HTTP routes except public versioned UI assets (`/lazy/*`, `/resource/*`, `/plugins/*`). WebSocket handshake does not throw `RealnameRequiredError`; `/websocket` rejects subscriptions outside the grace period. |
| `/login`, `/logout`, `/register*`, `/lostpass*`, `/user/*`, `/oauth/*`, `/contestmode` | [Identity](identity/README.md) | Authentication, account recovery, profiles, OAuth, sudo/TFA/WebAuthn |
| `/domain/*`, `/ranking`, `/manage/*` | [Domain and management](domain/README.md) | Domain users/roles/groups/joining plus system administration |
| `/`, `/home/*`, `/discuss*`, `/blog/*`, `/paste*` | [Community and home](community/README.md) | Home/account pages, settings/messages, discussions, blogs and pastebin |
| `/file*`, `/storage`, `/judge/*`, `/metrics`, `/center/report`, `/onlyoffice-jwt`, `/heap-snapshot`; runtime connections | [Runtime](runtime/README.md) | File/storage APIs, judge integration, monitoring/add-ons, WebSocket/SSE contracts |
| `/ui/*`, `/media`, `/markdown`, `/wiki/*`, `/language/*`, `/account/*`, `/lazy/*`, `/resource/*`, `/plugins/*`, `/legacy`, `/set_theme/*` | [UI and utility](ui/README.md) | Navigation/media rendering, UI assets, compatibility/session utilities |
| `/api/:op`, `/api/:op/conn` | [Operation transport](api/README.md) | Query/Mutation request protocol, projection, connections, registered non-problem operations |

Within a group, use its `README.md` only as an index and open the linked endpoint document. A registered path can expose GET, POST, multiple POST `operation` values, or a connection; follow the contract for the exact variant being called.
