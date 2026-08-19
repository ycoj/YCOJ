# Homework route reference

`GET /homework`, `/homework/:tid`, `/homework/create`, `/homework/:tid/edit`, `/homework/:tid/file`, `/homework/:tid/file/:type/:filename`, and `/homework/:tid/scoreboard[/:view]` are the registered routes. Create/edit fields, body operations, HTML models, upload/download behavior, and permissions are specified in [README.md](./README.md); all POST dispatch is by the body operation rather than a URL-derived `postXxx` suffix.
