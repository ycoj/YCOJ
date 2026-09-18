# Problem feedback endpoint contracts

Problem feedback is domain-scoped. Prefix either path with `/d/{domainId}` when the domain is selected through the URL. Authenticate with a `sid` Cookie or Bearer token. Requests may use `application/json` or `application/x-www-form-urlencoded`; examples below use JSON. Dates are serialized as ISO-8601 strings and `ObjectId` values as 24-character hexadecimal strings.

```ts
type ProblemFeedbackStatus = 'pending' | 'processing' | 'resolved' | 'invalid';

interface ProblemFeedbackDoc {
  _id: string;
  domainId: string;
  pid: number;
  owner: number;
  content: string;
  status: ProblemFeedbackStatus;
  createdAt: string;
  updatedAt: string;
}
```

Status meanings:

| Status | Meaning |
| --- | --- |
| `pending` | The report has not yet been confirmed by an administrator. Every new report starts in this state. |
| `processing` | An administrator has confirmed the report and work is in progress. |
| `resolved` | The reported problem has been handled; no further action is currently required. |
| `invalid` | The report was reviewed and found not to describe a valid problem. |

## POST `/p/:pid/feedback`

Creates feedback for a problem. The caller must be logged in and able to view that problem. The server trims leading and trailing whitespace from `content` before validation and persistence. The trimmed value must contain 1 to 1000 characters. Creating feedback does not modify the problem.

```ts
type CreateProblemFeedbackPath = { pid: string | number };
type CreateProblemFeedbackBody = { content: string };
type CreateProblemFeedbackResponse = { feedback: ProblemFeedbackDoc };
```

```http
POST /p/P1000/feedback HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=SESSION

{"content":"  The statement does not define the range of n.  "}
```

```json
{
  "feedback": {
    "_id": "66aa66aa66aa66aa66aa66aa",
    "domainId": "system",
    "pid": 1000,
    "owner": 12,
    "content": "The statement does not define the range of n.",
    "status": "pending",
    "createdAt": "2026-09-18T18:00:00.000Z",
    "updatedAt": "2026-09-18T18:00:00.000Z"
  }
}
```

Errors:

- An unauthenticated caller receives an authentication/permission error and no feedback is created.
- An unknown problem, or one the caller cannot view, returns the normal problem visibility error (`ProblemNotFoundError` or `PermissionError`, as applicable) and does not reveal inaccessible problem data.
- A missing/non-string `content`, an empty value after trimming, or a trimmed value longer than 1000 characters returns `ValidationError`.

## GET `/manage/problem-feedback`

Lists problem feedback for administrators. The query is always restricted to the `domainId` resolved from the current URL/request; it never returns or counts feedback from another domain. Requires the global `PRIV_EDIT_SYSTEM` privilege. `page` defaults to 1 and must be a positive integer. `status` defaults to `pending`; it accepts one of the four stored `ProblemFeedbackStatus` values or `all`. The `all` filter includes every stored status, but still only within the current request domain. Results are paginated; `count` is the number of matching reports in that domain and `pcount` is the number of pages. `pdict` contains the current-domain problems referenced by the page, keyed by numeric problem ID, and `udict` contains the feedback owners referenced by the page, keyed by numeric user ID. Non-JSON negotiation renders the `manage_problem_feedback` page.

```ts
type ProblemFeedbackListStatus = ProblemFeedbackStatus | 'all';

type ProblemFeedbackListQuery = {
  page?: number;
  status?: ProblemFeedbackListStatus;
};

interface ProblemFeedbackListResponse {
  docs: ProblemFeedbackDoc[];
  page: number;
  pcount: number;
  count: number;
  pdict: Record<number, ProblemDoc>;
  udict: Record<number, UserDoc>;
  status: ProblemFeedbackListStatus;
  page_name: 'manage_problem_feedback';
}
```

```http
GET /manage/problem-feedback?page=1&status=pending HTTP/1.1
Accept: application/json
Cookie: sid=ADMIN_SESSION
```

```json
{
  "docs": [],
  "page": 1,
  "pcount": 0,
  "count": 0,
  "pdict": {},
  "udict": {},
  "status": "pending",
  "page_name": "manage_problem_feedback"
}
```

Errors:

- Missing `PRIV_EDIT_SYSTEM` returns `PermissionError` (HTTP 403).
- A non-positive/non-integer `page` or unsupported `status` returns `ValidationError`.

## POST `/manage/problem-feedback` operation `update_status`

Changes one report's moderation status. Requires `PRIV_EDIT_SYSTEM`. The report is selected by its ObjectId; a successful update refreshes `updatedAt` and returns the updated document plus the management-page URL.

```ts
type UpdateProblemFeedbackStatusBody = {
  operation: 'update_status';
  id: string;
  status: ProblemFeedbackStatus;
};

type UpdateProblemFeedbackStatusResponse = {
  feedback: ProblemFeedbackDoc;
  url: string;
};
```

```http
POST /manage/problem-feedback HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=ADMIN_SESSION

{"operation":"update_status","id":"66aa66aa66aa66aa66aa66aa","status":"processing"}
```

```json
{
  "feedback": {
    "_id": "66aa66aa66aa66aa66aa66aa",
    "domainId": "system",
    "pid": 1000,
    "owner": 12,
    "content": "The statement does not define the range of n.",
    "status": "processing",
    "createdAt": "2026-09-18T18:00:00.000Z",
    "updatedAt": "2026-09-18T18:05:00.000Z"
  },
  "url": "/manage/problem-feedback?status=processing"
}
```

Errors:

- Missing `PRIV_EDIT_SYSTEM` returns `PermissionError` (HTTP 403).
- A malformed `id` or unsupported `status` returns `ValidationError`; no report is changed.
- A well-formed `id` that does not identify feedback in the active domain returns `NotFoundError` (HTTP 404).
- A missing or unsupported `operation` returns `InvalidOperationError` (HTTP 405).
