# Repository Instructions

## Keep backend API documentation synchronized

Any backend change that adds, removes, renames, or changes an HTTP route, connection endpoint, `/api/:op` operation, request parameter or validation rule, permission requirement, response schema, status behavior, content type, redirect, or side effect must update `.agents/skills/ycoj-api/` in the same change.

- Update the matching endpoint document and API index; add a document in the URL-appropriate group for a new endpoint.
- Keep each affected contract's description, request type and example, and response type and example aligned with the implementation.
- Update any common workflow whose request sequence, fields, responses, verification, or stopping conditions are affected.
- Do not consider the backend change complete until the synchronized documentation is validated and contains no stale route or operation references.
