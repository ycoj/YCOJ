# Submission record routes

All pages use the current domain from the request context. Browser requests render HTML; JSON/PJAX requests receive the corresponding body model. Login and contest/problem visibility rules are enforced by the handlers.

| Method and route | Query/body | Result |
|---|---|---|
| `GET /record` | `page?:PositiveInt,pid?:ProblemId,tid?:ObjectId,uidOrName?:UidOrName,lang?:string,status?:number,fullStatus?,all?,allDomain?,stat?` | `record_main.html`; model includes `rdocs`, `pdict`, `udict`, pagination and optional `statistics`. |
| `GET /record/:rid` | `download?:boolean,rev?:ObjectId` | `record_detail.html`; model includes `rdoc`, problem/user/contest context and revisions. |
| `GET /record/:rid?download=true` | same | Binary/source download redirect (signed storage URL), with attachment disposition. |
| `POST /record/:rid` | operation dispatched from body (`rejudge` or `cancel`) | Operation-specific redirect/back response; see below. |
| WebSocket `/record-conn` | `tid?,pid?,uidOrName?,status?,pretest?,all?,allDomain?,noTemplate?` | Live record list updates; payload is the rendered record list unless `noTemplate`. |
| WebSocket `/record-detail-conn` | `rid:ObjectId,noTemplate?` | Live detail/status updates for one record. |

The exact POST operation is the body operation (`operation: "rejudge"` or `operation: "cancel"`), not a URL suffix. `rejudge` requires the handler's contest/problem management permission and returns `{}`/back after enqueueing; `cancel` requires ownership or the applicable management privilege and returns `{}`/back. Examples: `POST /record/665f...` with `{ "operation":"rejudge" }`; `POST /record/665f...` with `{ "operation":"cancel" }`.

Headers: authenticate with `Cookie: sid=...` or `Authorization: Bearer <sid>`; `Accept: application/json` selects JSON where supported. HTML/PJAX responses may carry `X-PJAX` fragments. Record detail code/file downloads are binary or redirects, not JSON.

## Connection wire format

These `ctx.Connection` routes use Hydro's WebSocket connection handshake (the initial URL query is validated by the decorated `@param` fields). No SSE fallback is registered by this package. Authenticate with `Cookie: sid=...` or `Authorization: Bearer <sid>`; filters that expose other users/hidden contest records are rejected unless the corresponding `PERM_VIEW_RECORD`, hidden-scoreboard, or `PRIV_MANAGE_ALL_DOMAIN` checks pass. A client may send `{ "rids":["665f00000000000000000001"] }` on `/record-conn` to request current records by ID.

`/record-conn` events are debounced (~100 ms) from `record/change` and are one of:

* `{ html: "<tr>...</tr>" }` (default, rendered `record_main_tr.html`);
* `{ udoc, pdoc, rdoc }` when `noTemplate=true`;
* `{ rdoc }` with code/input omitted when `pretest=true`.

`/record-detail-conn` sends `{ status, status_html, summary_html }` by default, or `{ rdoc }` with `noTemplate=true`. Code and compiler text are blanked unless the viewer is the submitter or has `PRIV_READ_RECORD_CODE`, `PERM_READ_RECORD_CODE`, or accepted-record code permission. Completed records close after 30 seconds (close code `4001`, reason `Ended`). Example detail event: `{ "status":1, "status_html":"<div>Accepted</div>", "summary_html":"<section>...</section>" }`.
