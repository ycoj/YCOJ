# GET/POST `/p/:pid` — problem detail actions

## Description

Retrieves a visible problem (or a contest-context problem with `tid`) and performs rejudge, delete, or star actions. During a contest, every contest-context request requires an attended status with `startAt`, including requests from contest owners and administrators; otherwise it fails with `ContestNotAttendedError`. After the contest is done this attendance check no longer applies. Hidden normal-mode problems require `PERM_VIEW_PROBLEM_HIDDEN`; delete is owner-self-edit or `PERM_EDIT_PROBLEM`; rejudge requires `PERM_REJUDGE_PROBLEM` and a structured config.

## Request format

```ts
type DetailQuery = { tid?: string; pjax?: boolean };
type DetailBody = { operation: 'rejudge'; pid: number } | { operation: 'delete' } | { operation: 'star'; star: boolean };
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
