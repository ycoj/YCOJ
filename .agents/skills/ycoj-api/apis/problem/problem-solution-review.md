# GET/POST `/p/solution-review` — problem solution review

## Description

Domain-wide problem solution review queue. Every request requires `PERM_DELETE_PROBLEM_SOLUTION`; self-deletion permission is insufficient. The problem list exposes a link to authorized reviewers. Contest solutions are unaffected. Prefix `/d/{domainId}` outside the system domain.

Review states are `3` featured, `2` approved, `1` unreviewed, `0` rejected, and `-1` rejected with author blocked. New solutions start unreviewed; the database upgrade marks existing solutions approved without assigning a reviewer. Public lists sort by state, votes, then solution ID, all descending, before pagination. Entries in states `1`, `0`, and `-1` on each page are grouped in one initially closed disclosure, hiding their author, votes, actions, content, and replies together. This group remains publicly expandable under existing view permissions, including on permalinks. Reviewers see expanded content in the queue.

The GET page is a two-column review workbench that claims at most one solution per request and offers no filter controls: the left column holds the data overview (domain-wide solution statistics) above the current item's content, and the right sidebar holds problem/user information above the review/unblock actions. The response carries `stats` for the overview. The `status`, `pid`, and `uid` query parameters remain part of the HTTP contract; the page defaults to `status=pending` and links to the blocked-author view. The `authors` response contains all matching blocked authors. There is no request pagination; `page` is ignored.

Except in the `authors` view, GET atomically claims the oldest matching solution whose review lock is absent, expired, or owned by the current reviewer. It sets `reviewLock` to the reviewer ID and `reviewLockUntil` to 60 seconds after the claim. Repeated GETs can renew the same claim. An empty result means no claimable match, even if `stats.pendingReview` is positive. Review POST requires this reviewer's unexpired claim and clears the selected solution's lock on success.

Blocking marks every problem solution by that author in this domain `-1` and prohibits new solution submissions there. Other domains and contest solutions are unaffected. Edits remain allowed under existing permissions and blocked solutions stay blocked. Unblocking restores submission eligibility and changes blocked solutions to unreviewed; previous approvals are not restored. The blocked-author list remains available even when all their solutions are deleted.

## Request format

```ts
type ReviewQuery = {
  status?: 'pending' | 'featured' | 'approved' | 'rejected' | 'blocked' | 'all' | 'authors'; // default pending
  pid?: string | number; // problem ID
  uid?: PositiveInt; // author ID
};
type ReviewBody =
  | { operation: 'review'; psid: string; revision: number; status: -1 | 0 | 2 | 3 }
  | { operation: 'unblock'; uid: PositiveInt };
```

`revision` is a nonnegative integer copied from the displayed solution. Content edits and review decisions advance it. Other mutations do not. The `authors` view filters blocked authors by `uid`, ignores the problem filter for its results, and sorts by user ID; its sidebar also resolves `solutionBlockedBy` into `udict`. Other views sort oldest solution first. Empty optional form fields are omitted. A supplied problem ID must resolve in this domain.

```http
GET /p/solution-review?status=pending HTTP/1.1
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
  docs: (ProblemSolutionDoc & { reviewLock: number; reviewLockUntil: string })[] | BlockedAuthor[];
  // At most one claimed solution, or all matching blocked authors.
  page: 1; pcount: number; count: number; // both counts equal docs.length
  udict: Record<string, User>; pdict: Record<string, ProblemDoc>;
  status: ReviewQuery['status']; pid?: string | number; uid?: number;
  reviewLabels: Record<string, string>;
  stats: {
    totalSolutions: number; // all problem solutions in the domain
    newToday: number; // solutions created since server local midnight
    pendingReview: number; // solutions awaiting review in the domain
  };
};
```

```json
{"docs":[],"page":1,"pcount":0,"count":0,"udict":{},"pdict":{},"status":"pending","reviewLabels":{"3":"Featured Solution","2":"Approved","1":"Unreviewed","0":"Rejected","-1":"Rejected and author blocked"},"stats":{"totalSolutions":128,"newToday":4,"pendingReview":6}}
```

GET renders `problem_solution_review.html`, the two-column workbench described above. POST uses the framework back response: `review` supplies `{psdoc}` (updated solution with its new revision), and `unblock` supplies no extra payload. These are not new standalone response envelopes. Successful actions append `solution.review` or `solution.unblock` operation logs.

```json
{"psdoc":{"_id":"66b5c0e00000000000000000","docId":"66b5c0e00000000000000000","domainId":"system","docType":11,"parentType":10,"parentId":1000,"owner":42,"content":"Use a linear scan.","reply":[],"vote":0,"reviewStatus":3,"revision":1,"reviewedBy":1,"reviewedAt":"2026-09-06T08:00:00.000Z"}}
```

Invalid parameters return a validation error (400). Missing or cross-domain solutions return `SolutionNotFoundError` (404). Missing reviewer permission returns 403. A stale revision, missing or expired lock, or lock owned by another reviewer returns `SolutionReviewConflictError` (409); fetch the queue again to acquire a claim and inspect the returned content before resubmitting. Concurrent author writes can return `SolutionReviewBusyError` (409); reload/retry after the operation finishes. Approving or individually rejecting a blocked author's solution returns `SolutionSubmissionBlockedError` (403); unblock first. Repeating an unblock is harmless.

## Review workflow

1. Fetch the pending queue to claim a solution; the response carries at most one solution plus `stats`. Inspect content, author, problem, and revision. Stop when no solution is returned; other reviewers may still hold pending items.
2. Submit one of four outcomes with that revision while the 60-second claim is valid. If it expires, fetch again and inspect the returned solution before submitting. Before `status: -1`, confirm its effect on every solution and future submissions by this author in the domain.
3. Fetch the pending queue again to claim the next item and refresh the public solution page to verify state, order, and expansion. A conflict or denial is not success.
4. To reverse a block, fetch `status=authors`, submit `unblock` with its `uid`, and verify the author disappears from the blocked list and their former blocked solutions appear pending. Review them anew.
