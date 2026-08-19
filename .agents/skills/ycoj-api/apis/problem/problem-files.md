# GET/POST `/p/:pid/files` — problem files

## Description

Lists files, obtains signed download links, uploads (or expands a test-data ZIP), renames/deletes files, and queues generation from a generator/std pair. GET requires `PERM_VIEW_PROBLEM`; mutations require ownership plus `PERM_EDIT_PROBLEM_SELF` or `PERM_EDIT_PROBLEM`, and reject referenced problems except `get_links`. Non-owners downloading test data need `PRIV_READ_PROBLEM_DATA` or `PERM_READ_PROBLEM_DATA`.

## Request format

```ts
type FilesQuery = { d?: 'testdata,additional_file'; sidebar: boolean };
type FilesBody =
 | { operation: 'get_links'; files: string[]; type?: 'testdata'|'additional_file' }
 | { operation: 'upload_file'; filename?: string; type?: 'testdata'|'additional_file'; file: File }
 | { operation: 'rename_files'; files: string[]; newNames: string[]; type?: 'testdata'|'additional_file' }
 | { operation: 'delete_files'; files: string[]; type?: 'testdata'|'additional_file' }
 | { operation: 'generate_testdata'; std: string; gen: string };
```

For `upload_file`, use `multipart/form-data`; field name is exactly `file`. A `.zip` uploaded as `testdata` is expanded, sanitized per entry, and each non-directory entry added. Limits are the current problem-file count/size settings unless the caller has `PRIV_EDIT_SYSTEM`.

```http
POST /p/P1000/files HTTP/1.1
Accept: application/json
Content-Type: multipart/form-data; boundary=…
Cookie: sid=…

operation=upload_file&type=testdata&filename=1.in&file=@./testdata/1.in
```

## Response format

```ts
type FilesPage = { testdata: FileMeta[]; additional_file: FileMeta[]; reference?: ProblemReference; /* inherited detail fields */ };
type LinksResponse = { links: Record<string, string> };
type GenerateResponse = never; // redirect to record detail
```

```json
{"links":{"1.in":"https://storage.example/signed-url"}}
```

GET renders `problem_files.html`; representative body: `{ "pdoc":{"pid":"P1000"},"testdata":[{"name":"1.in","size":2}],"additional_file":[],"reference":null }`. Upload/rename/delete return the framework back response. `generate_testdata` creates a generation record and returns `{ "url":"/record/{rid}" }` under JSON accept.

# GET `/p/:pid/file/:filename` — download one problem file

## Description

Creates a signed storage download redirect. `type` defaults to `additional_file`; `type=testdata` applies the same test-data permission checks. Referenced problems cannot expose test data.

## Request format

```ts
type DownloadPath = { pid: string | number; filename: string };
type DownloadQuery = { type?: 'additional_file'|'testdata'; noDisposition?: boolean; tid?: string };
```

```http
GET /p/P1000/file/1.in?type=testdata HTTP/1.1
Accept: application/json
Cookie: sid=…
```

## Response format

```ts
type DownloadResponse = { url: string }; // under JSON accept
```

```http
{"url":"https://storage.example/signed-download"}
```
