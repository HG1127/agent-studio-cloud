# Harness 桌面前端交接（2026-10-09）

## 工作区与共同基线

- 实际工作区：`C:\Users\Administrator\.codex\worktrees\3227\agent-studio-cloud`。
- 实际分支：`codex/frontend-harness`；HEAD 为 `ab3b52b1caeb82205a52d0365bd99921c1346180`，本轮没有暂存、提交、推送、合并或部署。
- 开始时工作区干净，处于 detached HEAD。总控已建立同名分支，核对未被其他工作区占用后切换使用，没有重置分支。
- 共同快照：原前端工作区 `qa/frontend-parallel-baseline-2026-10-09/baseline.zip`，SHA256 为 `85B571C31CD11B9C75AA3CDE4B0536AB9AE068F9923C272693618B08F04E4CE8`。
- 导入后逐项核验 `baseline-files.json` 的 740 项文件，指纹不一致为 0。清单元数据的 sourceFileCount 为 722，本轮核验以实际 files 数组的 740 项为准。
- 快照中的既存未提交改动属于共同基线；不能直接把当前 Git dirty tree 当作本功能提交。
- 默认沙箱启动失败（helper_unknown_error），本轮使用自动审批允许的 scoped require_escalated，只针对自身工作区编辑；源码和报告均经 apply_patch 修改。

## 旧版与共同快照逐项核对

旧版只读参考：`D:\Downloads\agent-studio-v5.7（business-grounded-workflow） (1)\src\features\harness\HarnessConsole.tsx` 与 `harnessData.ts`。已完整读取两文件，以及本工作区 AGENTS.md、设计文档和已安装 Next.js 的服务端/客户端组件、导航、错误处理指南。

| 类别 | 共同快照已有能力 | 本轮决定 |
|---|---|---|
| 诊断与状态 | 最近 30 条运行、所选任务详情、实际步骤完成/失败数、独立证据读取失败反馈 | 保留，补充本次证据读取概览，便于先定位可读/未知范围 |
| 轨迹 | 标题/说明检索、步骤关联、全部/需关注、保存地址、顺序与来源核对、最近事件上限说明 | 不重做筛选，只新增概览直达；失败态也有有效定位目标 |
| 上下文 | 已保存上游结果、来源名称筛选/分页、脱敏预览、报告导出、关联步骤定位、格式失败区分 | 不冒充模型请求或上下文用量；概览区分未读取、读取失败、无快照、已读快照 |
| 下一步与恢复 | 按真实运行状态进入详情核对审批、外部消息、再次运行、继续启动、结果反馈；保留返回范围 | 增加从概览定位下一步，所有动作仍由既有详情处理 |
| 默认规则/安全/模拟 | 页面已明确未接入，未提供假开关 | 缺接口继续列出需求，不新增浏览器保存或虚假生效状态 |

旧版的待处理任务概况、恢复方式、安全规则数量依赖旧服务端。云端目前可核对的实际步骤、最近轨迹与结果快照具有不同范围，本轮只对这些已有查询结果做概览，不推断规则、安全或质量结论。

## 本轮实际交付

所选任务上方新增「本次证据读取」三列桌面概览：

1. 步骤记录数量按已读取记录计算，明确同一步骤可能有多次尝试，不声称计划步骤总数。
2. 最近轨迹数量按本次查询计算，明确不等于完整历史或安全规则判决。
3. 上游快照明确区分无效筛选未读取、查询失败未知、无可核对快照、已读取待核对内容。已读空对象不冒充完整来源清单。
4. 三项证据与下一步使用页内定位，不改所选任务/地址筛选，不发新查询或动作。步骤、快照、正常/无效/失败轨迹和下一步的目标支持键盘定位。

页面继续使用既有 listRuns/getRunView/listRunSteps/listRecentTrace/getRunContext 查询；本轮没有新增接口请求、数据库访问或后端动作。所有展示数据仍使用 contracts/run 的既有推导类型，没有新增跨端结构。

## 相对快照的精确文件域

以下 6 个文件修改、3 个文件新增，除此之外的共同基线保持原指纹。最终指纹清单及可应用补丁输出在该任务可写的可视化目录 `harness-handoff` 下。

修改：

- `src/app/(console)/harness/page.tsx`
- `src/features/harness/DiagnosticTrace.tsx`
- `src/features/harness/RunContextSection.tsx`
- `src/features/harness/RunDiagnosticNextStep.tsx`
- `src/features/harness/RunDiagnostics.tsx`
- `tests/component/harness-page.test.tsx`

新增：

- `src/features/harness/RunEvidenceOverview.tsx`
- `tests/e2e/harness-evidence-desktop.spec.ts`
- `docs/frontend-parallel/harness.md`

未修改 src/server、src/contracts、数据库/迁移、共享壳层、运行详情、画布、公共 UI、全局样式或依赖/配置文件。Git 所显示的这些域的既存差异全部来自共同快照。

## 本轮验证证据

- NODE_OPTIONS 限定为 `--max-old-space-size=1024`。
- 定向 Vitest：`node node_modules/vitest/vitest.mjs run tests/component/harness-page.test.tsx tests/component/harness-diagnostics.test.tsx tests/component/harness-next-step.test.tsx tests/component/harness-navigation.test.ts tests/component/harness-filter-navigation.test.ts --maxWorkers=1 --configLoader runner`。
- 结果：5 个测试文件、100 个用例全部通过，52.55 秒。新增 4 个页面回归覆盖证据失败与空态、无效筛选跳过快照查询、所选任务不可读时无概览、空对象不声称有来源；同时校验所有概览定位有目标且没有额外查询/导航写入。
- 8 个实际改动源码/测试文件的 ESLint 通过。
- 定向 TypeScript createProgram 使用项目 strict/noEmit 配置、8 个改动源码/测试入口加 tests/setup.ts 的 matcher 类型声明（共 9 个入口及其依赖图）：诊断为 0。首次未纳入 setup 的检查报告 matcher 类型缺失，补齐检查入口后通过，未改源码/配置来消除检查问题。
- 依赖通过自身 node_modules junction 指向共同依赖，未安装/更新依赖；Vitest 默认结果缓存位于共享 node_modules/.vite 下。后续验证应使用独立依赖或禁用缓存，避免测试缓存互相覆盖；未清除原工作区缓存。
- 新增 Playwright 桌面脚本需要真实可读运行记录。覆盖 1280/1440 宽度、四个定位目标、保留当前任务/筛选、没有非 GET/HEAD 请求、无水平溢出；支持 CAPTURE_UI_AUDIT 截图。
- 本轮未启动任何服务，也未执行 Playwright、全量 Vitest、全仓 tsc、build、数据库迁移或远程检查；没有占用/停止 3210 或 3212。
- 本轮没有浏览器截图或真实数据库 E2E 通过证据，不能将上述组件测试当作桌面浏览器验收。

## CI/CD 串行待验收

先由 Git 专用对话准备可合并共同基线，再只应用本任务 delta。CI/CD 专用对话串行执行全仓类型、lint、Vitest、build 和新桌面脚本，核验预览可访问，并采集 1280/1440 截图。

原 core-loop 审批恢复、evaluation-evidence-desktop 第 58 行保存失败尚未解决；本轮没有改动或弱化这些用例。共同基线完整验收仍为 failed，本域定向通过不改变可合并/上线结论，模型模拟也不等于真实外部能力。

## 尚缺的真实接口

- 默认运行规则：已生效配置、作用范围/版本、保存与校验动作、未来新任务生效语义；覆盖恢复方式、复核、记忆、上下文容量和抽样参数。
- 安全规则：读取完整列表与优先级/启停、创建/修改动作、服务端命中与判决记录、权限检查结果；普通事件 warn/error 不能替代这些证据。
- 上下文审计：每步实际请求来源、裁剪/压缩记录、已使用/上限及保存时间；已有上游 outputs 不足以证明这些信息。
- 只读策略模拟：由服务端计算身份/环境变化下的判断，必须明确不重跑任务、不调用外部工具、不改变原证据。
- 连续质量评估：可按此次运行核对的真实质量结果与抽样/回归候选记录；不能以任务完成或警告数当质量分。
- 审批/重试治理：当前继续使用真实详情动作；任何策略审批、重试额度或预算控制需有服务端生效状态与审计查询后再做前端开关。
