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

# POST `/api/problem.aiGenerateTestdata` — enqueue AI test-data generation

## Description

Starts exactly one active AI generation record for a problem and returns its record ID. It is available only when `aiGeneration.enabled` is true; the caller must be an owner with self-edit permission or have `PERM_EDIT_PROBLEM`, and referenced problems are rejected.

## Request format

```ts
type AiGenerateArgs = { domainId: string; id: number | string; instructions?: string /* max 10,000 */ };
```

```http
POST /api/problem.aiGenerateTestdata HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"domainId":"system","id":"P1000","instructions":"Create edge-case tests for overflow."}
```

## Response format

```ts
type AiGenerateResponse = { rid: string };
```

```json
{"rid":"66b5c0e00000000000000000"}
```

The record begins with `aiGeneration.active: true` and stage `waiting`; a second active generation produces `AiGenerationAlreadyActiveError`. Poll a record-detail API/page outside this problem-route scope to observe completion.
