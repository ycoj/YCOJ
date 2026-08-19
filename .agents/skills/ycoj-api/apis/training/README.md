# Training routes

`PERM_VIEW_TRAINING` gates list/detail/files/download. Creation/edit/delete additionally enforce `PERM_CREATE_TRAINING`, `PERM_EDIT_TRAINING(_SELF)`, and pin permissions. Browser GETs render templates; POST handlers commonly return a body plus redirect.

* `GET /training?page?:PositiveInt&q?:string` -> `training_main.html`, `{ tdocs, page, tpcount, tsdict, tdict, q }`.
* `GET /training/:tid?uid?:PositiveInt` -> `training_detail.html`/PJAX, `{ tdoc, tsdoc, pids, pdict, psdict, ndict, nsdict, udoc, udict, selfPsdict, groups, missing }`.
* `POST /training/:tid` with `{ operation:"enroll" }` requires profile privilege and redirects back. `{ operation:"delete" }` deletes and redirects `/training`.
* `GET /training/create` or `/training/:tid/edit` renders `training_edit.html`.
* `POST /training/create` or `/training/:tid/edit` fields `{ tid?:ObjectId; title:Title; content:Content; dag:string(JSON array); pin:UnsignedInt; description:Content }`; every DAG node needs unique numeric `_id`, title, nonempty `pids`, and valid `requireNids`. JSON response is `{ tid:ObjectId, url:string }`; normal browser negotiation redirects to `/training/:tid`.
* `GET /training/:tid/file` -> file page model `{ tdoc, tsdoc, udoc, files, urlForFile }`; `POST` operation `uploadFile` uses multipart `file` and `filename`; `deleteFiles` uses `{ files: string[] }`; both redirect back.
* `GET /training/:tid/file/:filename?noDisposition:boolean` redirects to a signed binary download URL and sets `Cache-Control: public`.

Authenticate with `Cookie: sid=...` or `Authorization: Bearer <sid>` and use `Content-Type: application/json` for JSON bodies. File upload requires multipart form data.
