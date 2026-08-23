# POST `/api/problem` — query one problem

## Description

API operation `problem` retrieves one problem by numeric document ID or string PID. A hidden result requires `PERM_VIEW_PROBLEM_HIDDEN`; absent results are `null`.

## Request format

```ts
type ProblemArgs = { domainId: string; id: number | string };
```

```http
POST /api/problem HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"domainId":"system","id":"P1000"}
```

## Response format

```ts
type ProblemResponse = ProblemDoc | null;
```

```json
{"docId":1000,"pid":"P1000","title":"A + B","hidden":false}
```

# POST `/api/problems` — query several numeric problem IDs

## Description

API operation `problems` obtains accessible problems by document ID. Input IDs must be positive integer steps; inaccessible/missing entries are omitted while the retained entries follow the input-ID order.

## Request format

```ts
type ProblemsArgs = { domainId: string; ids: number[] };
```

```http
POST /api/problems HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"domainId":"system","ids":[1000,1001]}
```

## Response format

```ts
type ProblemsResponse = ProblemDoc[];
```

```json
[{"docId":1000,"pid":"P1000","title":"A + B"}]
```

# POST `/api/tags` — problem categories

## Description

API operation `tags` parses and returns the system `problem.categories` YAML setting, or `{}` when it is empty.

## Request format

```ts
type TagsArgs = Record<string, never>;
```

```http
POST /api/tags HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{}
```

## Response format

```ts
type TagsResponse = Record<string, unknown>;
```

```json
{"algorithm":["dp","graph"]}
```

# GET `/p/:pid/generate` — AI test-data generation options

## Description

Returns generation availability, safe selectable model fields, testcase limits, and current judge limits. Only models configured by an administrator in `/manage/ai-provider` are returned; provider endpoints and credentials are never exposed. The caller must be an owner with self-edit permission or have `PERM_EDIT_PROBLEM`, contest context is rejected, and referenced problems are rejected.

## Request format

```http
GET /p/P1000/generate HTTP/1.1
Accept: application/json
Cookie: sid=…
```

## Response format

```ts
type AiGenerationOptions = {
    enabled: boolean;
    profiles: { id: string; label: string; model: string }[];
    defaultProfileId: string;
    defaultTarget: number;
    maxWithoutChecker: number;
    maxWithChecker: number;
    timeLimitMs: number;
    memoryLimitMb: number;
};
```

```json
{"enabled":true,"profiles":[{"id":"provider-1:model-1","label":"OpenAI / GPT-5","model":"gpt-5"}],"defaultProfileId":"provider-1:model-1","defaultTarget":20,"maxWithoutChecker":49,"maxWithChecker":48,"timeLimitMs":1000,"memoryLimitMb":256}
```

# POST `/p/:pid/generate` — enqueue AI test-data generation

## Description

Starts exactly one active AI generation record for a problem and returns its record ID. `profileId` must be one of the configured IDs returned by GET. The queue stores only that ID and resolves the provider credentials again when the worker starts.

## Request format

```ts
type AiGenerateRequest = {
    profileId?: string;
    testcaseTarget?: number;
    timeLimitMs?: number;
    memoryLimitMb?: number;
    instructions?: string;
    standardSolution?: { source: string };
    checker?: { mode: 'provided'; source: string } | { mode: 'generated'; requirements: string };
};
```

```http
POST /p/P1000/generate HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"profileId":"provider-1:model-1","testcaseTarget":10,"instructions":"Cover large-input edge cases."}
```

## Response format

```ts
type AiGenerateResponse = { rid: string; url: string };
```

```json
{"rid":"66b5c0e00000000000000000","url":"/record/66b5c0e00000000000000000"}
```

Under `Accept: application/json` the response is the JSON body above, with `url` pointing at the record-detail route; non-JSON form submissions receive a 302 redirect instead. The record begins with `aiGeneration.active: true` and stage `waiting`; a second active generation produces `AiGenerationAlreadyActiveError`. Poll a record-detail API/page outside this problem-route scope to observe completion.
