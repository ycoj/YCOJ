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

POST always **inspects first** (parse zip, map pids, read sources, apply problem/language/empty/length checks, look up real-user and vuser identity). Inspect does not create users, attend the contest, insert records, or update nSubmit/status. If `dryrun=true`, the inspect result is returned as-is (planned new vusers use `uid: 0`) without mutating contest state. If `dryrun=false`, the server then **commits**: for each contestant with at least one ready file, create/reuse the chosen account and attend, then write each ready file through `record.add` plus the normal counter/status updates. Record insertion or judge-queue failures are recovered through the claim on retry; post-insert counter/status failures leave the record durable, are logged, and are repaired by a later retry. Processing continues for other entries. An already-claimed item (same domain, contest, problem, user, and source) returns the existing record without inserting a duplicate. Allowed once the contest has started, including after it ends. Not-started contests are rejected with `ContestNotLiveError`.

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
- defaultLang: string  (prefers `cc.cc14`)
- mappingDefaults: Record\<number, string\>  (pid -> prefilled zip problem name, either the problem pid or its letter index such as A/B/C)

HTML: `contest_bulk_submit.html`. JSON example: `{ "tdoc":{"docId":"665f00000000000000000001"},"langRange":{"cc.cc14":"C++14"},"defaultLang":"cc.cc14","mappingDefaults":{"1001":"A"} }`.

## POST `/contest/:tid/bulk-submit`

There is no `operation` field; the route's default POST is the bulk submission.

### Params

| Parameter | Type | Purpose | Permission |
| --- | --- | --- | --- |
| tid | string (ObjectId) | Contest ID | Contest owner/maintainer, or `PERM_EDIT_CONTEST` |
| file | Blob (zip) | Zip archive of contestant source code | Same as above |
| mapping | string (JSON) or object | Maps site problem IDs to problem names in the zip (a subfolder name or the `.cpp` basename), for example `{"1001":"apple","1002":"gcd"}`. Unmapped pids are skipped. A pid outside this contest, or a duplicate folder name after trimming and case-insensitive comparison, returns `ValidationError('mapping')`. | Same as above |
| lang | string (Name), optional | C++ language ID (`cc` or `cc.*`). Defaults to a C++ language allowed by the contest/domain, preferring `cc.cc14`. | Same as above |
| dryrun | boolean, optional | When true, return only the inspect result; do not create/reuse accounts, attend the contest, insert records, or update counters or contest status. | Same as above |
| existingUser | `"vuser"` \| `"existing"`, optional, default `"vuser"` | When a **real user** (in the `user` collection) already has the contestant folder name, `vuser` creates or reuses a virtual user; `existing` attends and submits as that real user's uid. When no real user exists, both strategies reuse or create a virtual user. | Same as above |
| zipMode | `"auto"` \| `"subfolder"` \| `"nosubfolder"`, optional, default `"auto"` | Zip layout: `subfolder` requires `contestant/problem/problem.cpp`; `nosubfolder` requires `contestant/problem.cpp`; `auto` recognizes both paths and prefers the subfolder layout for the same contestant and problem. | Same as above |

Multipart example: `POST /contest/665f00000000000000000001/bulk-submit` with `file=@weekly.zip&mapping={"1001":"apple"}&lang=cc.cc14&dryrun=on&existingUser=vuser&zipMode=auto`.

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
- submitted: `{ uname: string; uid: number; pid: number; rid?: ObjectId }[]`  (dry runs have no `rid`; committed submissions include only entries for which `record.addJudge()` succeeds, including idempotent matches with an existing rid)
- skipped: `{ uname: string; problem: string; reason: string }[]`  (includes entries whose `record.add` was persisted but whose later nSubmit/`updateStatus` update caused `record.addJudge()` to reject; a retry returns the existing rid without rerunning those updates)

Successful commit example:

```json
{
  "dryrun": false,
  "lang": "cc.cc14",
  "users": [{ "uname": "alice", "uid": -1000, "created": true, "kind": "vuser" }],
  "submitted": [{ "uname": "alice", "uid": -1000, "pid": 1001, "rid": "665f00000000000000000002" }],
  "skipped": []
}
```

Dry-run example: `{ "dryrun":true,"lang":"cc.cc14","users":[{ "uname":"alice","uid":0,"created":true,"kind":"vuser" }],"submitted":[{ "uname":"alice","uid":0,"pid":1001 }],"skipped":[] }`.

For a real user with the same name and `existingUser=existing`, `users` is shaped like `{ "uname":"alice","uid":42,"created":false,"kind":"user" }`. For a real user with the same name and `existingUser=vuser` (the default), the request still uses a vuser and can include `realUid`.

Validation errors identify `file`, `mapping`, `lang`, or `zipMode`. A contest that has not started returns `ContestNotLiveError`.
