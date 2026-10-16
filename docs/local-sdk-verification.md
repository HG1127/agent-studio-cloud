# 独立本机 Workflow SDK 验证

入口为 `vitest.workflow-local.config.mts`，只运行 `tests/workflow-local/default-result-stream-sdk.test.ts`。这是 SDK 5 的本机兼容性检查，不是业务数据库验收，也不能代替完整 CI。

## 检查范围

- 使用真实 Local World 和独立步骤，调用生产成果流适配器；不复制其业务实现。
- 核对空默认流、成果写入与关闭、Hook 暂停与显式恢复，以及关闭后拒绝重发。
- 在真实流存储边界注入回执丢失、首次元数据查询失败，核对不自动重发、不产生未允许的发送。
- 只处理本测试持有的执行句柄；取消后重新读取公开状态，确认实际终态。

故障注入是测试行为；没有模拟整个 Workflow SDK。通过这些场景也不代表业务流程、数据库持久化、供应商或浏览器操作已验证。

## 隔离条件

由验证负责人在同提交、依赖已锁定且物理安装完整的独立工作树执行。子进程环境采用白名单，不继承数据库连接、令牌、远端 World 配置、Node 预加载或私有环境文件；不读取或修改现有预览。

初始化前要求以下配置：

| 变量 | 值 |
| --- | --- |
| `MVP_LOCAL_SDK_ONLY` | `1` |
| `MVP_LOCAL_SDK_ATTEMPT_ID` | 本次全新、32 位小写十六进制标识 |
| `WORKFLOW_TARGET` | `local` |
| `WORKFLOW_TARGET_WORLD` | `local` |
| `WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS` | `0` |
| `WORKFLOW_LOCAL_QUEUE_CONCURRENCY` | `1` |
| `WORKFLOW_LOCAL_QUEUE_MAX_VISIBILITY` | `5` |

`MVP_ACCEPTANCE_ISOLATED_DB` 必须不存在，原 `tests/workflow/` 数据库套件及其隔离门槛保持不变。新标记本身不是隔离证明。

插件仅扫描 `tests/workflow-local/fixtures/` 中唯一的测试文件，测试再核对 manifest 恰好含两个测试流程。构建、缓存和运行数据分别保存在 `.vitest/workflow-local/<本次标识>/` 下，不复用 `.workflow-data`、`.workflow-vitest` 或 `.next`。已有本次目录拒绝复用；失败后保留证据，不自动清理重跑。

## 结果认定

使用受控 runner 执行 `vitest run --config vitest.workflow-local.config.mts`，先按进程、构建器和单测试 worker 的预算检查物理内存与提交余量。保持单 worker、零重试，记录同提交、完整命令、双输出流、测试 JSON、manifest 和本次目录归属。

四个用例全部实际执行且通过，并确认自有执行终态、测试进程自然退出和输出完整，才能记为该项通过。资源不足、未启动、跳过、失败或退出状态未知均不能记为通过。不得借用旧提交结果，不得据此推送、合并、部署或宣称完整项目验收通过。
