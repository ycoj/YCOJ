# Markdown OCR

All Markdown OCR routes require an authenticated account with `PRIV_USER_PROFILE` and the current domain's `PERM_VIEW`. The feature is additionally gated by AI configuration: `aiGeneration.enabled` must be on and a valid model profile must resolve (the `markdownOcr` selection, falling back to the `htmlToMarkdown` selection, then `dataGeneration`). A disabled or unconfigured feature renders the page with `enabled: false` and fails submission immediately.

## `GET /tools/markdown-ocr`

Description: render the standalone Markdown OCR tool page. Request: no arguments. Response `type Response=HTML`, template `markdown_ocr`. The template context includes `enabled` (whether the OCR configuration validates), `profiles` (public selectable model profiles when enabled), `maxFileSize` (33,554,432 bytes), `maxPages` (40), and `imageMediaTypes` (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).

## `POST /tools/markdown-ocr`

Description: admit an asynchronous conversion of an uploaded image or PDF into problem Markdown. `Content-Type: multipart/form-data`; the upload travels in the `file` field and an optional `profileId` form field selects a configured provider/model (otherwise the configured `markdownOcr` profile is used).

```ts
type MarkdownOcrSubmitForm = {
  file: File;         // required, non-empty, at most 33,554,432 bytes
  profileId?: string; // optional model profile override
};
```

```http
POST /tools/markdown-ocr HTTP/1.1
Accept: application/json
Cookie: sid=…
Content-Type: multipart/form-data; boundary=…
```

Accepted inputs: PNG, JPEG, GIF, and WebP images, or a PDF. Detection prefers content sniffing (image magic bytes / the `%PDF-` header) over the declared MIME type or filename extension; declared `image/*`/`application/pdf` types and `.png`/`.jpg`/`.jpeg`/`.gif`/`.webp`/`.pdf` extensions are used only as fallbacks. Anything else fails validation before a job is admitted. A PDF is rasterized page by page in the admitting process (at most 40 pages; longer documents fail the job itself, not the request).

```ts
// HTTP 202; the job is already admitted to the shared store when this responds.
type MarkdownOcrSubmitResponse = { jobId: string; status: 'pending' };
```

```json
{"jobId":"08305266-8767-4556-8f2e-e398cf3d9ecf","status":"pending"}
```

Error statuses (JSON body `{ "error": { "name": … } }` under `Accept: application/json`):

- HTTP 403 `ValidationError` — no file, an empty file, a file over 32 MiB, or an unsupported type. Anonymous callers get `PrivilegeError`.
- HTTP 503 `MarkdownOcrCapacityError` — the per-owner (10) or global (100) live-job capacity is full.

The persisted job payload is metadata only (`mediaType`, `kind`, `filename`, `size`, and a redacted config without `apiKey`); uploaded bytes and the API key stay in the admitting process's memory as the runtime payload. Consequently only the admitting process ever claims the job (`pending` → `running`); if it dies before settling, the job stalls and is surfaced as `failed` with the timeout message once it exceeds the budget (detected on poll by any worker, or by the periodic reclaim on the web master).

## `GET /tools/markdown-ocr/:jobId`

Description: poll a conversion job from the shared store; any worker can serve the poll. Only the submitting user can read the job, and the domain must match the route. Unknown, expired, or foreign-owned jobs return HTTP 404 `NotFoundError`.

```ts
type MarkdownOcrPollResponse = { jobId: string } & (
  | { status: 'pending' | 'running'; progress?: { done: number; total: number } }
  | { status: 'completed'; markdown: string; pages: number }
  | { status: 'failed'; error: string }
);
```

```http
GET /tools/markdown-ocr/08305266-8767-4556-8f2e-e398cf3d9ecf HTTP/1.1
Accept: application/json
Cookie: sid=…
```

HTTP 200, `application/json` (including failed jobs):

```json
{"jobId":"08305266-8767-4556-8f2e-e398cf3d9ecf","status":"running","progress":{"done":2,"total":7}}
```

```json
{"jobId":"08305266-8767-4556-8f2e-e398cf3d9ecf","status":"completed","markdown":"## Description\n\n…$x+y$…","pages":7}
```

`progress` is present only while a job is in flight and reflects completed pages; it is removed when the job settles. `completed` carries the joined Markdown and the converted page count (`1` for image uploads). `failed` carries `Markdown OCR failed.` for provider/conversion failures or `Markdown OCR timed out.` when the job exceeds the 15-minute budget or stalls with its admitting process gone. Capacity slots free the moment a job settles; terminal results are retained and pollable for one hour, then removed by a TTL index. Late results after a job has settled are ignored. There is no retry or cancellation endpoint; nothing is saved to a problem automatically.

Workflow: `POST` once, then poll this route roughly once per second while `status` is `pending` or `running`. Stop on `completed` and use `markdown`, or stop on `failed` and report `error`. A 404 means the job is unknown, not owned by the caller, or past its retention window — do not resubmit automatically on 404.

## Conversion semantics

The model receives each image as a `file` content part (`image/*` for uploads, `image/png` for rasterized PDF pages) under a system prompt that requires Markdown headings/lists/tables, LaTeX math with `$...$` inline and `$$...$$` display fences, paired ```` ```input{x}```` / ```` ```output{x}```` sample fences, language-labelled code fences, Markdown link syntax, and Markdown-only output with no explanatory prose. Image text is treated as data to transcribe, never as instructions that override the task rules. PDF pages are processed sequentially; the page prompt identifies the page number and total and forbids repeating other pages' content.
