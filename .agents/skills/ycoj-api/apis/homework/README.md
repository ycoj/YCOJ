# Homework routes

Detailed per-route contracts: [endpoints.md](./endpoints.md). This file is the scope index and compatibility summary.

Routes are domain-scoped and use contest-style permissions. `PERM_VIEW_HOMEWORK` gates reads; edit/create/delete and scoreboard permissions are checked by handlers. GETs render HTML/PJAX; POSTs dispatch by request body operation (not a suffix).

* `GET /homework?group?:Name&page?:PositiveInt&q?:string` -> `homework_main.html`, `{ tdocs, page, tpcount, groups, q }`.
* `GET /homework/:tid?page?:PositiveInt` -> `homework_detail.html`, `{ tdoc, pids, pdict, psdict, rdict, ... }`.
* `POST /homework/:tid` `{ operation:"attend" }` enrolls/attends and redirects back.
* `GET /homework/create` or `/homework/:tid/edit` -> edit HTML. `POST` fields: `{ tid?:ObjectId; beginAtDate:Date; beginAtTime:Time; penaltySinceDate:Date; penaltySinceTime:Time; extensionDays:Float; penaltyRules:Content; title:Title; content:Content; pids:Content; rated:boolean; maintainer?:number[]; assign?:string[]; langs?:string[] }`; response `{ tid:ObjectId }` and redirect `/homework/:tid`. `penaltyRules` is validated/converted by the server.
* `POST /homework/:tid/edit` `{ operation:"delete" }` deletes after ownership/management checks and redirects `/homework`.
* `GET /homework/:tid/file` -> files HTML/model; multipart `POST` operation `uploadFile` (`filename`, file) and JSON `deleteFiles` (`files:string[]`) redirect back.
* `GET /homework/:tid/file/:type/:filename?noDisposition:boolean` redirects to a signed binary URL (`302 Location` for browser; JSON negotiation returns HTTP 200 `{url:string}`); `type` is `public|private`.
* `GET /homework/:tid/scoreboard[/:view]` (view requires `PERM_VIEW_HOMEWORK_SCOREBOARD`) renders contest scoreboard HTML.

Authenticate with `Cookie: sid=...` or `Authorization: Bearer <sid>`. JSON clients should send `Content-Type: application/json`; uploads use `multipart/form-data`.
