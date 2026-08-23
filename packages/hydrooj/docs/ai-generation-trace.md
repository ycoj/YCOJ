# AI 测试数据生成轨迹

AI 测试数据生成任务将运行轨迹保存在记录文档的 `testCases` 数组中。每个逻辑事件占用一个 testcase；事件开始时创建，结束时更新同一个 testcase。AI 轨迹不写入 `judgeTexts`。

本文描述 schema `hydro.ai-generation.trace` 的版本 1。

## Testcase 容器

| 字段 | 含义 |
| --- | --- |
| `id` | 从 1 开始递增的事件序号，与消息 JSON 的 `seq` 相同 |
| `subtaskId` | 固定为 `0` |
| `score` | 固定为 `0`，AI 事件不参与评测得分 |
| `time` | 事件的墙钟耗时，单位为毫秒；运行中为 `0` |
| `memory` | 当前固定为 `0`，保留供未来扩展 |
| `status` | Hydro `STATUS` 数值，表示事件当前状态或结果 |
| `message` | 一行紧凑 JSON，结构见下文 |

事件开始时 `status` 为 `STATUS_JUDGING`。事件完成后，生产者通过 `id` 原位更新 `status`、`time` 和 `message`，不会追加第二个 testcase。

## 消息结构

```ts
interface AiTraceMessage {
    schema: 'hydro.ai-generation.trace';
    version: 1;
    seq: number;
    type: 'generation' | 'preparation' | 'agent_turn' | 'tool' | 'validation' | 'replacement';
    state: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
    startedAt: string;
    finishedAt?: string;
    data: Record<string, unknown>;
}
```

- `startedAt` 和 `finishedAt` 是 UTC ISO 8601 时间。
- `finishedAt` 只出现在终态事件中。
- `message` 使用 `JSON.stringify` 序列化，因此字符串中的换行会转义为 `\n`，整个消息始终只占一行。
- 消费者应先检查 `schema` 和 `version`，并忽略不认识的事件类型或字段。

## 事件类型

| `type` | `data` 中的主要字段 |
| --- | --- |
| `generation` | `model`；终态包含 `status`、`report`、`caseCount`、`totalBytes` |
| `preparation` | `model`、`sessionCreated` 或 `error` |
| `agent_turn` | `attempt`、`kind`（`initial`/`repair`）、`report` 或 `error` |
| `tool` | `toolCallId`、`tool`、`summary`、`details` 或 `error` |
| `validation` | `attempt`、`maxAttempts`、`caseCount`、`totalBytes` 或 `error` |
| `replacement` | `caseCount`、`totalBytes` 或 `error` |

工具事件只保存适合展示的摘要和结构化结果。`Read` 保存路径和行数，`Edit` 保存路径和字节数，`Shell` 保存截断后的命令、沙箱状态、退出码和资源数据。消息不会保存模型思维链、完整编辑内容、完整 stdout 或 stderr。

## 状态映射

| `state` 或结果 | `testcase.status` |
| --- | --- |
| `running` | `STATUS_JUDGING` (`20`) |
| `succeeded` | `STATUS_ACCEPTED` (`1`) |
| 校验失败 | `STATUS_FORMAT_ERROR` (`31`) |
| 普通失败 | `STATUS_SYSTEM_ERROR` (`8`) |
| `cancelled` | `STATUS_CANCELED` (`9`) |
| `timed_out` | `STATUS_TIME_LIMIT_EXCEEDED` (`3`) |

## 示例

工具执行中：

```json
{"schema":"hydro.ai-generation.trace","version":1,"seq":3,"type":"tool","state":"running","startedAt":"2026-08-16T12:00:00.000Z","data":{"tool":"Shell","toolCallId":"call_123","summary":"python3 generator.py"}}
```

同一个 testcase 完成后，`status` 更新为 `1`、`time` 更新为实际耗时，消息更新为：

```json
{"schema":"hydro.ai-generation.trace","version":1,"seq":3,"type":"tool","state":"succeeded","startedAt":"2026-08-16T12:00:00.000Z","finishedAt":"2026-08-16T12:00:00.042Z","data":{"tool":"Shell","toolCallId":"call_123","summary":"python3 generator.py","details":{"commandLength":21,"status":"Accepted","exitStatus":0,"time":12000000,"memory":8388608,"runTime":15000000}}}
```

## 兼容性

- 只有新的 AI 生成记录使用此格式；历史记录中的纯文本 `judgeTexts` 不迁移。
- 普通提交的 testcase 和 `judgeTexts` 契约不变。消费者只应对 AI 生成记录解析此 schema。
- 同一主版本内允许增加可选字段。消费者必须容忍未知字段，并对无法解析的 `message` 回退为普通文本展示。
