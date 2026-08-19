---
name: ycoj-api
description: Use the current YCOJ backend HTTP, WebSocket, SSE, and operation APIs to inspect or change problems, contests, users, domains, records, and other platform resources without rediscovering request and response contracts from server code. Use for direct API requests and for the documented problem/contest/bulk-edit workflows; do not use for changing backend implementation.
---

# YCOJ API

Use the checked-in contracts in [apis/README.md](apis/README.md) as the source of truth for this repository snapshot. Read only the API documents needed for the request. Inspect backend code only when a document is missing, internally inconsistent, or contradicted by an observed server response.

## Select the endpoint

1. Normalize a domain-scoped URL. Use `/d/{domainId}{path}` when the target domain is not selected by the host; otherwise use `{path}` directly. The server strips `/d/{domainId}` before route matching.
2. Open [apis/README.md](apis/README.md), select the group from the URL prefix, then open the endpoint document.
3. Treat each documented HTTP method and each POST `operation` as a distinct contract. A handler method named `postUploadFile`, for example, normally means `POST` to the registered route with `{"operation":"uploadFile"}`, not an `/upload-file` URL.
4. For `/api/{op}`, distinguish Query, Mutation, and Subscription. Queries allow GET or POST, mutations require POST, and subscriptions use `/api/{op}/conn` over WebSocket (or the documented SSE fallback).

## Send requests

- Use `https://ycoj.cc/` as the default base URL. Override it only when the task or existing environment explicitly identifies another YCOJ deployment. Resolve the target domain separately; if required credentials are unavailable, ask for them rather than guessing.
- Send `Accept: application/json` for ordinary route APIs. Send JSON bodies with `Content-Type: application/json`; use `multipart/form-data` only where an upload document requires it.
- Authenticate with an existing authorized session using `Authorization: Bearer {sid}` or `Cookie: sid={sid}`. A `sid` query parameter is supported for shared connections but should not be exposed in logs or prose. Never print or commit session values; persistence is allowed only in the task-scoped temporary cookie jar described below.
- Follow the endpoint's permission and privilege notes. Documentation describes server requirements; it does not grant authority to perform a mutation.
- Preserve exact field names, value encodings, and array shapes from the selected document. Do not synthesize parameters from UI labels or handler names.
- With JSON negotiation, a logical redirect is commonly returned as HTTP 200 with `{"url":"..."}`. File downloads, event streams, and some compatibility routes retain their documented non-JSON response.

All JSON error responses use the envelope below; concrete fields vary by error class:

```ts
interface ErrorResponse {
  error: {
    name?: string;
    params?: unknown[];
    code?: number;
    message?: string; // present only when the concrete error serializer exposes it
  };
}
```

```json
{
  "error": {
    "name": "ValidationError",
    "params": ["pid"],
    "code": 403
  }
}
```

Serialized `ObjectId` values are hexadecimal strings, `Date` values are ISO-8601 strings, and `bigint` values use the string form `BigInt::{decimal}`. Fields whose names start with `_` are omitted except `_id`.

## Cookies and session reuse

For a workflow with multiple HTTP requests, persist response cookies in a cookie-jar file under the operating system's temporary directory and reuse that jar on subsequent requests. This avoids repeatedly signing in or manually copying `sid`.

- Create a unique cookie jar for the current task, base URL, and account. Keep it outside the repository and other generated deliverables; do not reuse one jar across deployments or identities.
- Restrict access to the current user when the client or operating system supports file permissions. Do not display the jar, include it in tool output, or expose its path when reporting results.
- Configure the HTTP client to read and update the same jar on every request. With curl, use both `--cookie-jar <temporary-cookie-file>` and `--cookie <temporary-cookie-file>`; after a login response stores `sid`, later requests automatically send it.
- A supplied raw `sid` may be used directly without a file for a single request. If it is written for reuse, write it only to the task-scoped temporary cookie jar and apply the same protections.
- Delete the temporary cookie file as soon as the request sequence finishes or is abandoned. Deleting the file removes the local credential copy but does not invalidate the server-side session; call the documented logout endpoint when session invalidation is part of the task.

## Execute multi-step workflows

- For creating and verifying a problem from local files, read [workflows/create-problem-from-local-files.md](workflows/create-problem-from-local-files.md).
- For finding problems and creating a contest, read [workflows/create-contest-with-problems.md](workflows/create-contest-with-problems.md).
- For applying the same edit across selected problems, read [workflows/bulk-edit-problems.md](workflows/bulk-edit-problems.md).

For mutations, validate target IDs before the first write, record each successful returned ID, stop on the first unexpected response, and do not retry non-idempotent requests unless the prior attempt is known not to have committed. Complete the workflow's read-back verification before reporting success.
