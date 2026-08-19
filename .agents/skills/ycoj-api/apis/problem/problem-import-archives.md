# GET/POST `/problem/import/hydro` — Hydro archive import

## Description

Renders/imports a Hydro problem archive. Requires `PERM_CREATE_PROBLEM`; `keepUser=true` additionally requires `PRIV_EDIT_SYSTEM`. The import runs with supplied prefix/hidden options and may continue after the request returns.

## Request format

```ts
type HydroImportBody = { file: File; keepUser: boolean; preferredPrefix?: string; hidden: boolean };
```

Use `multipart/form-data`; file field is `file`; `preferredPrefix` is letters only.

```http
POST /problem/import/hydro HTTP/1.1
Accept: application/json
Content-Type: multipart/form-data; boundary=…
Cookie: sid=…

file=@./export.zip&preferredPrefix=T&hidden=true&keepUser=false
```

## Response format

```ts
type ImportResponse = { url: string }; // under JSON accept
```

```http
{"url":"/p?showImport=1"}
```

Under JSON accept, a completed import instead returns `{ "url":"/p" }`; after five seconds it returns the `showImport=1` URL if work is not yet complete. GET renders `problem_import.html`; representative body is `{}`. Failures are sent as a message to the requester.

# GET/POST `/problem/import/fps`, `/problem/import/qduoj`, and `/problem/import/hoj`

## Description

These package routes import FPS XML/ZIP, QDUOJ ZIP, and HOJ ZIP exports, respectively. Each requires `PERM_CREATE_PROBLEM`. FPS creates config/test data (and optionally remote-judge configuration); QDUOJ/HOJ build problem statements, test data, and `config.yaml` from their package conventions.

## Request format

```ts
type ArchiveImportBody = { file: File };
```

All POSTs are `multipart/form-data` with the exact field name `file`.

```http
POST /problem/import/qduoj HTTP/1.1
Accept: application/json
Content-Type: multipart/form-data; boundary=…
Cookie: sid=…

file=@./qduoj-export.zip
```

## Response format

```ts
type ArchiveImportResponse = { url: string }; // under JSON accept
```

```http
{"url":"/p"}
```

GET responses render importer templates (`problem_import_fps.html` for FPS; `problem_import.html` for QDUOJ/HOJ, with `type` set to `QDUOJ` or `HOJ`). QDUOJ rejects files over 256 MiB; HOJ rejects files over 128 MiB; FPS applies the `import-fps.limit` setting (default 64 MiB) to each XML input/package entry.
