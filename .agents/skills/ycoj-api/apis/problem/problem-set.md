# GET/POST `/p` — problem set and bulk actions

## Description

Lists visible problems in the current domain, optionally searches/filters them, or performs a bulk copy, deletion, hide, or unhide action. GET requires `PERM_VIEW_PROBLEM`; POST action permissions are checked per problem (owner with `PERM_EDIT_PROBLEM_SELF`, otherwise `PERM_EDIT_PROBLEM`). Copy additionally requires share access and `PERM_CREATE_PROBLEM` in the target domain.

## Request format

```ts
type ListQuery = { page?: PositiveInt; q?: string; limit?: PositiveInt; pjax?: boolean; quick?: boolean; sort?: 'default' | 'recent' };
type BulkBody =
 | { operation: 'copy'; pids: number[]; target: string; hidden?: boolean; redirect?: boolean }
 | { operation: 'delete' | 'hide' | 'unhide'; pids: number[] };
```

`q` is parsed for `category:`, `difficulty:`, and `namespace:` terms. Send `Cookie: sid=…` and `Accept: application/json`; POST accepts form/JSON request data.

```http
POST /p HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"operation":"hide","pids":[1000,1001]}
```

## Response format

```ts
type ListResponse = { page: number; pcount: number; ppcount: number; pcountRelation: string; pdocs: ProblemDoc[]; psdict: Record<string, ProblemStatusDoc>; qs: string; sort: 'default'|'recent' };
type PjaxResponse = { title: string; fragments: { html: string }[] };
type CopyResponse = number[]; // unless redirect=true
type BackResponse = unknown; // framework “back” response/redirect
```

```json
{"page":1,"pcount":1,"ppcount":1,"pcountRelation":"eq","pdocs":[{"docId":1000,"pid":"P1000","title":"A + B"}],"psdict":{},"qs":"category:basic","sort":"default"}
```

With `redirect:true`, copy returns `{ "url": "/p/{first-id}" }` under JSON accept (or redirects without it). Delete/hide/unhide use `back()` rather than a stable documented body.

# GET `/problem/random` — random matching problem

## Description

Chooses a visible problem; only `category:x,y` tokens in `q` are applied. Requires `PERM_VIEW_PROBLEM`.

## Request format

```ts
type RandomQuery = { q?: string };
```

```http
GET /problem/random?q=category:dp,graph HTTP/1.1
Accept: application/json
Cookie: sid=…
```

## Response format

```ts
type RandomResponse = { pid: number | string };
```

```json
{"pid":1000}
```

The handler also sets a redirect; under JSON accept the response is `{ "pid":1000,"url":"/p/P1000" }` (otherwise an HTTP redirect). An empty result raises `NoProblemError`.
