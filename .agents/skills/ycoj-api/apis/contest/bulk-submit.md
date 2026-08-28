# Contest Bulk Submit `GET/POST /contest/:tid/bulk-submit`

Default header: `Accept: application/json`. Browser-negotiated GET requests render HTML; POST uploads use `multipart/form-data`, and JSON negotiation returns the operation result.

Contest managers upload a zip of offline contestants' C++ sources. `zipMode` selects the zip layout (default `auto`):

- `subfolder`: each first-level folder is a contestant; each nested folder is a problem name containing a matching `.cpp` file (`alice/apple/apple.cpp`).
- `nosubfolder`: each first-level folder is a contestant; `.cpp` files sit directly in it, named after the problem (`alice/apple.cpp`). Nested problem folders are ignored.
- `auto`: accept both layouts. If the same contestant and problem appear in both, the subfolder file is used.

```
alice/apple/apple.cpp
alice/gcd.cpp
bob/gcd.cpp
```

A shared wrapper directory is stripped. Only `.cpp` files are accepted.

POST always **inspects first** (parse zip, map pids, read sources, apply problem/language/empty/length checks, look up real-user and vuser identity). Inspect does not create users, attend the contest, insert records, or update nSubmit/status. If `dryrun=true`, the inspect result is returned as-is (planned new vusers use `uid: 0`) without mutating contest state. If `dryrun=false`, the server then **commits**: for each contestant with at least one ready file, create/reuse the chosen account and attend, then write each ready file through `record.add` plus the normal counter/status updates. `record.add` creates and queues the judge task. Submission, queue, counter, or status failures are reported as per-entry skips, and processing continues for other entries. The commit is not idempotent; retrying after a partial failure may create another record. Allowed once the contest has started, including after it ends. Not-started contests are rejected with `ContestNotLiveError`.

## GET `/contest/:tid/bulk-submit`

### Params

| Parameter | Type | Purpose | Permission |
| --- | --- | --- | --- |
| tid | string (ObjectId) | Contest ID | Contest owner/maintainer, or `PERM_EDIT_CONTEST` |

### Result

- tdoc: Tdoc
- tsdoc: ContestStatusDoc \| null
- owner_udoc: UserDoc
- pdict: ProblemDict
- langRange: Record\<string, string\>  (allowed C++ language ID -> display name)
- defaultLang: string  (prefers `cc.cc14o2` when available; otherwise uses the first allowed C++ language)
- mappingDefaults: Record\<number, string\>  (pid -> prefilled zip problem name. Defaults use a default-type file-IO problem's `config.subType` or the ordinary pid/letter fallback; all non-empty defaults are compared using trimmed, case-insensitive names, so only the first occurrence is prefilled and colliding later values are empty.)

HTML: `contest_bulk_submit.html`. JSON example for two file-IO problems that both use `rag.in/rag.out`: `{ "tdoc":{"docId":"665f00000000000000000001"},"langRange":{"cc.cc14o2":"C++14(O2)"},"defaultLang":"cc.cc14o2","mappingDefaults":{"1001":"rag","1002":""} }`.

## POST `/contest/:tid/bulk-submit`

There is no `operation` field; the route's default POST is the bulk submission.

### Params

| Parameter | Type | Purpose | Permission |
| --- | --- | --- | --- |
| tid | string (ObjectId) | Contest ID | Contest owner/maintainer, or `PERM_EDIT_CONTEST` |
| file | Blob (zip) | Zip archive of contestant source code | Same as above |
| mapping | string (JSON) or object | Maps site problem IDs to problem names in the zip (a subfolder name in `subfolder` layout or the `.cpp` basename in `nosubfolder` layout), for example `{"1001":"apple","1002":"gcd"}`. Unmapped pids are skipped. A pid outside this contest, or duplicate mapped problem names after trimming and case-insensitive comparison, returns `ValidationError('mapping')`. | Same as above |
| lang | string (Name), optional | C++ language ID (`cc` or `cc.*`). Defaults to `cc.cc14o2` when it is allowed by the contest/domain; otherwise uses the first allowed C++ language. | Same as above |
| dryrun | boolean, optional | When true, return only the inspect result; do not create/reuse accounts, attend the contest, insert records, or update counters or contest status. | Same as above |
| existingUser | `"vuser"` \| `"existing"`, optional, default `"existing"` | When a **real user** (in the `user` collection) already has the contestant folder name, the default `existing` strategy attends and submits as that real user's uid; `vuser` explicitly creates or reuses a virtual user instead. When no real user exists, both strategies reuse or create a virtual user. | Same as above |
| zipMode | `"auto"` \| `"subfolder"` \| `"nosubfolder"`, optional, default `"auto"` | Zip layout: `subfolder` requires `contestant/problem/problem.cpp`; `nosubfolder` requires `contestant/problem.cpp`; `auto` recognizes both paths and prefers the subfolder layout for the same contestant and problem. | Same as above |

Multipart example: `POST /contest/665f00000000000000000001/bulk-submit` with `file=@weekly.zip&mapping={"1001":"apple"}&lang=cc.cc14o2&dryrun=on&existingUser=existing&zipMode=auto`.

Each source file remains subject to `limit.codelength`. Before extracting source code, an archive with more than 10,000 entries, an uncompressed total size above `limit.contest_files_size` (128 MiB by default), or multiple entries with the same path after `normalizeZipPath` returns `ValidationError('file')`. Non-`.cpp` archive files, invalid layouts, empty or oversized source files, and a language not allowed by the problem (including a problem with an explicitly empty `config.langs` list) are skipped per entry and do not stop the remaining entries.

### Result

- dryrun: boolean
- lang: string
- users: `{ uname: string; uid: number; created: boolean; kind: "vuser" \| "user"; realUid?: number }[]`
  - `kind: "user"`: Uses an existing real account through `existingUser=existing` (`created` is always false).
  - `kind: "vuser"`: Reuses or plans to create a virtual user; `created: true` means `ensureVuser` will be called or has been called.
  - `realUid`: Included for UI notification when the virtual-user strategy is used but a real user with the same name also exists.
  - `uid` is 0 for a dry run that will create a vuser; it is never 0 after commit.
  - Commit `users` includes only contestants with at least one ready file, for whom an account was actually created/reused and the contest was attended.
- submitted: `{ uname: string; uid: number; pid: number; rid?: ObjectId }[]`  (dry runs have no `rid`; committed submissions include only entries for which `record.add` and the follow-up counter/status updates succeed)
- skipped: `{ uname: string; problem: string; reason: string }[]`  (includes entries whose record, queue, counter, or status operation failed; a persisted record is not rolled back)

Successful commit example:

```json
{
  "dryrun": false,
  "lang": "cc.cc14o2",
  "users": [{ "uname": "alice", "uid": -1000, "created": true, "kind": "vuser" }],
  "submitted": [{ "uname": "alice", "uid": -1000, "pid": 1001, "rid": "665f00000000000000000002" }],
  "skipped": []
}
```

Dry-run example: `{ "dryrun":true,"lang":"cc.cc14o2","users":[{ "uname":"alice","uid":0,"created":true,"kind":"vuser" }],"submitted":[{ "uname":"alice","uid":0,"pid":1001 }],"skipped":[] }`.

For a real user with the same name, the default `existingUser=existing` strategy produces `{ "uname":"alice","uid":42,"created":false,"kind":"user" }`. With an explicit `existingUser=vuser`, the request uses a vuser instead and can include `realUid`.

Validation errors identify `file`, `mapping`, `lang`, `existingUser`, or `zipMode`. A contest that has not started returns `ContestNotLiveError`.
