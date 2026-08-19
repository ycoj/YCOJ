# Homework endpoint contracts

Authentication is `Cookie: sid=...` or `Authorization: Bearer <sid>`. JSON negotiation serializes handler redirects as HTTP 200 `{url:string}`; browser negotiation renders HTML or redirects. Domain and permission checks are enforced by the registered handlers.

## `GET /homework`
Description: list visible homework documents, optionally filtered by group/title and paginated. Request: `type Query={group?:string;page?:number;q?:string}`; `GET /homework?page=1&q=week`. Response: `type Response={tdocs:ContestDoc[];page:number;tpcount:number;groups:string[];q:string}`; `{ "tdocs":[],"page":1,"tpcount":0,"groups":[],"q":"week" }`, rendered `homework_main.html`; requires `PERM_VIEW_HOMEWORK`.

## `GET /homework/:tid`
Description: show homework detail, problems and current user progress. Request: `type Query={tid:ObjectId;page?:number}`; `GET /homework/665f00000000000000000001?page=1`. Response: `type Response={tdoc:ContestDoc;pids:number[];pdict:Record<number,ProblemDoc>;psdict:Record<number,unknown>;rdict:Record<string,RecordDoc>;page:number}`; `{ "tdoc":{"docId":"665f...","title":"Week 1"},"pids":[1001],"pdict":{},"psdict":{},"rdict":{},"page":1 }`, rendered `homework_detail.html`; requires view permission.

## `POST /homework/:tid` operation `attend`
Description: enroll/attend the homework. Request: `type Request={operation:"attend"}`; `{ "operation":"attend" }`. Response: `type Response={url?:string}`; JSON `{ "url":"/homework/665f..." }` or browser back redirect.

## `GET /homework/create`
Description: render the homework creation form. Request: `type Query={}`; `GET /homework/create`. Response: `type Response={page_name:"homework_create";tdoc?:ContestDoc}`; `{ "page_name":"homework_create" }`, HTML `homework_edit.html`; create permission is checked on POST/prepare.

## `GET /homework/:tid/edit`
Description: render an existing homework for editing. Request: `type Query={tid:ObjectId}`; `GET /homework/665f.../edit`. Response: `type Response={page_name:"homework_edit";tdoc:ContestDoc;...}`; `{ "page_name":"homework_edit","tdoc":{"docId":"665f..."} }`, HTML `homework_edit.html`; owner or edit permission required.

## `POST /homework/create` (update operation)
Description: create homework and persist its schedule, penalty rules, problems, languages and maintainers. Request: `type Request={tid?:ObjectId;beginAtDate:string;beginAtTime:string;penaltySinceDate:string;penaltySinceTime:string;extensionDays:number;penaltyRules:string;title:string;content:string;pids:string;rated:boolean;maintainer?:number[];assign?:string[];langs?:string[]}`; `POST /homework/create` body `{ "beginAtDate":"2026-09-01","beginAtTime":"10:00","penaltySinceDate":"2026-09-01","penaltySinceTime":"10:00","extensionDays":0,"penaltyRules":"{}","title":"Week 1","content":"...","pids":"1001\n1002","rated":false }`. Response: `type Response={tid:ObjectId;url?:string}`; `{ "tid":"665f00000000000000000001","url":"/homework/665f00000000000000000001" }`.

## `POST /homework/:tid/edit` (update operation)
Description: update an existing homework with the same validated field set. Request: `type Request={tid:ObjectId;beginAtDate:string;beginAtTime:string;penaltySinceDate:string;penaltySinceTime:string;extensionDays:number;penaltyRules:string;title:string;content:string;pids:string;rated:boolean;maintainer?:number[];assign?:string[];langs?:string[]}`; `{ "tid":"665f...","beginAtDate":"2026-09-01","beginAtTime":"10:00","penaltySinceDate":"2026-09-01","penaltySinceTime":"10:00","extensionDays":0,"penaltyRules":"{}","title":"Week 1","content":"...","pids":"1001","rated":false }`. Response: `type Response={tid:ObjectId;url?:string}`; `{ "tid":"665f...","url":"/homework/665f..." }`.

## `POST /homework/:tid/edit` operation `delete`
Description: delete homework and associated files. Request: `type Request={operation:"delete";tid:ObjectId}`; `{ "operation":"delete" }`. Response: `type Response={url:string}`; `{ "url":"/homework" }` under JSON negotiation, browser redirect otherwise.

## `GET /homework/:tid/file`
Description: render the homework file manager. Request: `type Query={tid:ObjectId}`; `GET /homework/665f.../file`. Response: `type Response={tdoc:ContestDoc;files:unknown[];urlForFile:string}`; `{ "tdoc":{"docId":"665f..."},"files":[] }`, HTML/PJAX `homework_files.html`; view/edit permissions apply.

## `POST /homework/:tid/file` operation `uploadFile`
Description: store one homework file. Request: `type Request={operation:"uploadFile";filename:string;file:Blob}`; multipart example `filename=statement.pdf&file=@statement.pdf`. Response: `type Response={url?:string}`; `{ "url":"/homework/665f.../file" }` or browser back redirect.

## `POST /homework/:tid/file` operation `deleteFiles`
Description: remove selected homework files. Request: `type Request={operation:"deleteFiles";files:string[]}`; `{ "operation":"deleteFiles","files":["statement.pdf"] }`. Response: `type Response={url?:string}`; `{ "url":"/homework/665f.../file" }` or browser back redirect.

## `GET /homework/:tid/file/:type/:filename`
Description: sign public/private homework file download. Request: `type Query={tid:ObjectId;type:"public"|"private";filename:string;noDisposition?:boolean}`; `GET /homework/665f.../file/public/statement.pdf`. Response: `type Response=Redirect|JsonRedirect`; browser `302 Location: https://storage/signed?...`; JSON negotiation HTTP 200 `{ "url":"https://storage/signed?..." }`.

## `GET /homework/:tid/scoreboard`
Description: render the default homework scoreboard. Request: `type Query={tid:ObjectId}`; `GET /homework/665f.../scoreboard`. Response: `type Response={tdoc:ContestDoc;rows:unknown[]}`; `{ "tdoc":{"docId":"665f..."},"rows":[] }`, rendered scoreboard HTML; requires `PERM_VIEW_HOMEWORK_SCOREBOARD`.

## `GET /homework/:tid/scoreboard/:view`
Description: render a named scoreboard view. Request: `type Query={tid:ObjectId;view:string}`; `GET /homework/665f.../scoreboard/default`. Response: `type Response={tdoc:ContestDoc;rows:unknown[]}`; `{ "tdoc":{"docId":"665f..."},"rows":[] }`, rendered scoreboard HTML; requires scoreboard permission.

## `GET /homework/:tid/code`
Description: render permitted source-code view through the shared contest code handler. Request: `type Query={tid:ObjectId;all?:boolean}`; `GET /homework/665f.../code?all=false`. Response: `type Response={tdoc:ContestDoc;rdocs:RecordDoc[]}`; `{ "tdoc":{"docId":"665f..."},"rdocs":[] }`, rendered HTML; requires homework view permission and code visibility rules.
