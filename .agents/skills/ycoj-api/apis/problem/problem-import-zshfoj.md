# GET/POST `/problem/import/zshfoj` — ZSHFOJ remote problem import

## Description

Displays the importer or fetches a remote ZSHFOJ problem via the configured judge-server token, creating a `remote_judge`/`judgeclient` configured problem if it is absent. Requires `PERM_CREATE_PROBLEM`; a missing system `judgeserver.token` causes a permission error.

## Request format

```ts
type ZshfojImportBody = { oj: string; pid: string };
```

```http
POST /problem/import/zshfoj HTTP/1.1
Accept: application/json
Content-Type: application/json
Cookie: sid=…

{"oj":"luogu","pid":"P1000"}
```

## Response format

```ts
type ZshfojImportResponse = { url: string }; // under JSON accept
```

```http
{"url":"/p/P1000"}
```

GET renders `problem_import_zshfoj.html`; representative body is `{}`. POST derives the remote target as `oj + pid`; if the returned `data.pid` already exists it returns the same URL envelope without creating a duplicate.
