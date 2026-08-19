# Record Main `GET /record`

默认 Header: `Accept: application/json`，请求与返回均为 JSON。

## Params

| 参数       | 类型                         | 用途                                          | 权限                                                                            |
| ---------- | ---------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| page       | number (PositiveInt)         | 分页页码，默认 1                              | 无                                                                              |
| pid        | number \| string (ProblemId) | 题目筛选；在比赛中可用 `A`-`Z` 表示题目序号   | 无                                                                              |
| tid        | string (ObjectId)            | 比赛/作业 ID                                  | 需要满足比赛可见记录与榜单条件，否则需要 `PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD`  |
| uidOrName  | number \| string (UidOrName) | 用户筛选（uid / 用户名 / 邮箱）               | 若不是本人，需 `PERM_VIEW_RECORD`                                               |
| lang       | string                       | 语言筛选                                      | 无                                                                              |
| status     | number (Int)                 | 评测状态筛选                                  | 无                                                                              |
| fullStatus | boolean                      | 仅返回本人记录的完整字段，且每页数量固定为 10 | 无                                                                              |
| all        | boolean                      | 取消比赛/作业限制，查看所有记录               | `PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD` 且 `PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD` |
| allDomain  | boolean                      | 跨域查看最近 10 周记录                        | `PRIV_MANAGE_ALL_DOMAIN`                                                        |
| stat       | boolean                      | 返回评测统计                                  | `PRIV_VIEW_JUDGE_STATISTICS`                                                    |

## Result

- page: number
- rdocs: RecordDoc[]
- tdoc: Tdoc \| null
- pdict: ProblemDict
- udict: Udict
- all: boolean
- allDomain: boolean
- filterPid: number \| string \| undefined
- filterTid: string (ObjectId) \| undefined
- filterUidOrName: number \| string \| undefined
- filterLang: string \| undefined
- filterStatus: number \| undefined
- notification: { name: string; args: { type: string } }[]
- statistics?: { d5min: number; d1h: number; day: number; week: number; month: number; year: number; total: number }

RecordDoc（`fullStatus=false` 时仅包含以下字段）:
| 字段 | 类型 | 含义 |
| --- | --- | --- |
| \_id | ObjectId | 记录 ID |
| score | number | 得分 |
| time | number | 用时 |
| memory | number | 内存 |
| lang | string | 语言 |
| uid | number | 提交用户 ID |
| pid | number | 题目 ID |
| rejudged | boolean | 是否为重测 |
| progress | number \| undefined | 评测进度 |
| domainId | string | 域 ID |
| contest | ObjectId \| undefined | 比赛/作业 ID |
| judger | number | 判题机用户 ID |
| judgeAt | Date | 评测时间 |
| status | number | 评测状态 |
| source | string \| undefined | 记录来源 |
| files | Record<string, string> \| undefined | 关联文件映射 |
| hackTarget | ObjectId \| undefined | Hack 目标记录 |
