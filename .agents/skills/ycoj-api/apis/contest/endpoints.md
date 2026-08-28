# Contest endpoint contracts

Authentication is `Cookie: sid=...` or `Authorization: Bearer <sid>`. Permissions below are enforced by the handler. JSON negotiation (`Accept: application/json`) serializes logical redirects as HTTP 200 `{url:string}`; normal browser negotiation uses redirects/HTML.

## List and detail

### GET `/contest`
Description: list visible contests, optionally filtered by rule/group/text. Request: `type Q={rule?:string;group?:string;page?:number;q?:string}`; `GET /contest?page=1&q=weekly`. Response: `type R={tdocs:Tdoc[];page:number;tpcount:number;groups:string[];q:string}`; `{ "tdocs":[],"page":1,"tpcount":0,"groups":[],"q":"weekly" }` rendered as `contest_main.html`; requires `PERM_VIEW_CONTEST`.

### GET `/contest/:tid`
Description: show contest details and participant status. Request: `type Q={tid:ObjectId}`; `GET /contest/665f00000000000000000001`. Response: `type R={tdoc:Tdoc;tsdoc:ContestStatus;pids:number[];pdict:Record<number,ProblemDoc>;psdict:Record<number,ProblemStatus>;rdict:Record<string,RecordDoc>}`; `{ "tdoc":{"docId":"665f...","title":"Weekly"},"pids":[1001],"pdict":{"1001":{"title":"A+B"}} }`, HTML `contest_detail.html`; view permission required.

### POST `/contest/:tid` (`attend`, `subscribe`, `earlyEnd`)
Description: attend with optional code, toggle subscription, or end early (manager). Request: `type B={operation:"attend";code?:string}|{operation:"subscribe";subscribe:boolean}|{operation:"earlyEnd"}`; `POST /contest/665f...` body `{ "operation":"subscribe","subscribe":true }`. Response: `type R={url?:string}|Record<string,unknown>`; JSON `{ "url":"/contest/665f..." }` or browser back/redirect.

## Create/edit

### POST `/contest/create` or `/contest/:tid/edit`
Description: create or update a contest; `pids` is validated content and all decorated date/time/title/rule fields are validated. Request: `type B={tid?:ObjectId;beginAtDate:string;beginAtTime:string;duration:number;title:string;content:string;rule:string;pids:string;rated:boolean;code?:string;autoHide:boolean;assign?:string[];lock?:number;contestDuration?:number;maintainer?:number[];allowViewCode:boolean;allowPrint:boolean;keepScoreboardHidden:boolean;langs?:string[]}`; `POST /contest/create` body `{ "beginAtDate":"2026-09-01","beginAtTime":"10:00","duration":120,"title":"Weekly","content":"...","rule":"oi","pids":"1001\n1002","rated":false,"autoHide":false,"allowViewCode":false,"allowPrint":false,"keepScoreboardHidden":false }`. Response: `type R={tid:ObjectId;url?:string}`; `{ "tid":"665f00000000000000000001" }` plus redirect/JSON URL. Create permission is required; edit additionally checks ownership/edit permission.

### POST `/contest/:tid/edit` (`delete`)
Description: delete a contest and associated files. Request: `type B={operation:"delete";tid:ObjectId}`; `{ "operation":"delete" }`. Response: `type R={url:string}`; `{ "url":"/contest" }` (JSON) or browser redirect.

## Problems, code, files

### GET `/contest/:tid/problems`
Description: render contest problem list and visible submissions. After the contest starts and before it ends, participants must have attended; contest owners and users with contest-edit or hidden-contest-view permission may inspect this list without attending. Not-started contests are rejected with `ContestNotLiveError`, including for those authorized users. This exception applies only to the list and does not grant access to contest-context problem detail or mutation endpoints. Request: `type Q={tid:ObjectId}`; `GET /contest/665f.../problems`. Response: `type R={tdoc:Tdoc;pids:number[];pdict:Record<number,ProblemDoc>;psdict:Record<number,ProblemStatus>;rdict:Record<string,RecordDoc>}`; `{ "pids":[1001],"pdict":{},"psdict":{} }` as HTML/PJAX. Other unattended users receive `ContestNotAttendedError`.

### GET `/contest/:tid/code`
Description: show permitted contest source code. Request: `type Q={tid:ObjectId;all?:boolean}`; `GET /contest/665f.../code?all=false`. Response: `type R={tdoc:Tdoc;rdocs:RecordDoc[]}`; `{ "tdoc":{"docId":"665f..."},"rdocs":[] }` rendered HTML; code visibility is permission-filtered.

### GET `/contest/:tid/file/:type/:filename`
Description: download a public/private contest file. Request: `type Q={tid:ObjectId;type:"public"|"private";filename:string;noDisposition?:boolean}`; `GET /contest/665f.../file/public/rules.pdf`. Response: `type R=Redirect|JsonRedirect`; browser `302 Location: https://storage/signed?...`; with `Accept: application/json`, HTTP 200 `{ "url":"https://storage/signed?..." }` (the `noDisposition` flag controls storage disposition).

## Management, print, users, balloons, scoreboard

### POST `/contest/:tid/management`
Description: upload/delete files or set problem score. Request: `type B={operation:"uploadFile";filename?:string;type?:"public"|"private";file:Blob}|{operation:"deleteFiles";files:string[];type?:string}|{operation:"setScore";pid:number;score:number}`; upload uses multipart, e.g. `filename=rules.pdf&type=public&file=@rules.pdf`; JSON example `{ "operation":"setScore","pid":1001,"score":50 }`. Response: `type R=BackResponse`; all three handler methods call `back()`, so browser receives a referrer-dependent redirect and JSON negotiation serializes that URL as `{ "url":"/contest/665f.../management" }` when invoked from management.

### GET `/contest/:tid/bulk-submit`
Description: render the contest manager bulk-submit form (problem mapping inputs and allowed C++ languages), preferring `cc.cc14o2` as `defaultLang` when available and otherwise using the first allowed C++ language. For a default-type file-IO problem, `mappingDefaults` uses its parsed `config.subType` filename; duplicate trimmed, case-insensitive filenames are prefilled only for the first problem, while ordinary problems retain their problem pid or letter default. Request: `type Q={tid:ObjectId}`; `GET /contest/665f.../bulk-submit`. Response: `type R={tdoc:Tdoc;tsdoc:ContestStatusDoc|null;owner_udoc:UserDoc;pdict:Record<number,ProblemDoc>;langRange:Record<string,string>;defaultLang:string;mappingDefaults:Record<number,string>}`; `{ "tdoc":{"docId":"665f..."},"tsdoc":null,"owner_udoc":{"uid":1},"langRange":{"cc.cc14o2":"C++14(O2)"},"defaultLang":"cc.cc14o2","mappingDefaults":{"1001":"rag","1002":""} }` as HTML `contest_bulk_submit.html`. Requires contest owner/maintainer or `PERM_EDIT_CONTEST`. Full contract: [bulk-submit.md](bulk-submit.md).

### POST `/contest/:tid/bulk-submit`
Description: inspect a zip of contestant C++ sources (no mutations), then either return that report (`dryrun=true`) or commit accounts/attendance and judge writes (`dryrun=false`). Commit processes contestants who have at least one ready file. Judge writes use `record.add`, which creates and queues the judge task, followed by the normal counter/status updates. Record, queue, counter, or status failures are reported as per-entry skips and processing continues; a persisted record is not rolled back, and retries are not idempotent. `dryrun=true` reports planned actions without creating users, attendance, records, counters, or judge tasks. Normalized zip path collisions reject the archive with `ValidationError('file')`. `existingUser` chooses vuser vs real user when a registered account already has the contestant folder name and defaults to `existing`, so an omitted value submits as that registered user. `zipMode` selects zip layout: `subfolder` (`contestant/problem/problem.cpp`), `nosubfolder` (`contestant/problem.cpp`), or `auto` (both, subfolder preferred). If `lang` is omitted, `cc.cc14o2` is preferred when available; otherwise the first allowed C++ language is used. Allowed after the contest has started, including after it ends. Request: `type B={mapping:string|Record<number,string>;lang?:string;dryrun?:boolean;existingUser?:"vuser"|"existing";zipMode?:"auto"|"subfolder"|"nosubfolder";file:Blob}`; multipart `POST /contest/665f.../bulk-submit` with `file=@weekly.zip&mapping={"1001":"apple"}&lang=cc.cc14o2&dryrun=false&existingUser=existing&zipMode=auto`. Response: `type R={dryrun:boolean;lang:string;users:{uname:string;uid:number;created:boolean;kind:"vuser"|"user";realUid?:number}[];submitted:{uname:string;uid:number;pid:number;rid?:ObjectId}[];skipped:{uname:string;problem:string;reason:string}[]}`; `{ "dryrun":false,"lang":"cc.cc14o2","users":[{"uname":"alice","uid":42,"created":false,"kind":"user"}],"submitted":[{"uname":"alice","uid":42,"pid":1001,"rid":"665f..."}],"skipped":[] }`. Requires contest owner/maintainer or `PERM_EDIT_CONTEST`. Not-started contests return `ContestNotLiveError`. Full contract: [bulk-submit.md](bulk-submit.md).

### POST `/contest/:tid/print`
Description: print, list/allocate/update print tasks. Request: `type B={operation:"print";title?:string;content?:string}|{operation:"getPrintTask"}|{operation:"allocatePrintTask"}|{operation:"updatePrintTask";taskId:ObjectId;status:"printed"|"pending"}`; `{ "operation":"updatePrintTask","taskId":"665f...","status":"printed" }`. Response: `print -> BackResponse` (handler calls `back()`; JSON `{url:string}`); `getPrintTask -> {tasks:PrintTask[];udict:Record<number,UserDoc>}` e.g. `{ "tasks":[],"udict":{} }`; `allocatePrintTask -> {task:PrintTask|null;udoc:UserDoc|null}` e.g. `{ "task":null,"udoc":null }`; `updatePrintTask -> {success:true}` exactly.

### POST `/contest/:tid/user`
Description: add contest users. Request: `type B={operation:"addUser";uids:number[];unrank?:boolean}`; `{ "operation":"addUser","uids":[42],"unrank":false }`. Response: `type R=BackResponse`; handler calls `back()`; normal browser returns the framework back redirect, while JSON negotiation serializes its URL as `{ "url":"/contest/665f.../user" }` (exact referrer-dependent URL).

## `POST /contest/:tid/user` operation `rank`
Description: rank one contest user. Request: `type B={operation:"rank";uid:number}`; `{ "operation":"rank","uid":42 }`. Response: `type R=BackResponse`; handler calls `back()`; JSON form is `{ "url":"/contest/665f.../user" }` when the referrer is that page.

## `POST /contest/:tid/user` operation `resume`
Description: resume one contest user. Request: `type B={operation:"resume";uid:number}`; `{ "operation":"resume","uid":42 }`. Response: `type R=BackResponse`; handler calls `back()`; browser redirect/JSON URL depends on referrer.

## `POST /contest/:tid/user` operation `removeUser`
Description: remove one contest user. Request: `type B={operation:"removeUser";uid:number}`; `{ "operation":"removeUser","uid":42 }`. Response: `type R=BackResponse`; handler calls `back()`; browser redirect/JSON URL depends on referrer.

### POST `/contest/:tid/balloon`
Description: set balloon color. Request: `type B={operation:"setColor";color:string}`; `{ "operation":"setColor","color":"red" }`. Response: `type R=BackResponse`; handler calls `back()`; browser redirect/JSON URL depends on referrer.

## `POST /contest/:tid/balloon` operation `done`
Description: mark one balloon delivered. Request: `type B={operation:"done";balloon:ObjectId}`; `{ "operation":"done","balloon":"665f00000000000000000003" }`. Response: `type R=BackResponse`; handler calls `back()`; browser redirect/JSON URL depends on referrer.

### GET/POST `/contest/:tid/scoreboard[/:view]`
Description: render a selected scoreboard view or unlock a hidden scoreboard. Only status documents with `attend > 0` are included as contestants; status documents created for users who only inspect a contest are excluded in all scoreboard views and exports. Request: `type Q={tid:ObjectId;view?:string}`; `GET /contest/665f.../scoreboard/default`; unlock body `type B={operation:"unlock"}`. Response: `type R={tdoc:Tdoc;rows:unknown[]}|{url:string}`; `{ "tdoc":{"docId":"665f..."},"rows":[] }` HTML or `{ "url":"/contest/665f.../scoreboard" }` JSON.

## Exact alternate print route: `GET/POST /contest/:tid/api/printing/team`
Description: alternate route bound to the same print handler for team-print clients. Request: `type Query={tid:ObjectId}`; `GET /contest/665f.../api/printing/team`. Response: `type Response={tdoc:Tdoc}`; `{ "tdoc":{"docId":"665f..."} }` rendered print HTML. POST uses the print operations and response contracts above; with JSON negotiation logical redirects are `{url:string}`.

## `GET /contest/:tid/scoreboard/:view`
Description: render the explicitly named scoreboard view. Request: `type Query={tid:ObjectId;view:string}`; `GET /contest/665f.../scoreboard/default`. Response: `type Response=HTML`; example HTML contains the selected scoreboard view and its `tdoc`; JSON/PJAX body shape is delegated to the scoreboard service and is not a stable plain object.

## `GET /contest/create`
Description: render the contest creation form. Request: `type Query={}`; `GET /contest/create`. Response: `type Response={page_name:"contest_create";groups:unknown[];langs:unknown[]}`; `{ "page_name":"contest_create" }`, HTML `contest_edit.html`.

## `GET /contest/:tid/edit`
Description: render an existing contest for editing. Request: `type Query={tid:ObjectId}`; `GET /contest/665f.../edit`. Response: `type Response={page_name:"contest_edit";tdoc:Tdoc;groups:unknown[];langs:unknown[]}`; `{ "page_name":"contest_edit","tdoc":{"docId":"665f..."} }`, HTML `contest_edit.html`.

## `GET /contest/:tid/print`
Description: render the printable contest page. Request: `type Query={tid:ObjectId}`; `GET /contest/665f.../print`. Response: `type Response={tdoc:Tdoc}`; `{ "tdoc":{"docId":"665f..."} }`, HTML `contest_print.html`.

## `GET /contest/:tid/management`
Description: render contest management, selecting public/private file tab. Request: `type Query={tid:ObjectId;d?:"public"|"private";sidebar?:boolean}`; `GET /contest/665f.../management?d=private`. Response: `type Response={tdoc:Tdoc;publicFiles:unknown[];privateFiles:unknown[];users:unknown[]}`; `{ "tdoc":{"docId":"665f..."},"publicFiles":[],"privateFiles":[] }`, HTML/PJAX `contest_manage.html`.

## `GET /contest/:tid/bulk-submit`
Description: render contest bulk-submit form, preferring `cc.cc14o2` as `defaultLang` when available and otherwise using the first allowed C++ language. A default-type file-IO problem uses its parsed `config.subType` filename in `mappingDefaults`; when multiple problems have the same trimmed, case-insensitive filename, only the first is prefilled, and ordinary problems retain their existing defaults. Request: `type Query={tid:ObjectId}`; `GET /contest/665f.../bulk-submit`. Response: `type Response={tdoc:Tdoc;tsdoc:ContestStatusDoc|null;owner_udoc:UserDoc;pdict:Record<number,ProblemDoc>;langRange:Record<string,string>;defaultLang:string;mappingDefaults:Record<number,string>}`; `{ "tdoc":{"docId":"665f..."},"tsdoc":null,"owner_udoc":{"uid":1},"langRange":{"cc.cc14o2":"C++14(O2)"},"defaultLang":"cc.cc14o2","mappingDefaults":{"1001":"rag","1002":""} }`, HTML `contest_bulk_submit.html`. Requires owner/maintainer or `PERM_EDIT_CONTEST`. Full contract: [bulk-submit.md](bulk-submit.md).

## `GET /contest/:tid/clarification`
Description: render contest clarification list. Request: `type Query={tid:ObjectId}`; `GET /contest/665f.../clarification`. Response: `type Response={tdoc:Tdoc;tsdoc:unknown;owner_udoc:UserDoc;pdict:Record<number,ProblemDoc>;tcdocs:unknown[];udict:Record<number,UserDoc>}`; `{ "tdoc":{"docId":"665f..."},"tsdoc":null,"owner_udoc":null,"pdict":{},"tcdocs":[],"udict":{} }`, HTML/PJAX `contest_clarification.html`.

## `POST /contest/:tid/clarification` operation `clarification`
Description: submit a participant clarification or management reply. Request: `type Request={operation:"clarification";content:string;did?:ObjectId;subject?:number}`; `{ "operation":"clarification","content":"What is the limit?","subject":0 }`. Response: `type Response=BackResponse`; handler calls `back()`, so browser redirect and JSON URL are referrer-dependent (normally `/contest/665f.../clarification`).

## `GET /contest/:tid/user`
Description: render contest users and statuses. Request: `type Query={tid:ObjectId}`; `GET /contest/665f.../user`. Response: `type Response={tdoc:Tdoc;tsdocs:unknown[];udict:Record<number,UserDoc>}`; `{ "tdoc":{"docId":"665f..."},"tsdocs":[],"udict":{} }`, HTML/PJAX `contest_user.html`.

## `GET /contest/:tid/balloon`
Description: render balloon tasks, optionally only todo items. Request: `type Query={tid:ObjectId;todo?:boolean}`; `GET /contest/665f.../balloon?todo=true`. Response: `type Response={tdoc:Tdoc;balloons:unknown[];colors:unknown}`; `{ "tdoc":{"docId":"665f..."},"balloons":[] }`, HTML/PJAX `contest_balloon.html`.
