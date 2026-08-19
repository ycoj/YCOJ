# GET/POST `/p/:pid/solution` and `/p/:pid/solution/:sid` — problem solutions

## Description

Lists a problem's solutions or one selected solution, and creates/edits/deletes solutions and replies or votes. Both routes require `PERM_VIEW_PROBLEM`; viewing normally also requires either an accepted status plus `PERM_VIEW_PROBLEM_SOLUTION_ACCEPT`, or `PERM_VIEW_PROBLEM_SOLUTION`. Each mutation has its dedicated create/edit/delete/reply/vote permission, with the self variants for owned content.

## Request format

```ts
type SolutionQuery = { page?: PositiveInt; tid?: string; sid?: string };
type SolutionBody =
 | { operation: 'submit'; content: string }
 | { operation: 'edit_solution'; psid: string; content: string }
 | { operation: 'delete_solution'; psid: string }
 | { operation: 'reply'; psid: string; content: string }
 | { operation: 'edit_reply'; psid: string; psrid: string; content: string }
 | { operation: 'delete_reply'; psid: string; psrid: string }
 | { operation: 'upvote'|'downvote'; psid: string };
```

`tid` is not allowed for solutions. Send `Cookie: sid=…`, `Accept: application/json`, and mutation Content-Type (`application/json` or form).

```http
POST /p/P1000/solution HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"operation":"submit","content":"Use a linear scan."}
```

## Response format

```ts
type SolutionsResponse = { psdocs: SolutionDoc[]; page: number; pcount: number; pscount: number; udict: Record<string, User>; pssdict: Record<string, SolutionStatusDoc>; pdoc: ProblemDoc; sid?: string };
type MutationResponse = unknown; // framework back payload; submit supplies { psid }, votes supply { vote, user_vote }
```

```json
{"psdocs":[],"page":1,"pcount":0,"pscount":0,"pssdict":{},"pdoc":{"pid":"P1000"}}
```

GET renders `problem_solution.html`; mutation result delivery is the framework back response, not a stable standalone JSON envelope.

# GET `/p/:pid/solution/:psid/raw` and GET `/p/:pid/solution/:psid/:psrid/raw`

## Description

Returns the selected solution or reply content as Markdown. Permission is the same as solution viewing and `tid` is rejected.

## Request format

```ts
type RawPath = { pid: string | number; psid: string; psrid?: string };
type RawQuery = { tid?: string };
```

```http
GET /p/P1000/solution/66b5c0e00000000000000000/raw HTTP/1.1
Accept: application/json
Cookie: sid=…
```

## Response format

```ts
type RawResponse = string; // Content-Type: text/markdown
```

```markdown
Use a linear scan.
```
