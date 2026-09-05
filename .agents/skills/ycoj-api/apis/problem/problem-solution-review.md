# GET/POST `/p/solution-review` — problem solution review

## Description

Domain-wide problem solution review queue. Every request requires `PERM_DELETE_PROBLEM_SOLUTION`; self-deletion permission is insufficient. The problem list exposes a link to authorized reviewers. Contest solutions are unaffected. Prefix `/d/{domainId}` outside the system domain.

Review states are `3` featured, `2` approved, `1` unreviewed, `0` rejected, and `-1` rejected with author blocked. New solutions start unreviewed; the database upgrade marks existing solutions approved without assigning a reviewer. Public lists sort by state, votes, then solution ID, all descending, before pagination. States `1`, `0`, and `-1` are collapsed by default but publicly expandable under existing view permissions, including on permalinks. Reviewers see expanded content in the queue.

Blocking marks every problem solution by that author in this domain `-1` and prohibits new solution submissions there. Other domains and contest solutions are unaffected. Edits remain allowed under existing permissions and blocked solutions stay blocked. Unblocking restores submission eligibility and changes blocked solutions to unreviewed; previous approvals are not restored. The blocked-author list remains available even when all their solutions are deleted.

## Request format

```ts
type ReviewQuery = {
  page?: PositiveInt; // default 1, pagination.solution page size
  status?: 'pending' | 'featured' | 'approved' | 'rejected' | 'blocked' | 'all' | 'authors'; // default pending
  pid?: string | number; // problem ID
  uid?: PositiveInt; // author ID
};
type ReviewBody =
  | { operation: 'review'; psid: string; revision: number; status: -1 | 0 | 2 | 3 }
  | { operation: 'unblock'; uid: PositiveInt };
```

`revision` is a nonnegative integer copied from the displayed solution. Content edits and review decisions advance it. Other mutations do not. The `authors` view filters blocked authors by `uid`, ignores the problem filter for its results, and sorts by user ID. Other views sort oldest solution first. Empty optional form fields are omitted. A supplied problem ID must resolve in this domain.

```http
GET /p/solution-review?status=pending&page=1 HTTP/1.1
Accept: application/json
Cookie: sid=…
```

```http
POST /p/solution-review HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"operation":"review","psid":"66b5c0e00000000000000000","revision":0,"status":3}
```

To unblock, POST `{"operation":"unblock","uid":42}` with the same headers.

## Response format

```ts
// ProblemSolutionDoc is defined in problem-solutions.md.
type BlockedAuthor = {
  domainId: string; uid: number; solutionBlocked: true;
  solutionBlockedBy: number; solutionBlockedAt: string;
};
type ReviewResponse = {
  docs: ProblemSolutionDoc[] | BlockedAuthor[];
  page: number; pcount: number; count: number;
  udict: Record<string, User>; pdict: Record<string, ProblemDoc>;
  status: ReviewQuery['status']; pid?: string | number; uid?: number;
  reviewLabels: Record<string, string>;
};
```

```json
{"docs":[],"page":1,"pcount":0,"count":0,"udict":{},"pdict":{},"status":"pending","reviewLabels":{"3":"Featured Solution","2":"Approved","1":"Unreviewed","0":"Rejected","-1":"Rejected and author blocked"}}
```

GET renders `problem_solution_review.html`. POST uses the framework back response: `review` supplies `{psdoc}` (updated solution with its new revision), and `unblock` supplies no extra payload. These are not new standalone response envelopes. Successful actions append `solution.review` or `solution.unblock` operation logs.

```json
{"psdoc":{"_id":"66b5c0e00000000000000000","docId":"66b5c0e00000000000000000","domainId":"system","docType":11,"parentType":10,"parentId":1000,"owner":42,"content":"Use a linear scan.","reply":[],"vote":0,"reviewStatus":3,"revision":1,"reviewedBy":1,"reviewedAt":"2026-09-06T08:00:00.000Z"}}
```

Invalid parameters return a validation error (400). Missing or cross-domain solutions return `SolutionNotFoundError` (404). Missing reviewer permission returns 403. A stale revision returns `SolutionReviewConflictError` (409); reload and review new content rather than blindly resubmitting. Concurrent author writes can return `SolutionReviewBusyError` (409); reload/retry after the operation finishes. Approving or individually rejecting a blocked author's solution returns `SolutionSubmissionBlockedError` (403); unblock first. Repeating an unblock is harmless.

## Review workflow

1. Fetch the pending queue and inspect content, author, problem, and revision.
2. Submit one of four outcomes with that revision. Before `status: -1`, confirm its effect on every solution and future submissions by this author in the domain.
3. Refresh the queue and public solution page to verify state, order, and expansion. A conflict or denial is not success.
4. To reverse a block, fetch `status=authors`, submit `unblock` with its `uid`, and verify the author disappears from the blocked list and their former blocked solutions appear pending. Review them anew.
