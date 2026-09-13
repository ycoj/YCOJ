# Tool routes

- [Markdown OCR endpoint contracts](markdown-ocr.md): standalone `GET /tools/markdown-ocr` page plus `POST` multipart upload that admits an asynchronous image/PDF-to-Markdown job (HTTP 202) backed by the persistent, cluster-shared `background_task` store, and `GET /tools/markdown-ocr/:jobId` polling with per-page PDF progress.
