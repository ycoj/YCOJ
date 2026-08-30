# Runtime endpoint contracts

Authenticated calls use `Cookie: sid=<token>` or `Authorization: Bearer <token>`. Redirecting browser mutations return 302; with `Accept: application/json`, their logical result is `type Redirect={url:string}`, e.g. `{"url":"/file"}`.

## `/file`

### GET — file list

Use to view the current user's files (or admin-inspect a user). `type FileListQuery={uid?:number}`; example `GET /file?uid=12`. Response `type FileList={files:Array<{name:string;size:number;lastModified?:number;etag?:string}>;urlForFile:string}`; example `{"files":[{"name":"a.txt","size":3}],"urlForFile":"/file/12/a.txt"}` plus HTML/PJAX template. A non-owner `uid` requires `PRIV_EDIT_SYSTEM`; empty file lists require `PRIV_CREATE_FILE`.

### POST `uploadFile`

Use multipart upload. `type UploadFields={operation:"uploadFile";filename:string}` plus form part `file: Binary`; example fields `operation=uploadFile&filename=notes.txt` with a `file` part. Response `Redirect`, example `{"url":"/file"}`. Requires `PRIV_CREATE_FILE`; filename, count/size quotas and duplicate names are validated.

### POST `deleteFiles`

`type DeleteFiles={operation:"deleteFiles";files:string[]}`; example `{"operation":"deleteFiles","files":["notes.txt"]}`. Response `Redirect`, example `{"url":"/file"}`. It deletes storage objects and metadata; access follows the prepared user/admin context.

## `/file/:uid/:filename`

### GET — signed download redirect

`type FilePath={uid:number;filename:string}; type FileQuery={noDisposition?:boolean}`; example `GET /file/12/notes.txt?noDisposition=false`. Response is `302` to signed object storage with `Cache-Control: public`, or logical `Redirect` example `{"url":"https://storage.example/…"}`. Requires an authenticated, real-name-verified (or exempt) user who owns `uid` and has `filename` in their file list; filename is validated and missing/invalid storage paths are not found.

## `/storage`

### GET — signed object stream

Use signed internal-storage links. `type StorageQuery={target:string;filename?:string;expire:number;secret:string}`; example `GET /storage?target=problem%2Fsystem%2F1000%2Ftestdata%2F1.in&expire=1800000000000&secret=sig`. Response `type Binary=ReadableStream`; example bytes `1\n2\n`, content type based on name (`.out/.ans` is text/plain) and optional attachment filename. Expired/invalid signature is denied; no session is required when signature is valid.

## `/judge/files` and `/judge/upload`

### `GET /judge/files`

Health check. `type Empty={}`; example `GET /judge/files`. Response `type OkText="ok"`, example `ok`; requires `PRIV_JUDGE`.

### `POST /judge/files`

Use judge daemon to obtain temporary download links. `type JudgeFiles={id?:string;files?:string[];pid?:number}`; examples `{"id":"submission-id"}` or `{"pid":1000,"files":["1.in"]}`. Response is either `type SubmissionLink={url:string}`, example `{"url":"https://storage/…"}`, or `type TestdataLinks={links:Record<string,string>|null}`, example `{"links":{"1.in":"https://storage/…"}}`. Requires `PRIV_JUDGE`; `pid` is unsigned int.

### `POST /judge/upload`

Use judge callback to append a generated file. `type JudgeUpload={rid:string;name:string}` plus multipart `file:Binary`; example fields `rid=66aa…&name=generated.in`. Response `type JudgeUploadResult={ok:1}`, example `{"ok":1}`. Requires `PRIV_JUDGE`; handler verifies record/problem permission, reference status, name, count, and size.

## Monitoring/integration HTTP routes

### `GET /metrics`

Use Prometheus scrape. Request `type MetricsHeaders={Authorization:"Basic <base64(name:password)>"}`, example `Authorization: Basic cHJvbWV0aGV1czpzZWNyZXQ=`. Success response `type PrometheusText=string`, example `# HELP hydrooj_requests_total …\nhydrooj_requests_total 12\n`, `text/plain`. Missing/incorrect Basic credentials return `401` with `WWW-Authenticate`; valid username with wrong password returns `403`. Only exists when `prom-client` package is enabled.

### `POST /center/report`

Optional center telemetry ingestion. `type CenterReport={installId:string;payload:string}`; example `{"installId":"abc","payload":"{\\"version\\":\\"5\\",\\"url\\":\\"https://oj.example\\"}"}`. Response `type CenterResult={code:0;notification?:string}`, example `{"code":0}`. Registered only with `center` package.

### `GET /onlyoffice-jwt`

Optional OnlyOffice JWT helper. `type OnlyOfficeQuery={url:string}`; example `GET /onlyoffice-jwt?url=https%3A%2F%2Foffice.example%2Fdoc`. Default response `type OnlyOfficeConfig={document:Record<string,unknown>;editorConfig:Record<string,unknown>;token:string}`, example `{"document":{"url":"https://office.example/doc","fileType":"docx"},"editorConfig":{"mode":"view"},"token":"eyJ…"}`. If `onlyoffice.externalSign` is configured, the external signer's body is forwarded instead. No route permission; URL/configuration validation applies.

### `POST /heap-snapshot`

Only registered when `--enable-heap-snapshot` is used. `type HeapInput={worker:number}`; example `{"worker":0}`. Response `type HeapResult={worker?:string;filename?:string;error?:string}`, example `{"worker":"0","filename":"Heap.20260819.heapsnapshot"}`. Requires `PRIV_EDIT_SYSTEM`.
