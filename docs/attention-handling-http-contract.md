# 待处理跟踪 HTTP 约定

此能力只给已有受保护部署的操作员保存接手、备注和处理历史。登录权限仍后置；同源检查不是调用方身份认证，不要为调用接口关闭部署访问保护。共享结构唯一来源为 `src/contracts/attention-handling.ts` 和 `src/contracts/attention-reference.ts`，类型由 Zod 推导。

处理记录与任务、审批、等待、业务操作、成果投递的状态分离。`recorded: true` 只说明跟踪记录已保存，不说明任务执行成功、外部写入已撤销或接收方已经收到成果。本能力不恢复 Hook、不重新运行任务、不调用业务工具、不补投，也不发送通知。

## 定位本次事项

`GET /api/attention` 增加 `occurrence` 和 `handling`。`occurrence` 是来源的本次状态标记，必须从最新返回中原样复制，与 `kind/id/runId` 一起构成 `reference`；不能自行推算、截断或复用到另一个任务。

`handling` 只包含 `caseId`、`status`、`revision`、`entryCount`、`updatedAt`、`closedAt`。没有处理记录时为 `caseId: null`、`status: "open"`、版本与条数均为 0，时间均为 null。旧客户端可忽略这两个新增字段；发起处理必须取得完整 reference。列表不带处理正文、历史、请求指纹或工作流秘密。

可用 `handlingState=open|in-progress|closed` 在分页前筛选。默认不排除 closed：明确接受失败后，原任务仍为 failed，不能以隐藏失败记录伪报成功。旧事项离开当前清单后，仍可从独立处理历史取得其 reference 并完成跟踪收尾。

同一任务的新等待、审批决定转入恢复事项、工具重新核对或补投后再次失败，使用独立的本次标记。工具标记还包含核对次数，投递标记包含尝试与补投次数，不只依赖可能相同的更新时间。旧记录关闭不会让新事项继承已关闭或已接手状态。标记不是 Hook token，也不能用来恢复工作流。

## 保存处理记录

`POST /api/attention/cases`，必须带与请求地址一致的 `Origin` 和 `Content-Type: application/json`；`Sec-Fetch-Site: cross-site` 拒绝。服务端调用也须另外满足现有部署保护。

```json
{
  "reference": {
    "kind": "run-failed",
    "id": "00000000-0000-4000-8000-000000000001",
    "runId": "00000000-0000-4000-8000-000000000001",
    "occurrence": "2026-10-09T00:00:00.000123Z:2026-10-09T00:00:05.000123Z"
  },
  "action": "acknowledge",
  "requestId": "00000000-0000-4000-8000-000000000002",
  "expectedRevision": 0,
  "reason": "正在核对订单系统的实际结果"
}
```

示例标识与 occurrence 须替换为最新清单的实际值。requestId 在首次发送前生成并保存；UUID 按小写归一化。expectedRevision 使用最新摘要或详情的 revision，无记录时为 0。原因去首尾空白后必须为 1 至 1000 个字符，凭据在存储与请求指纹计算前隐藏；处理正文的实际 UTF-8 总容量最大 8KB。未知字段、无版本、无原因和缺少确认会拒绝。

| action | 条件与效果 |
|---|---|
| acknowledge | 原本次事项仍活跃，且跟踪未关闭；状态改为 in-progress |
| note | 追加原因；不改变状态，允许对已结束或已关闭的旧记录备注 |
| close-resolved | 必须 `confirmedReviewed: true`；原本次事项已离开清单或变成新一轮事项，只关闭旧跟踪 |
| accept-failure | 仅活跃 run-failed；必须 `confirmedReviewed: true` 与 `confirmedNoRetry: true`，核对副作用并决定不再重试后关闭跟踪，原任务仍失败 |
| reopen | 原本次事项仍活跃且跟踪已关闭；明确改为 in-progress，不重跑业务 |

活跃审批、等待、待核对业务操作与失败投递不能用 close-resolved 或 accept-failure 跳过原入口处理。离开清单也不等于完成：原工具若仍在重试或没有合法完成回执，原投递若未 delivered、没有接收时间或回执不匹配，仍拒绝关闭。若来源已经变为新一轮事项，关闭只收尾旧跟踪，新事项独立保留。

接受失败时，来源任务直接关联的 pending/blocked 业务防重操作会阻止关闭，必须先核对原回执。此检查不宣称覆盖所有协作子运行或所有外部副作用；操作员仍须根据完整执行链核对业务事实。接受失败不等于补偿或业务成功。

成功返回 200：

```json
{
  "ok": true,
  "recorded": true,
  "item": {
    "id": "00000000-0000-4000-8000-000000000003",
    "reference": {
      "kind": "run-failed",
      "id": "00000000-0000-4000-8000-000000000001",
      "runId": "00000000-0000-4000-8000-000000000001",
      "occurrence": "2026-10-09T00:00:00.000123Z:2026-10-09T00:00:05.000123Z"
    },
    "title": "任务执行失败",
    "status": "in-progress",
    "revision": 1,
    "createdAt": "2026-10-09T00:00:10.000Z",
    "updatedAt": "2026-10-09T00:00:10.000Z",
    "closedAt": null,
    "sourceState": "active",
    "entries": [{
      "requestId": "00000000-0000-4000-8000-000000000002",
      "action": "acknowledge",
      "reason": "正在核对订单系统的实际结果",
      "createdBy": "00000000-0000-4000-8000-000000000004",
      "createdAt": "2026-10-09T00:00:10.000Z"
    }]
  }
}
```

实际 item 按 AttentionCaseView 返回完整合法结构，至少有一条公开历史，包括脱敏标题、创建与更新时间、关闭时间、sourceState 及处理历史。sourceState 为 active（仍是本次事项）、changed（同一来源已变为新一轮）、inactive（当前清单没有此来源）；它不是业务成功状态。每条公开历史只有 requestId、action、reason、createdBy、createdAt，不返回私有 requestHash。每次成功追加使 revision 与历史条数同时加一，历史最多 100 条，不截断或覆盖旧记录，达到上限后明确拒绝追加。

请求防重限定于工作区、来源、本次标记的同一处理记录。同一 requestId、等价脱敏内容、原 expectedRevision 重试，找回已有记录，不再追加历史；返回详情可以包含其他请求后来追加的记录。改变原因、动作、确认或版本会冲突。并发不同请求只有匹配当前版本的一方追加；另一方须刷新后人工重新核对，不能自动覆盖。新一轮事项是另一条记录，调用方应生成新的 requestId，不能把重复请求当作跨事项的业务防重。

事务失败或响应结果未知返回 503、retryable: true、Retry-After: 2。必须保留原请求标识、reference、动作、原因、确认和版本重试，不因响应丢失发起第二次处理。确定性业务或版本冲突返回 409。非法结构、JSON、UTF-8 为 400，跨站为 403，正文超限为 413，正文类型错误为 415。失败的首次处理不留下空记录。

## 历史与详情

`GET /api/attention/cases` 提供稳定的独立处理历史，参数为 status、kind、runId、limit、before、beforeId。status 表示跟踪状态，不是任务状态；筛选先于分页，默认 20 条，最大 50 条。未知、重复参数与不完整游标返回 400。

每项只返回 id、reference、脱敏标题、status、revision、entryCount 及创建、更新、关闭时间。不批量选择处理正文，也不读取原业务输入或回执。按创建时间与标识倒序；nextCursor 为末项的 createdAt/id 或 null，两个字段原样传入下一页 before/beforeId，不能经过 Date 转换丢失数据库微秒。追加历史不改变记录创建时间，因此不会因更新时间变化挤入旧页。

`GET /api/attention/cases/<caseId>` 返回 `{ "ok": true, "item": ... }`，按当前工作区查询并重新核对原来源状态，公开历史再次脱敏。不存在、归档或另一工作区记录统一为 404；非法标识和任何查询参数为 400。

所有读写限定当前演示工作区，不接受客户端工作区、创建人、引擎句柄或业务状态。跨站读取拒绝；存储记录无效、历史与版本不一致或未知读取失败返回安全的 503，不返回部分成功。所有响应为 Cache-Control: no-store。

## 上线边界

新增表和索引只通过 drizzle-kit 追加 `0029_attention-handling-records.sql`；已有迁移不修改。生产先应用完整迁移，再放行对应部署。隔离数据库测试覆盖并发、防重、工作区、微秒历史分页及真实 HTTP；实际 SDK 测试覆盖循环等待换代、旧记录关闭与新 Hook 保留。

本批不修改前端处理台或视觉组件，不发送提醒，不自动关闭事故，不提供外部公开接入；前端仍须按共享契约对接。真实业务核对、生产迁移和受保护环境实际访问按人工配置清单确认。
