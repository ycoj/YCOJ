# GET/POST `/p/:pid/solution` and `/p/:pid/solution/:sid` — problem solutions

## Description

Lists a problem's solutions or one selected solution, and creates/edits/deletes solutions and replies or votes. Both routes require `PERM_VIEW_PROBLEM`; viewing normally also requires either an accepted status plus `PERM_VIEW_PROBLEM_SOLUTION_ACCEPT`, or `PERM_VIEW_PROBLEM_SOLUTION`. Every solution ID must belong to the problem in the URL and current domain, including raw content, replies, and votes. Each mutation has its dedicated create/edit/delete/reply/vote permission, with the self variants for owned content.

New solutions start unreviewed (`reviewStatus: 1`, `revision: 0`). Existing solutions are migrated to approved (`2`). Lists sort featured (`3`), approved (`2`), unreviewed (`1`), rejected (`0`), then author-blocked (`-1`), with descending votes and IDs within each state before pagination. On each page, unreviewed/rejected/blocked solutions are grouped in one initially closed disclosure, including each entry's author, votes, actions, content, and replies. The group remains publicly expandable, including on permalinks; featured and approved entries display normally outside it. Raw Markdown remains accessible under the same view permissions.

Content changes reset review to unreviewed and remove reviewer metadata; unchanged content does not. Edits and reviews advance `revision`; votes and replies do not. Blocked authors' edited solutions stay blocked. Submission by a domain-blocked author returns `SolutionSubmissionBlockedError` (403), also enforced in the solution model. Concurrent create/edit/delete operations for an author can return `SolutionReviewBusyError` (409); retry after the operation finishes. See [review and author blocking](problem-solution-review.md).

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
type ProblemSolutionDoc = {
  _id: string; docId: string; domainId: string; docType: 11;
  parentType: 10; parentId: number; owner: number; content: string;
  reply: { _id: string; owner: number; content: string }[]; vote: number;
  reviewStatus: -1 | 0 | 1 | 2 | 3; revision: number;
  reviewedBy?: number; reviewedAt?: string;
};
type SolutionsResponse = { psdocs: ProblemSolutionDoc[]; page: number; pcount: number; pscount: number; udict: Record<string, User>; pssdict: Record<string, SolutionStatusDoc>; pdoc: ProblemDoc; sid?: string; reviewLabels: Record<string, string>; solutionBlocked: boolean };
type MutationResponse = unknown; // framework back payload; submit supplies { psid }, edit supplies { psdoc }, votes supply { vote, user_vote }
```

```json
{"psdocs":[],"page":1,"pcount":0,"pscount":0,"udict":{},"pssdict":{},"pdoc":{"pid":"P1000"},"solutionBlocked":false,"reviewLabels":{"3":"Featured Solution","2":"Approved","1":"Unreviewed","0":"Rejected","-1":"Rejected and author blocked"}}
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
