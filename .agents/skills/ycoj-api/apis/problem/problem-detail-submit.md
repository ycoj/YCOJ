# GET/POST `/p/:pid` — problem detail actions

## Description

Retrieves a visible problem (or a contest-context problem with `tid`) and performs rejudge, delete, star, or HTML-to-Markdown conversion actions. During a contest, every contest-context request requires an attended status with `startAt`, including requests from contest owners and administrators; otherwise it fails with `ContestNotAttendedError`. After the contest is done this attendance check no longer applies. Hidden normal-mode problems require `PERM_VIEW_PROBLEM_HIDDEN`; delete and HTML-to-Markdown conversion require owner-self-edit or `PERM_EDIT_PROBLEM`; rejudge requires `PERM_REJUDGE_PROBLEM` and a structured config.

## Request format

```ts
type DetailQuery = { tid?: string; pjax?: boolean };
type DetailBody =
  | { operation: 'rejudge'; pid: number }
  | { operation: 'delete' }
  | { operation: 'star'; star: boolean }
  | { operation: 'html_to_markdown'; profileId?: string };
```

```http
POST /p/P1000 HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"operation":"star","star":true}
```

## Response format

```ts
type DetailResponse = { pdoc: ProblemDoc; udoc: User; psdoc: ProblemStatusDoc|null; title: string; solutionCount: number; discussionCount: number; tdoc?: ContestDoc; mode: 'normal'|'view'|'contest'|'correction'|'none'; rdoc?: RecordDoc };
type StarResponse = unknown; // framework back payload includes { star }
```

```json
{"title":"A + B","pdoc":{"docId":1000,"pid":"P1000","title":"A + B"},"psdoc":null,"solutionCount":0,"discussionCount":0,"mode":"normal"}
```

GET normally renders `problem_detail.html`; `pjax=true` returns a title/fragments/raw object, e.g. `{ "title":"…","fragments":[{"html":"…"}],"raw":{"pdoc":{"pid":"P1000"}} }`. Rejudge returns back; delete returns `{ "url":"/p" }` under JSON accept.

## `operation=html_to_markdown`

Starts an asynchronous conversion of the problem's own stored `content` from HTML to Markdown, without saving or otherwise modifying the problem. The request body carries no HTML. Content and resolved model configuration are snapshotted at submission. The caller must own the problem with `PERM_EDIT_PROBLEM_SELF` or hold `PERM_EDIT_PROBLEM`. `profileId` selects a configured provider/model; when omitted, the configured HTML-to-Markdown conversion profile is used. AI generation must be enabled and the selected profile must be valid. The stored content is limited to 200,000 characters; oversized content returns `ValidationError` before accepting a job.

```http
POST /p/P1000 HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"operation":"html_to_markdown"}
```

```ts
// HTTP 202; replaces the previous synchronous { markdown } response.
type HtmlToMarkdownResponse = { jobId: string; status: 'pending' };
```

````json
{"jobId":"08305266-8767-4556-8f2e-e398cf3d9ecf","status":"pending"}
````

The prompt requires Markdown structure, LaTeX math (`$...$` and `$$...$$`), and paired sample fences named ````input{x}```` and ````output{x}````; the model must return Markdown only. Configuration and permission errors remain immediate API errors. Capacity exhaustion returns HTTP 503 `HtmlToMarkdownCapacityError`; each `{ domainId, pid, uid }` owner is also limited to 10 retained jobs so one problem editor cannot consume the shared queue. Provider failures are reported by polling with a generic error message, never provider diagnostics or credentials.

## GET `/p/:pid/html-to-markdown/:jobId`

Polls an in-memory conversion job. Uses the same problem visibility and edit permissions as submission, including contest-context checks when `tid` is supplied. Only the submitting user can retrieve the job, and its domain and numeric problem ID must match the route. Unknown, expired, or mismatched jobs return HTTP 404 `NotFoundError` after permission checks.

```ts
type HtmlToMarkdownPollParams = { pid: number | string; jobId: string };
type HtmlToMarkdownPollQuery = { tid?: string };
type HtmlToMarkdownPollResponse = { jobId: string } & (
  | { status: 'pending' | 'running' }
  | { status: 'completed'; markdown: string }
  | { status: 'failed'; error: string }
);
```

```http
GET /p/P1000/html-to-markdown/08305266-8767-4556-8f2e-e398cf3d9ecf HTTP/1.1
Accept: application/json
Cookie: sid=SESSION
```

HTTP 200, `application/json` (including failed jobs):

```json
{"jobId":"08305266-8767-4556-8f2e-e398cf3d9ecf","status":"completed","markdown":"## Input\n\nExample input"}
```

Failure responses contain `error: "HTML-to-Markdown conversion failed."` or `error: "HTML-to-Markdown conversion timed out."`. Conversion times out after 15 minutes; late results are ignored. Terminal results expire after one hour and cleanup runs every minute and on submission/polling. Each server process retains at most 100 jobs. Jobs disappear on process restart or handler disposal; requests must reach the same process in multi-process deployments. There is no persistence, retry, cancellation endpoint, or automatic problem save.

Workflow: submit once, then poll this route approximately once per second while status is `pending` or `running`. Stop on `completed` and use `markdown`, or stop on `failed` and report `error`. Stop on HTTP errors as well; a 404 may indicate expiry, restart, or a different server process. Do not automatically resubmit on a missing job. Save converted content separately through the problem edit API only when intended.

# GET/POST `/p/:pid/submit` and `/p/:pid/hack/:rid`

## Description

Submit source (or a source file) or create a hack record. Both routes require `PERM_SUBMIT_PROBLEM`; submission additionally validates configured/allowed language and rate limits. A hack requires an accepted, hackable problem and target record, not the caller’s own, and in contest mode requires an ongoing Codeforces-rule contest.

## Request format

```ts
type ContestContext = { tid?: string }; // accepted from the query string or mutation body
type SubmitBody = { lang: string; code?: string; file?: File; pretest: boolean; input?: string[]; tid?: string };
type HackBody = { input?: string; file?: File; autoOrganizeInput?: boolean; tid?: string };
```

Contest-context preparation and the submit or hack method read `tid` from the same merged request parameters. Whether `tid` is supplied in the query string or only in the mutation body, the route loads the contest and applies problem membership, not-started, and attendance validation before creating a record. For file upload use `multipart/form-data`, field `file`; otherwise use normal mutation request data. Pretests require at least one input and only default/remote-judge problem types. Hack input files must be at most 2 MiB.

```http
POST /p/P1000/submit HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"lang":"cc.cc17","code":"#include <bits/stdc++.h>\nint main(){}","pretest":false}
```

## Response format

```ts
type SubmitResponse = { rid: string; url: string } | { tid: string; url: string };
type HackResponse = { rid: string; url: string };
```

```json
{"rid":"66b5c0e00000000000000000","url":"/record/66b5c0e00000000000000000"}
```

An active contest that hides self-records returns `{ "tid":"…", "url":"/contest/{tid}/problems" }` (route rendering determines the exact domain prefix). Both query-string and body-only `tid` requests reject an unattended contest owner or administrator with `ContestNotAttendedError` before any submission or hack record is created.

# GET `/p/:pid/stat`

## Description

Lists statistical submission records. Requires `PERM_VIEW_PROBLEM`; contest context is rejected until the contest is over.

## Request format

```ts
type StatQuery = { sort?: string; direction?: -1|1; lang?: string; page?: PositiveInt };
```

```http
GET /p/P1000/stat?sort=time&direction=-1&page=1 HTTP/1.1
Accept: application/json
Cookie: sid=…
```

## Response format

```ts
type StatResponse = { rsdocs: RecordDoc[]; page: number; pcount: number; rscount: number; sort: string; direction: -1|1; pdoc: ProblemDoc; udict: Record<string, User>; types: string[]; udoc: User };
```

```json
{"rsdocs":[],"page":1,"pcount":0,"rscount":0,"sort":"time","direction":-1,"types":["time"]}
```

It renders `problem_statistics.html` in non-JSON rendering mode.
