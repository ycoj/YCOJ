# Contest Bulk Submit `GET/POST /contest/:tid/bulk-submit`

默认 Header: `Accept: application/json`。GET 浏览器协商渲染 HTML；POST 为 `multipart/form-data` 上传，JSON 协商返回操作结果。

Contest managers upload a zip of offline contestants' C++ sources. Each first-level folder is a contestant; each nested folder is a problem name containing a matching `.cpp` file:

```
alice/apple/apple.cpp
bob/gcd/gcd.cpp
```

A shared wrapper directory is stripped. Only `.cpp` files are accepted. When dryrun=false, for each contestant the server creates or reuses a virtual user (`ensureVuser`, uid ≤ -1000), attends the contest, inserts a record, and enqueues the judge task. When dryrun=true, the response reports planned actions without mutating contest state. Allowed once the contest has started, including after it ends. Not-started contests are rejected with `ContestNotLiveError`.

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
- mappingDefaults: Record\<number, string\>  （pid → 预填 zip 文件夹名，题目 pid 或字母序号 A/B/C）

HTML `contest_bulk_submit.html`。JSON 示例：`{ "tdoc":{"docId":"665f00000000000000000001"},"langRange":{"cc.cc14":"C++14"},"defaultLang":"cc.cc14","mappingDefaults":{"1001":"A"} }`。

## POST `/contest/:tid/bulk-submit`

无 `operation` 字段；该路由的默认 POST 即为批量提交。

### Params

| 参数 | 类型 | 用途 | 权限 |
| --- | --- | --- | --- |
| tid | string (ObjectId) | 比赛 ID | 比赛 owner/maintainer，或 `PERM_EDIT_CONTEST` |
| file | Blob (zip) | 选手源码 zip | 同上 |
| mapping | string (JSON) 或 object | 网站题目 id 到 zip 内题目文件夹名，例如 `{"1001":"apple","1002":"gcd"}`。未映射的 pid 跳过；映射到非本场题目的 pid、或 trim 后大小写不敏感重复的文件夹名，返回 `ValidationError('mapping')` | 同上 |
| lang | string (Name)，可选 | C++ 语言 id（`cc` 或 `cc.*`）。缺省为比赛/域允许的 C++ 语言，优先 `cc.cc14` | 同上 |
| dryrun | boolean，可选 | 为 true 时只解析 zip 并报告将要提交的内容，不创建 vuser、不报名、不入队 | 同上 |

Multipart 示例：`POST /contest/665f00000000000000000001/bulk-submit` with `file=@weekly.zip&mapping={"1001":"apple"}&lang=cc.cc14&dryrun=on`。

管理端频率限制为 60 秒内 5 次（`contest_bulk_submit`），不套用选手个人递交频率。单份源码仍受 `limit.codelength` 限制。zip 文件条目数超过 10000 或未压缩总大小超过 `limit.contest_files_size`（缺省 128MiB）时，在解压源码前返回 `ValidationError('file')`。zip 内非 `.cpp`、目录结构不符、空文件、超长源码、题目不允许该语言等按条跳过，不中止其余条目。

### Result

- dryrun: boolean
- lang: string
- users: `{ uname: string; uid: number; created: boolean }[]`  （dryrun 且尚未存在的 vuser 的 `uid` 为 0）
- submitted: `{ uname: string; uid: number; pid: number; rid?: ObjectId }[]`  （dryrun 无 `rid`）
- skipped: `{ uname: string; problem: string; reason: string }[]`

成功示例：

```json
{
  "dryrun": false,
  "lang": "cc.cc14",
  "users": [{ "uname": "alice", "uid": -1000, "created": true }],
  "submitted": [{ "uname": "alice", "uid": -1000, "pid": 1001, "rid": "665f00000000000000000002" }],
  "skipped": []
}
```

试运行示例：`{ "dryrun":true,"lang":"cc.cc14","users":[{ "uname":"alice","uid":0,"created":true }],"submitted":[{ "uname":"alice","uid":0,"pid":1001 }],"skipped":[] }`。

校验失败标识 `file`、`mapping` 或 `lang`。未开始的比赛返回 `ContestNotLiveError`。
