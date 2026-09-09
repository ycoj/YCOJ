# GET/POST `/p/:pid` — problem detail actions

## Description

Retrieves a visible problem (or a contest-context problem with `tid`) and performs rejudge, delete, or star actions. During a contest, every contest-context request requires an attended status with `startAt`, including requests from contest owners and administrators; otherwise it fails with `ContestNotAttendedError`. After the contest is done this attendance check no longer applies. Hidden normal-mode problems require `PERM_VIEW_PROBLEM_HIDDEN`; delete requires owner-self-edit or `PERM_EDIT_PROBLEM`; rejudge requires `PERM_REJUDGE_PROBLEM` and a structured config. HTML-to-Markdown conversion is no longer an operation on this endpoint; it has dedicated routes documented below.

## Request format

```ts
type DetailQuery = { tid?: string; pjax?: boolean };
type DetailBody =
  | { operation: 'rejudge'; pid: number }
  | { operation: 'delete' }
  | { operation: 'star'; star: boolean };
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

# POST `/p/:pid/html-to-markdown` — start async HTML-to-Markdown conversion

## Description

Admits an asynchronous conversion of the problem's own stored `content` from HTML to Markdown, without saving or otherwise modifying the problem. The request body carries no HTML. The job is admitted to a persistent, cluster-wide store (the `background_task` collection): the caller receives an immediate `202` with a `pending` job, and any server worker can service later polls because job state lives in the shared database, not process memory. The stored content is the conversion input; provider credentials are never persisted. The caller must own the problem with `PERM_EDIT_PROBLEM_SELF` or hold `PERM_EDIT_PROBLEM`. Contest context passes `tid` from the query string or the body (both arrive as a real ObjectId; a malformed tid fails parameter validation before anything runs) and requires contest membership, a started contest, and attended status with `startAt` until the contest is done. There is no separate `/contest/:tid/p/:pid` path: the same `/p/:pid/html-to-markdown` route serves contest context through `tid`. `profileId` selects a configured provider/model; when omitted, the configured HTML-to-Markdown conversion profile is used. AI generation must be enabled and the selected profile must be valid; configuration errors fail the request immediately. The stored content is limited to 200,000 characters; oversized content returns `ValidationError` before a job is admitted.

## Request format

```ts
type HtmlToMarkdownSubmitParams = { pid: number | string };
type HtmlToMarkdownSubmitQuery = { tid?: string }; // contest context; may also go in the body
type HtmlToMarkdownSubmitBody = { profileId?: string; tid?: string }; // Content-Type: application/json
```

```http
POST /p/P1000/html-to-markdown HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{}
```

Contest-context variant: `POST /p/P1000/html-to-markdown?tid=66b5c0e00000000000000000` or the same `tid` hex string as a body field.

## Response format

```ts
// HTTP 202; the job is already admitted to the shared store when this responds.
type HtmlToMarkdownResponse = { jobId: string; status: 'pending' };
```

```json
{"jobId":"08305266-8767-4556-8f2e-e398cf3d9ecf","status":"pending"}
```

Error statuses (JSON body `{ "error": { "name": … } }` under `Accept: application/json`):

- HTTP 403 `PermissionError` (missing `PERM_EDIT_PROBLEM`/owner-self), `ValidationError` (malformed `tid`, or stored content over 200,000 characters), `ContestNotAttendedError`, or `ContestNotLiveError`.
- HTTP 404 `ProblemNotFoundError` or `ContestNotFoundError` (unknown problem, or `tid` set but the problem is not in that contest).
- HTTP 503 `HtmlToMarkdownCapacityError` when the per-owner (10) or global (100) live-job capacity is full.

A legacy `POST /p/:pid` with `{"operation":"html_to_markdown"}` is no longer an operation on the detail endpoint and returns HTTP 405 `InvalidOperationError`.

## Conversion semantics

The prompt requires Markdown structure, LaTeX math (`$...$` and `$$...$$`), and paired sample fences named ````input{x}```` and ````output{x}````; the model must return Markdown only. Configuration and permission errors remain immediate API errors. The admitting process runs the model call in-process and is the only process that ever issues the `pending` → `running` claim for that job, so a job cannot be replayed on another worker. Capacity is enforced cluster-wide and atomically against races using unique slot indexes: at most 100 live jobs total and at most 10 per `{ domainId, pid, uid }` owner; exceeding either returns HTTP 503 `HtmlToMarkdownCapacityError`. Provider failures are reported by polling with a generic error message, never provider diagnostics or credentials.

Ownership checks on both conversion routes include users listed in the problem's `maintainer` array. Owners and maintainers still need `PERM_EDIT_PROBLEM_SELF`; other editors need `PERM_EDIT_PROBLEM`. Outside contest context, hidden-problem visibility also recognizes owners and maintainers. The persisted payload contains HTML and non-sensitive model configuration, excluding `apiKey`; the converter receives the full configuration in process memory.

# GET `/p/:pid/html-to-markdown/:jobId` — poll async HTML-to-Markdown conversion

Polls a persistent conversion job from the shared store, so the request may be served by any worker (no affinity to the submitting process is required). Uses the same problem visibility, contest-context, and edit-permission checks as submission, including `tid` from the query string or body, and runs them once per request. Only the submitting user can retrieve the job, and its domain and numeric problem ID must match the route. Unknown, expired, or mismatched jobs return HTTP 404 `NotFoundError` after permission checks.

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

HTTP 200, `application/json` (including failed jobs). A completed `markdown` value may be an empty string, which is preserved as a successful result. `pending` is legitimately observable while the admitted job waits in the shared database before the admitting process claims it; `running` means the admitting process is executing the model call:

```json
{"jobId":"08305266-8767-4556-8f2e-e398cf3d9ecf","status":"completed","markdown":"## Input\n\nExample input"}
```

Failure responses contain `error: "HTML-to-Markdown conversion failed."` or `error: "HTML-to-Markdown conversion timed out."`. A conversion that runs longer than the 15-minute budget is abandoned (the admitting process aborts it) and reported as `failed` with the timeout error. A job whose admitting process is gone (for example after a crash) is also surfaced as `failed`/timeout once it exceeds the budget, whether detected on poll (any worker) or by the periodic reclaim (web master only), and its capacity slot is then released. Terminal results are retained and pollable for one hour and then removed by a database TTL index, which frees their capacity slot. Late results after a job has already settled are ignored. Jobs persist across workers and restarts; there is no retry, cancellation endpoint, or automatic problem save.

Workflow: submit once, then poll this route approximately once per second while status is `pending` or `running`. Stop on `completed` and use `markdown`, or stop on `failed` and report `error`. Stop on HTTP errors as well; a 404 indicates the job is unknown, not owned by the caller, or past its one-hour retention window — never simply because a different worker served the request. Do not automatically resubmit on a missing job. Save converted content separately through the problem edit API only when intended.

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
