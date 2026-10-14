# 执行链模型调用用量

`GET /api/runs/<runId>/usage/chain` 从指定运行查找本工作区的祖先，再读取同一根下的运行。查询子运行也包含可确认的父运行、兄弟和后代；失败、取消及重复协作尝试均保留，每个运行只计一次。它是已登记模型调用的只读汇总，不是供应商货币账单。

## 请求与范围

仅用于已有访问保护或受控部署。无正文或查询参数，UUID 大小写归一化；跨站请求返回 403，无效标识或任何查询参数返回 400，不存在或不属于当前演示工作区返回 404。异常、坏记录或累计安全整数溢出返回安全 503、`retryable: true` 和 `Retry-After: 2`。所有响应 `Cache-Control: no-store`。

共享结构与类型唯一来源为 `src/contracts/model-usage-chain.ts`，逐运行摘要复用 `RunModelUsage`。不返回业务输入、结果、来源键、密钥、供应商原始错误或引擎句柄，也不修改运行、调用、审批、工具或投递。

最多纳入 200 个运行，锚点深度为 0，最多纳入深度 8；数量与深度边界探测到未纳入后代时标记 `truncated`。先保留请求运行及已确认祖先路径，宽分支截断不会丢掉原请求。界限不可经参数放宽。只汇总实际纳入的记录，未纳入部分始终未知。

## 关系与覆盖

新协作运行在既有创建事务保存 `parent_run_id`，父任务和子任务归属不变，原来源键继续用于重试防重；新的 queued → running 初始化同时声明 `collaboration_tracking_version: v1`。已开始的旧任务恢复不回填覆盖。

历史子运行只兼容读取 `agent-call:<父 UUID>:` 和 `handoff:<父 UUID>:` 来源键，前缀须与来源类型一致；历史关联标记 `legacy`，不能升级成可信完整图。显式父引用与来源不一致、无效来源或未知状态均阻止完整性声明。历史兼容索引只取文本，不把坏来源键强转成 UUID。

父引用故意不使用删除级联或外键补偿，保留缺失祖先的审计证据；创建时在原父锁事务派生归属，读取时每层限定工作区。祖先缺失或属于其他工作区时返回本地最高锚点，`rootRunId: null`、`missingParent: true`，不暴露外工作区标识。环和深度超限同样保留本地锚点，不把它伪称真正根。

`anchorRunId` 始终指向已纳入深度 0 的本地运行；仅已确认根时 `rootRunId` 才等于锚点。公开 `parentRunId` 仅引用本次纳入的运行，锚点父引用隐藏。列表按深度、运行标识排序。

## 三种完整性不能混用

- `graph.complete`：确认根，无缺失、环或截断，全部纳入运行都有新关系覆盖、合法来源和已知状态。历史模型跟踪不改变图覆盖，但会降低用量覆盖。
- `execution.isFinalSnapshot`：图完整且没有活跃运行；成功、失败、取消均为结束，不代表业务成功。未知状态单独计数，不算已结束。
- `usage.recordedUsageComplete`：图完整，全部运行都有 v1 模型跟踪，当前已登记调用均有完整有效用量。活跃运行仍可能新增调用；未确认和失败调用不因任务结束变成零。

`calls` 及 `usage` 是各纳入摘要的精确和，数值用安全整数校验。输入、输出已知小计独立求和，无样本为 null，明确报告零仍为 0；不能把不同调用的已知两侧拼成一次完整调用总量。缓存和推理细分不会再次加入总量。口径和调用不确定性沿用 [单运行用量约定](./run-model-usage-http-contract.md)。

下面是一个仍有子任务执行的完整关系图快照：当前登记用量完整，但尚非结束快照。

```json
{
  "ok": true,
  "summary": {
    "requestedRunId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "anchorRunId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "rootRunId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "assessedAt": "2026-10-09T12:00:00.000Z",
    "limits": { "maxRuns": 200, "maxDepth": 8 },
    "graph": {
      "missingParent": false, "cycleDetected": false, "truncated": false,
      "includedRuns": 2, "rootKnown": true,
      "legacyRelationRuns": 0, "invalidRelationRuns": 0,
      "untrackedRelationRuns": 0, "untrackedModelRuns": 0,
      "unknownStatusRuns": 0, "complete": true
    },
    "execution": { "liveRuns": 1, "finishedRuns": 1, "isFinalSnapshot": false },
    "calls": { "total": 2, "pending": 0, "returned": 2, "failed": 0 },
    "usage": {
      "completeCalls": 2, "incompleteCalls": 0, "invalidUsageCalls": 0,
      "inputCalls": 2, "outputCalls": 2,
      "knownInputTokens": 24, "knownOutputTokens": 12,
      "knownCallTotalTokens": 36, "recordedUsageComplete": true
    },
    "runs": [
      {
        "parentRunId": null, "depth": 0, "status": "completed",
        "relation": "root", "relationTracking": "tracked-v1",
        "summary": {
          "runId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "tracking": "tracked-v1", "assessedAt": "2026-10-09T12:00:00.000Z",
          "calls": { "total": 1, "pending": 0, "returned": 1, "failed": 0 },
          "usage": {
            "completeCalls": 1, "incompleteCalls": 0, "invalidUsageCalls": 0,
            "inputCalls": 1, "outputCalls": 1,
            "knownInputTokens": 12, "knownOutputTokens": 6,
            "knownCallTotalTokens": 18, "recordedUsageComplete": true
          }
        }
      },
      {
        "parentRunId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "depth": 1, "status": "running", "relation": "explicit",
        "relationTracking": "tracked-v1",
        "summary": {
          "runId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "tracking": "tracked-v1", "assessedAt": "2026-10-09T12:00:00.000Z",
          "calls": { "total": 1, "pending": 0, "returned": 1, "failed": 0 },
          "usage": {
            "completeCalls": 1, "incompleteCalls": 0, "invalidUsageCalls": 0,
            "inputCalls": 1, "outputCalls": 1,
            "knownInputTokens": 12, "knownOutputTokens": 6,
            "knownCallTotalTokens": 18, "recordedUsageComplete": true
          }
        }
      }
    ]
  }
}
```

## 一致快照与部署

在可重复读只读事务内查询元数据和模型账本，不在网络 I/O 期间持有事务。祖先最多 9 次、后代最多 9 次有界查询，再一次批量汇总；每轮后代最多读取 201 行，不扫描运行结果或最新步骤回执。`assessedAt` 是请求检查时刻，不支持历史时刻查询。结构错误不默默丢记录。

先应用 drizzle-kit 追加迁移 `0032_runtime-model-usage-chain.sql`，新增两列和显式/历史父查询索引；无历史回填，旧迁移不改写。健康检查同步核对索引与可空、无默认覆盖列。父列保留历史未知，不给旧记录虚造完整性。

本地仅执行类型、lint、单测和构建。实际数据库验收覆盖整链、终态未知、历史、跨工作区、环、深宽边界和溢出；实际持久 Workflow 验收调用和交接的父关系、最终成果及逐次用量，交由隔离 Neon CI 执行。生产迁移、受保护部署实际访问和真实供应商计费仍需人工确认。

不包含设计或连接测试用量，不估算货币账单；并发配额、预算强制控制、监控页面和自动告警仍待实现。本接口不会取消、重跑或补记任何业务。
