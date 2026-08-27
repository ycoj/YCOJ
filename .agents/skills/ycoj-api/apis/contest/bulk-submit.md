# Contest Bulk Submit `GET/POST /contest/:tid/bulk-submit`

默认 Header: `Accept: application/json`。GET 浏览器协商渲染 HTML；POST 为 `multipart/form-data` 上传，JSON 协商返回操作结果。

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

POST always **inspects first** (parse zip, map pids, read sources, apply problem/language/empty/length checks, look up real-user and vuser identity). Inspect does not create users, attend the contest, insert records, or update nSubmit/status. If `dryrun=true`, the inspect result is returned as-is (planned new vusers use `uid: 0`). If `dryrun=false`, the server then **commits**: for each contestant with at least one ready file, create/reuse the chosen account and attend, then write each ready file through `addJudgeRecord` (the same `record.add` plus `problem.nSubmit`, domain-user `nSubmit`, and `contest.updateStatus` path as ordinary problem submit). If `addJudgeRecord` fails, that entry is skipped and processing continues. An already-claimed item (same domain, contest, problem, user, and source) returns the existing record without inserting a duplicate. Allowed once the contest has started, including after it ends. Not-started contests are rejected with `ContestNotLiveError`.

## GET `/contest/:tid/bulk-submit`

### Params

| 参数 | 类型 | 用途 | 权限 |
| --- | --- | --- | --- |
| tid | string (ObjectId) | 比赛 ID | 比赛 owner/maintainer，或 `PERM_EDIT_CONTEST` |

### Result

- tdoc: Tdoc
- tsdoc: ContestStatusDoc \| null
- owner_udoc: UserDoc
- pdict: ProblemDict
- langRange: Record\<string, string\>  （允许的 C++ 语言 id → 显示名）
- defaultLang: string  （优先 `cc.cc14`）
- mappingDefaults: Record\<number, string\>  （pid → 预填 zip 题目名，题目 pid 或字母序号 A/B/C）

HTML `contest_bulk_submit.html`。JSON 示例：`{ "tdoc":{"docId":"665f00000000000000000001"},"langRange":{"cc.cc14":"C++14"},"defaultLang":"cc.cc14","mappingDefaults":{"1001":"A"} }`。

## POST `/contest/:tid/bulk-submit`

无 `operation` 字段；该路由的默认 POST 即为批量提交。

### Params

| 参数 | 类型 | 用途 | 权限 |
| --- | --- | --- | --- |
| tid | string (ObjectId) | 比赛 ID | 比赛 owner/maintainer，或 `PERM_EDIT_CONTEST` |
| file | Blob (zip) | 选手源码 zip | 同上 |
| mapping | string (JSON) 或 object | 网站题目 id 到 zip 内题目名（子文件夹名或 `.cpp` 主文件名），例如 `{"1001":"apple","1002":"gcd"}`。未映射的 pid 跳过；映射到非本场题目的 pid、或 trim 后大小写不敏感重复的文件夹名，返回 `ValidationError('mapping')` | 同上 |
| lang | string (Name)，可选 | C++ 语言 id（`cc` 或 `cc.*`）。缺省为比赛/域允许的 C++ 语言，优先 `cc.cc14` | 同上 |
| dryrun | boolean，可选 | 为 true 时只返回 inspect 结果，不创建/复用账号、不报名、不写入 record、不更新计数或比赛状态 | 同上 |
| existingUser | `"vuser"` \| `"existing"`，可选，默认 `"vuser"` | 当 **正式用户**（`user` 集合）已占用该选手文件夹名时：`vuser` 创建或复用虚拟用户；`existing` 以该正式用户 uid 报名并提交。无正式用户时两种策略都走虚拟用户复用/创建 | 同上 |
| zipMode | `"auto"` \| `"subfolder"` \| `"nosubfolder"`，可选，默认 `"auto"` | zip 目录结构：`subfolder` 要求 `选手/题目/题目.cpp`；`nosubfolder` 要求 `选手/题目.cpp`；`auto` 同时识别两种路径，同一选手同一题优先子文件夹 | 同上 |

Multipart 示例：`POST /contest/665f00000000000000000001/bulk-submit` with `file=@weekly.zip&mapping={"1001":"apple"}&lang=cc.cc14&dryrun=on&existingUser=vuser&zipMode=auto`。

管理端频率限制为 60 秒内 5 次（`contest_bulk_submit`），不套用选手个人递交频率。单份源码仍受 `limit.codelength` 限制。zip 文件条目数超过 10000、未压缩总大小超过 `limit.contest_files_size`（缺省 128MiB）、或多条文件 `normalizeZipPath` 后路径相同，在解压源码前返回 `ValidationError('file')`。zip 内非 `.cpp`、目录结构不符、空文件、超长源码、题目不允许该语言、`addJudgeRecord` 失败等按条跳过，不中止其余条目。

### Result

- dryrun: boolean
- lang: string
- users: `{ uname: string; uid: number; created: boolean; kind: "vuser" \| "user"; realUid?: number }[]`
  - `kind: "user"`：按 `existingUser=existing` 使用已有正式账号（`created` 恒为 false）
  - `kind: "vuser"`：复用或计划创建虚拟用户；`created: true` 表示将调用 / 已调用 `ensureVuser`
  - `realUid`：策略走虚拟用户、但同名正式用户也存在时附带该正式 uid，供 UI 提示
  - dryrun 且将新建 vuser 时 `uid` 为 0；commit 后 `uid` 从不为 0
  - commit 的 `users` 只包含至少有一份 ready 文件、因而实际创建/复用账号并报名的选手
- submitted: `{ uname: string; uid: number; pid: number; rid?: ObjectId }[]`  （dryrun 无 `rid`；仅包含 inspect 通过且 `record.add` 成功的条目，含幂等命中已有 rid；`record.add` 之后的 nSubmit/`updateStatus` 失败仍记为 submitted）
- skipped: `{ uname: string; problem: string; reason: string }[]`

成功示例：

```json
{
  "dryrun": false,
  "lang": "cc.cc14",
  "users": [{ "uname": "alice", "uid": -1000, "created": true, "kind": "vuser" }],
  "submitted": [{ "uname": "alice", "uid": -1000, "pid": 1001, "rid": "665f00000000000000000002" }],
  "skipped": []
}
```

试运行示例：`{ "dryrun":true,"lang":"cc.cc14","users":[{ "uname":"alice","uid":0,"created":true,"kind":"vuser" }],"submitted":[{ "uname":"alice","uid":0,"pid":1001 }],"skipped":[] }`。

同名正式用户且 `existingUser=existing`：`users` 形如 `{ "uname":"alice","uid":42,"created":false,"kind":"user" }`。同名正式用户且 `existingUser=vuser`（默认）仍走 vuser，并可带 `realUid`。

校验失败标识 `file`、`mapping`、`lang` 或 `zipMode`。未开始的比赛返回 `ContestNotLiveError`。
