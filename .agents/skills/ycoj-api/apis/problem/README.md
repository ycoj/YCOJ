# Problem APIs

All paths are domain-relative: on a non-system domain prefix them with `/d/{domainId}`. Route handlers are session-authenticated; use `Cookie: sid=…` and request JSON with `Accept: application/json`. With that JSON accept header, framework redirects are represented as HTTP 200 JSON `{ "url": "/target" }`; without it they are HTTP redirects. A handler may still deliberately return HTML/template payload, Markdown, or a signed URL as noted in each document. POST action routes select the decorated method with `operation` (for example `operation=upload_file`).

- [Problem set and random selection](problem-set.md)
- [Legacy category compatibility redirect](problem-category-compat.md)
- [Problem detail, submission, hacking, and statistics](problem-detail-submit.md): submission and hack contest context validates `tid` from query or body parameters
- [Problem creation and editing](problem-create-edit.md)
- [Problem files and downloads](problem-files.md)
- [Problem solutions](problem-solutions.md)
- [Hydro, FPS, QDUOJ, and HOJ imports](problem-import-archives.md)
- [ZSHFOJ import](problem-import-zshfoj.md)
- [Problem API operations](problem-api.md)

Workflows: [create a problem from local files](../../workflows/create-problem-from-local-files.md) and [bulk edit problems](../../workflows/bulk-edit-problems.md).
