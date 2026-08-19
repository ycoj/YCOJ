# Contest routes and operations

All routes are domain-aware. `PERM_VIEW_CONTEST` gates public reads; management handlers enforce ownership or `PERM_EDIT_CONTEST`; operation-specific permissions (print, user, scoreboard, etc.) are checked in the implementation. Browser GETs render HTML/PJAX. POST methods are selected by the body `operation` field; do not invent `/postXxx` URL suffixes.

## Routes

`GET /contest?rule?:RULE&group?:Name&page?:PositiveInt&q?:string` -> `contest_main.html`, `{ tdocs,page,tpcount,groups,q }`.

`GET /contest/:tid` -> `contest_detail.html`, `{ tdoc,tsdoc,pids,pdict,psdict,rdict,rdocs,udoc,... }`. POST operations: `attend` (`code?:string`), `subscribe` (`subscribe:boolean`), `earlyEnd` (manager). They return back/redirect responses. `GET /contest/:tid/problems` -> problem list/PJAX; POST `clarification` uses `{ content:Content, subject:Int }`.

`GET /contest/create` and `/contest/:tid/edit` render edit form. POST fields: `{ tid?:ObjectId; beginAtDate:Date; beginAtTime:Time; duration:Float; title:Title; content:Content; rule:string; pids:Content; rated:boolean; code?:string; autoHide:boolean; assign?:string[]; lock?:UnsignedInt; contestDuration?:Float; maintainer?:number[]; allowViewCode:boolean; allowPrint:boolean; keepScoreboardHidden:boolean; langs?:string[] }`. Response `{ tid:ObjectId }` and redirect `/contest/:tid`. `delete` operation redirects `/contest`.

`GET /contest/:tid/print` and `/api/printing/team` render print HTML. POST operations `print` (`title?,content?`) returns `{success:boolean,output:string}`; `getPrintTask` -> `{tasks,udict}`; `allocatePrintTask` -> `{task,udoc}`; `updatePrintTask` (`taskId,status:"printed"|"pending"`) -> `{success:true}`. Print failures return `{success:false,output}` without redirect.

`GET /contest/:tid/management` -> management HTML/PJAX. Multipart operations `uploadFile` (`filename`, `type?:public|private`, file), `deleteFiles` (`files[]`, type), and JSON `setScore` (`pid:PositiveInt,score:PositiveInt`) redirect/back or return operation JSON. `GET /contest/:tid/clarification` renders clarification management; POST `clarification` accepts `{content,did?:ObjectId,subject?:Int}`.

`GET /contest/:tid/code?all:boolean` returns code-view HTML/model. `GET /contest/:tid/file/:type/:filename?noDisposition:boolean` redirects to a signed binary URL (`type=public|private`). `GET /contest/:tid/user` -> `{tdoc,tsdocs,udict}`; operations `addUser` (`uids:number[],unrank?`), `rank` (`uid`), `resume` (`uid`), `removeUser` (`uid`). `GET /contest/:tid/balloon?todo:boolean` -> balloon HTML/model; operations `setColor` (`color`) and `done` (`balloon:ObjectId`).

`GET /contest/:tid/scoreboard[/:view]` renders scoreboard data/HTML; POST `unlock` returns a redirect/back result after management permission. Browser-negotiated page requests render HTML, signed-file redirects become JSON `{url}` under JSON negotiation, and endpoints that explicitly call `binary()` remain binary.

## Common request/response contract

Authenticate with `Cookie: sid=...` or `Authorization: Bearer <sid>`; JSON clients send `Content-Type: application/json`, while upload operations require `multipart/form-data`. Object IDs are 24-hex strings. With `Accept: application/json`, logical redirects serialize as HTTP 200 `{ "url":"/..." }`; normal browsers receive redirects. Successful JSON examples: `{ "tid":"665f00000000000000000001", "url":"/contest/665f00000000000000000001" }`, `{ "success":true }`, `{ "tasks":[],"udict":{} }`. Validation errors identify the decorated field; failed permission checks are rejected before model mutation.
