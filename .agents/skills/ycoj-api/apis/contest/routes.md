# Contest route reference

This is the implementation-backed route index; operation names are request-body dispatch names.

| Route | Handler result |
|---|---|
| `GET /contest` | HTML `contest_main.html`; filters `rule`, `group`, `page`, `q`. |
| `GET/POST /contest/create` | Edit HTML; POST update returns `{tid}` and redirects to detail. |
| `GET/POST /contest/:tid` | Detail HTML; `attend`, `subscribe`, `earlyEnd` operations. |
| `GET /contest/:tid/problems` | Problem list HTML/PJAX; clarification POST operation. |
| `GET/POST /contest/:tid/edit` | Edit/delete; same validated fields as create. |
| `GET/POST /contest/:tid/print`, `/api/printing/team` | Print HTML or `{success,output}`; print-task operations. |
| `GET/POST /contest/:tid/management` | Management HTML; file and score operations. |
| `GET/POST /contest/:tid/bulk-submit` | Bulk-submit HTML; POST zip of contestant C++ sources (see [bulk-submit.md](bulk-submit.md)). |
| `GET/POST /contest/:tid/clarification` | Clarification HTML; clarification operation. |
| `GET /contest/:tid/code` | Code view HTML (`all` filter). |
| `GET /contest/:tid/file/:type/:filename` | Signed-download redirect; `type` public/private. |
| `GET/POST /contest/:tid/user` | User management model; add/rank/resume/remove operations. |
| `GET/POST /contest/:tid/balloon` | Balloon HTML; setColor/done operations. |
| `GET/POST /contest/:tid/scoreboard[/:view]` | Scoreboard HTML; unlock operation. |

Decorated parameters and permission checks are documented in [README.md](./README.md). GET responses are HTML unless a PJAX/JSON request asks for the handler body; uploads are multipart and downloads are binary redirects.
