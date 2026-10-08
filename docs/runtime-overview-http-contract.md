# 运行统计 HTTP 约定

`GET /api/runtime/overview` 提供现有受保护部署内的只读运行统计，不是开放公网入口。前后端共享结构唯一来源为 `src/contracts/runtime-overview.ts`，类型由 Zod 推导；本接口不启动、取消、恢复或修改任何任务。不要为接入关闭部署访问保护。

## 查询

仅接受 `window`、`agentId`、`sourceType` 三个可选参数，未知或重复参数返回 `400`，不能指定其他工作区或任意时间。助手标识按 UUID 小写归一化，不存在的助手返回空统计，不猜测其他助手数据。

| 参数 | 值与含义 |
|---|---|
| `window` | `1h`、`24h`、`7d`、`30d`，默认 `24h`；连续滚动窗口，不是自然日或本地日历 |
| `agentId` | 可选助手 UUID，过滤任务自身所属助手，包括已归档助手的历史记录 |
| `sourceType` | `manual`、`schedule`、`agent_call`、`handoff`、`evaluation`，沿用既有运行来源 |

```text
GET /api/runtime/overview?window=7d&sourceType=schedule
GET /api/runtime/overview?window=1h&agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
```

工作区、助手和来源筛选先于聚合执行，一条参数化数据库语句读取同一快照，不读任务输入、结果、上下文、错误正文、业务回执或引擎凭据。来源筛选不会包含其他来源的子运行。

## 三组独立口径

- `active` 是该语句读取到的当前排队、运行、等待审批和等待节点积压，不受任务接收窗口限制。`waitingEvent` 沿用运行状态，包含定时与外部消息等待，不能全部标成“等待外部消息”。这不是历史时点的积压重建。
- `received` 按 `created_at` 接收时间纳入 `[bounds.from, bounds.until)`，按五种来源分别计数；历史未知来源计入 `bySource.unknown`，未知状态计入 `unknownStatus`，不偷偷改为手动或成功。
- `finished` 仅将成功、失败、取消且 `finished_at` 落在同一左闭右开窗口的任务纳入。结束时间缺失、超出窗口或状态未知时不猜测其结束时刻，也不以创建时间替代。

`assessedAt` 等于本次滚动窗口截止时间 `bounds.until`，由服务端确定；当前状态仍取数据库语句快照。时间输出为 UTC，排队接收时间保留数据库微秒，计数超出 JavaScript 安全整数范围时拒绝响应，不丢精度或截断。

每个协作子运行、交接运行和验收运行都是独立执行，不去重合并成一个业务请求。同一任务可以在接收和结束两组中出现，也可以仅在其中一组出现，不能用 `received.total` 作为失败率分母。

## 比例、耗时与未知值

- 失败率为 `failed / (completed + failed) × 100`，四舍五入至两位小数；取消不参与分母。无成功或失败结束样本时为 `null`，不是零失败。
- 运行经历时间为 `finished_at - started_at`，包括人工审批和等待，不等于模型耗时或纯计算耗时。仅开始时间不早于接收、结束不早于开始且接收时间有效的结束样本参与平均与连续插值第 95 百分位计算，单位毫秒。
- 缺失或倒置时间计入 `unknownDurationCount`；有效与未知耗时样本数之和等于 `finished.total`。没有有效样本时平均和第 95 百分位均为 `null`。
- `oldestQueuedReceivedAt` 与 `oldestQueuedReceivedAgeSeconds` 是有效排队记录的最早接收时间及截至窗口末尾的整秒年龄，不是“进入排队状态”的真实时长。年龄计算保留微秒，未来或无效排队接收时间计入 `queuedTimeUnknown`，无有效记录时两个值均为 `null`。
- `activeWithEndTime` 提示活跃状态却已有结束时间的记录，不据此修正状态、伪报完成或自动取消。

前端应将未知比例、耗时和年龄显示为“暂无可用数据”或“时间未知”，不能转换为 `0`。本轮只提供后端接口，尚无专用监控页面或自动告警。

## 响应示例

以下为空统计的完整有效响应：

```json
{
  "ok": true,
  "summary": {
    "assessedAt": "2026-10-09T12:00:00.000Z",
    "bounds": { "from": "2026-10-08T12:00:00.000Z", "until": "2026-10-09T12:00:00.000Z" },
    "filters": { "window": "24h", "agentId": null, "sourceType": null },
    "active": {
      "queued": 0, "running": 0, "waitingApproval": 0, "waitingEvent": 0, "total": 0,
      "oldestQueuedReceivedAt": null, "oldestQueuedReceivedAgeSeconds": null,
      "queuedTimeUnknown": 0, "activeWithEndTime": 0
    },
    "received": {
      "total": 0, "unknownStatus": 0,
      "bySource": { "manual": 0, "schedule": 0, "agentCall": 0, "handoff": 0, "evaluation": 0, "unknown": 0 }
    },
    "finished": {
      "completed": 0, "failed": 0, "cancelled": 0, "total": 0, "failureRatePercent": null,
      "knownDurationCount": 0, "unknownDurationCount": 0, "meanDurationMs": null, "p95DurationMs": null
    }
  }
}
```

全部响应带 `Cache-Control: no-store`；跨站读取返回 `403`。数据库或契约校验失败返回安全的 `503`、`retryable: true` 和 `Retry-After: 2`，不泄露原始错误，也不返回虚假的空统计。请求方应有界退避，不紧密轮询。

## 验收与上线

新增 `0030_runtime-overview-indexes.sql` 仅追加两个运行结束时间索引，健康检查同步要求这些索引；未修改历史迁移，无新环境变量或依赖。生产须先应用完整迁移，再验收受保护部署；隔离数据库与实际 SDK 用例由 CI 执行，不在共享库跑写入测试。

本接口不返回 token 或费用，不将会被循环/重试更新的最新节点回执当成完整调用账本；并发配额、预算限制、完整用量记录和自动告警仍是后续能力。
