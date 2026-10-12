# Harness 资源管理前端交接（2026-10-09）

## 精确基准与修改范围

- 实际工作区：`D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-harness-d59`。
- 分支：`codex/frontend-harness-d59`；精确 HEAD：`d59bf84ec5902f07441e321537bd39345e4a30b1`。
- Git 交接清单 `frontend-harness-d59-handoff.json` 的 366 项文件指纹全部核验一致，再按原 Harness 9 文件增量、轨迹兼容 4 文件增量的顺序应用；两份冻结补丁与清单未改动。
- 本轮资源增量基准是上述两份增量实际应用后的工作区，`resource-phase-baseline.json` 记录 1152 项基准文件指纹。不能把当前整个未提交工作区作为本轮增量，也不能直接把本轮补丁应用到裸 d59。
- 原工作区 `C:\Users\Administrator\.codex\worktrees\3227\agent-studio-cloud` 保持冻结；本轮只修改本域前端、测试和此交接文档。索引为空，没有暂存、提交、推送、合并或部署。
- 本目录独立执行 `pnpm install --frozen-lockfile --ignore-scripts`，使用 Next.js 16.3.8、Vitest 5.0.1；未共享旧依赖，也未修改依赖清单或锁文件。

本轮精确增量是两项修改、四项新增：

| 文件 | 变化 |
|---|---|
| `src/app/(console)/harness/page.tsx` | 并行读取资源摘要与最近历史，独立处理各项读取失败，组合资源面板 |
| `tests/component/harness-page.test.tsx` | 增加资源摘要、历史和无效响应互不掩盖的页面组合回归 |
| `src/features/harness/ExecutionResourcesPanel.tsx` | 真实摘要、历史游标、明确确认的限额编辑与保存结果核对 |
| `src/features/harness/execution-resource-client.ts` | 调用真实资源路由，校验共享契约、请求范围与保存回执 |
| `tests/component/harness-execution-resources.test.tsx` | 使用真实路由和模拟查询、动作的组件/API 组合测试 |
| `docs/frontend-parallel/harness-resources.md` | 本轮边界和交接证据 |

未修改共享契约、服务端动作/查询/路由、数据库或迁移、其他功能域、壳层、公共 UI、全局样式及配置。其既存未提交变化来自交接基准。

## 实际接口与展示语义

唯一跨端结构来自 `src/contracts/execution-resources.ts` 的 Zod schema 与推导类型。已读取 d59 的真实源码：`getExecutionResourcePolicy`、`listExecutionPolicyHistory`，以及实际位于 `src/server/actions/record-execution-policy.ts` 的 `recordExecutionPolicyAction`。

服务端页面通过真实查询初始化；客户端重新核对使用 `GET /api/execution/resources` 和 `GET /api/execution/resources/history?limit=20&beforeRevision=…`。保存使用 `POST /api/execution/resources`，该真实路由调用现有唯一写动作。前端不查询数据库、不复制后端业务实现。

摘要展示服务端实际返回的来源、设置版本、三个上限、保留名额、其中未完整关联的活跃任务、可用名额和读取时间。只有读取成功且来源为 default 时才显示服务端默认值；读取失败撤下旧读数，显示未知，禁用新设置提交。摘要、历史与原有运行证据的失败分别处理，不以读取失败冒充空记录。

当前设置不能追溯证明过去某次运行的上限；模型与协作限制仍按任务冻结的记录核对。资源限额不冒充默认运行规则、安全授权、策略模拟或费用预算。这些缺失能力继续保持原页面的真实说明。

历史最多二十条，使用服务端返回的版本游标读取更早一页；失败重试沿用当前游标，返回较新页恢复原范围。响应超出所请求游标或条数时拒绝展示。原因使用服务端返回的脱敏文本，不暴露内部编号。

## 保存、冲突和不确定结果

三个上限、原因和明确确认全部通过共享契约后，生成一次请求编号，并冻结编号、原版本、三个上限、修剪后的原因和确认值。同步写锁阻止重复提交。保存结果不确定时保留整份原请求，重试只复用相同编号与相同内容；重新读取和组件重新渲染不重新生成请求。

版本冲突不会自动采用新版本重写请求。先只读核对当前摘要与最近历史，再通过“重新确认新的设置”明确开启新请求；该操作重新读取当前已知设置作为草稿，清空原因和确认。最近一页未发现请求不能证明它未保存，界面明确可能存在更早记录；其他历史页也标识与当前保留原请求匹配的记录。

成功回执分别显示 recordedRevision 和服务端返回的当前 policy.revision。若原请求已记录在旧版本、当前已有后续版本，界面明确旧内容没有重新设为当前值，实际摘要仍通过独立读取核对。异常回执或响应丢失作为结果不确定处理，不声称已保存。

原请求只保留在当前页面内存。整页刷新或离开后丢失原内容时，不提供或声称原请求恢复；新保存仍需要重新填写原因并明确确认。未使用浏览器持久存储伪造服务端记录。

## 已完成的定向验证

所有检查使用 `NODE_OPTIONS=--max-old-space-size=1024`，Vitest 使用单 worker 和 `--no-cache`。

- 七个 Harness 测试文件共 126 个用例通过：既有 103 个，加三个页面组合用例、二十个资源组件/API 组合用例。
- 资源测试直接调用真实 GET/POST/历史 Route Handlers，但查询和写动作均模拟；fetch 也由测试本地路由桥接。没有数据库、生产设置写入、真实网络或外部工具调用。
- 覆盖默认值只在真实读成功后展示、独立失败、三项限额范围与确认、确切提交内容、历史游标及失败重读、版本冲突、不确定响应、同请求同内容重试、只读核对、旧记录与当前版本区分、重复提交锁、重新渲染保留原请求，以及卸载后不伪恢复。
- 五个本轮源码/测试文件的定向 ESLint 通过。
- TypeScript createProgram 使用项目配置、strict/noEmit，五个源码/测试入口加 `tests/setup.ts`（六入口及其依赖图），诊断为零。

定向命令：

```text
node node_modules/vitest/vitest.mjs run tests/component/harness-execution-resources.test.tsx tests/component/harness-page.test.tsx tests/component/harness-diagnostics.test.tsx tests/component/harness-next-step.test.tsx tests/component/harness-navigation.test.ts tests/component/harness-filter-navigation.test.ts tests/component/harness-trace-projection.test.tsx --maxWorkers=1 --configLoader runner --no-cache
node node_modules/eslint/bin/eslint.js "src/app/(console)/harness/page.tsx" src/features/harness/ExecutionResourcesPanel.tsx src/features/harness/execution-resource-client.ts tests/component/harness-page.test.tsx tests/component/harness-execution-resources.test.tsx
```

未运行全仓 tsc、全量 Vitest、build、Playwright、浏览器截图、数据库迁移或真实资源写入。没有启动服务，也没有占用或停止 3210/3212。上述组合测试不能作为浏览器或真实数据库验收。

## 独立增量与统一验收

资源补丁与逐文件 before/after SHA256 清单输出在任务可视化目录的 `harness-resources-d59` 下；相对 1152 项本轮基准的域外指纹、原冻结补丁和清单均需保持一致。应用顺序是 Git d59 接续基准 → 原 Harness 9 文件 → 兼容 4 文件 → 本轮资源 6 文件；先核对基准指纹并执行 apply check。

后续由 Git 线精确集成，再由 CI/CD 线串行执行全门禁与浏览器关键路径、预览可访问核验。本轮定向通过不代表全门禁通过，也不赋予合并或上线资格。此前 core-loop 审批恢复和 evaluation-evidence-desktop 第 58 行保存的失败未在本域解决或弱化。
