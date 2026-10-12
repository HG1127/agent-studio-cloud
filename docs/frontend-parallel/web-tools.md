# 网页工具桌面前端交接

日期：2026-10-09。工作区：`C:\Users\Administrator\.codex\worktrees\5b4d\agent-studio-cloud`。分支：`codex/frontend-web-tools`。

## 基线与本次范围

- 原工作区 `git status --short` 为空，HEAD 为 `ab3b52b1caeb82205a52d0365bd99921c1346180`。功能分支已存在，reflog 仅显示从此提交创建；无其他工作区使用该分支，未覆盖、重置或另行提交。
- 共同只读快照路径：`C:\Users\Administrator\.codex\worktrees\frontend-implementation\agent-studio-cloud\qa\frontend-parallel-baseline-2026-10-09\baseline.zip`。
- SHA256：`85B571C31CD11B9C75AA3CDE4B0536AB9AE068F9923C272693618B08F04E4CE8`。机械导入后，manifest 的 740 个文件逐项指纹一致，0 个不匹配；manifest 的 sourceFileCount 为 722，不能替代实际归档文件总数。
- 相对 HEAD 的既存未提交前端、后端和契约差异全部属于共同基线。不能 stage 整个 dirty tree；只能在 Git 对话建立可合并基线后提交本报告列出的 delta。
- 未改旧项目、原前端工作区、主 D 盘 checkout、后端、契约、数据库、公共 UI、全局样式、配置、依赖声明或共享结果 helper。没有创建浏览器服务、提交、合并或部署。

## 已完成的增量

1. 长表单显示必填填写进度；可直接定位下一项未填必填。零、否计入填写，空白文字不计入；进度明确不能代表格式或业务内容通过。
2. 每个多行输入可独立展开到 8 行、收起到 3 行；显示既有 4000 字符上限与当前长度。切换只改变当前展示，不改变契约、试填值或检查结果。试运行锁定期间调整入口禁用；版本切换依靠既有版本 key 重置。
3. 已保存交付可逐项复制，复用共享 `CopyResultButton`，输入仅来自共享 `savedRunResultView` 已脱敏的输出；复制包含完整单项内容，保留零、否和结构，没有为展示改写业务字段。
4. 新增组件回归覆盖定位、填写进度、展开保持值、版本重置、逐项脱敏复制和复制失败反馈。为已有桌面端到端路径新增对应断言，保留原真实审批恢复与完整闭环要求。

增量文件：

- `src/features/web-tools/WebToolInputPreview.tsx`
- `src/features/web-tools/WebToolResultView.tsx`
- `tests/component/web-tool-form-usability.test.tsx`（新增）
- `tests/e2e/web-tool-preview-desktop.spec.ts`
- `tests/e2e/web-tool-trial-desktop.spec.ts`
- `docs/frontend-parallel/web-tools.md`（新增，本报告）

## 与旧版旅程对应

参考源为只读旧 `WebToolPublisher.tsx`、`WebToolPreviewPane.tsx`、`webToolTypes.ts`。当前真实旅程：发布中心 → 选择正式版本 → 核对冻结契约和说明 → 调整本页排版、填写与格式检查 → 另行确认真实内部任务 → 原任务处理审批/等待 → 返回关联任务 → 查看已保存输入、实际版本、交付及复制。

| 旧版环节 | 当前情况 |
| --- | --- |
| 来源版本与输入/输出契约 | 基线已读取真实正式版本，链接可核对冻结流程；本次复用 |
| 字段标题、类型、必填和填写说明 | 来自冻结版本；本次补充长表单定位与填写区调整。不可在这里修改冻结业务契约 |
| 新增、删除、排序字段与自然语言调整 | 无网页工具定义契约或持久化接口，不能以页面状态充当保存 |
| 模拟与真实试运行 | 基线已有另行确认内部真实任务，不复制旧模拟报告或假评分；启动接口不能锁定所选版本，现有说明保留 |
| 报告、评分、分析等结果模板 | 契约只定义交付路径，没有模块类型或展示配置。本次只复制真实已保存内容，不推断报告或图表 |
| 工具列表、新建、保存、更新、删除 | 缺接口，列入下方需求 |
| 公开地址、网页挂件、调用示例、密钥 | 缺公开执行入口，不生成虚构可用地址或代码 |
| 自定义域名与连通性诊断 | 缺云端能力，不冒充部署或诊断成功 |

## 后端与共享接口需求（未实施）

1. 网页工具定义共享 Zod 契约与持久化读写入口：绑定助手和冻结版本、名称/说明、输入展示标题与提示、行数/顺序、输出展示模块/顺序、草稿状态及并发更新检查。正式业务字段约束与展示配置需要明确区分，禁止绕过冻结契约。
2. 真实发布与撤销状态：发布前门禁、发布/更新/撤销动作、可公开访问的实际地址、历史状态与失败原因；发布成功以服务端证据为准。
3. 访问控制：成员或外部访问范围、凭据创建/撤销、域名允许列表与来源校验、频率/并发/时长/费用限额、写入权限及审计。密钥不能落浏览器存储。
4. 公共运行入口与结果读取：按工具已绑定版本执行、幂等创建、审批/等待边界、工作区隔离、可公开展示的结果契约与脱敏规则、取消/失败语义。接通后才能生成网页嵌入和外部调用示例。
5. 公网域名与诊断：可信来源的实际部署地址、域名验证、连通性/鉴权/跨域/限额诊断的服务端结果。当前前端状态无法证实这些能力。
6. 内部试运行锁定版本：当前 `startRunAction` 仅按助手提交时的当前正式版本启动，需要带预期版本并在服务端校验，才能承诺试填契约与运行版本一致。本次保留明确限制与实际版本核对。

## 本轮验证

内存上限 `NODE_OPTIONS=--max-old-space-size=1024`。使用本机缓存离线安装锁定依赖，无 package/lock 修改。

- 定向组件测试命令：`pnpm exec vitest run --project component --maxWorkers 1 tests/component/web-tool-form-usability.test.tsx tests/component/web-tool-input-preview.test.tsx tests/component/web-tool-preview-interactions.test.tsx tests/component/web-tool-trial-run.test.tsx tests/component/web-tool-saved-run.test.tsx tests/component/web-tool-readiness.test.tsx tests/component/web-tool-input-descriptions.test.tsx tests/component/web-tool-navigation.test.ts`。
- 修正后 8 文件、86 用例通过。首轮 85 通过、1 失败，原因是新增按钮可访问名称与原字段名称冲突；已改按钮名称，既有测试未改动或放宽。
- 全部 5 个增量源码/测试文件定向 ESLint 通过。
- `playwright test --list` 成功发现 2 文件、4 项桌面路径；仅解析用例，本地没有启动服务或执行端到端测试，不能据此声称浏览器路径通过。
- 全量类型检查、lint、vitest、build、桌面 Playwright、预览访问交 CI/CD 对话串行验收。未复用基线 1847 单测或 2/4 路径结论。
- 基线完整验收仍为 failed；原 core-loop 审批恢复和 evaluation-evidence-desktop 第 58 行保存失败未在本任务修复，相关用例原状保留。本次增量不构成可合并或上线结论。

## 编辑工具与补丁交付

默认 `apply_patch` 两次误报 `path contains a reparse point`；`Get-Item` 核实本任务目录与 src 链无 LinkType/Target。初次两个组件及新增组件测试由受控精确文本写入完成；已向总控报告，未做破坏性撤销。

总控提供的恢复方法已验证成功：PowerShell 7、实际任务工作区、单引号 here-string 完整补丁，调用 Codex CLI `--codex-run-as-apply-patch`。收到规则后本域桌面测试和本报告均通过此 apply_patch 编辑，后续源码编辑继续使用补丁。

相对快照的精确 patch、前后 SHA256 清单和基线导入差异记录位于本聊天可写产物目录的 `web-tools-handoff/`。补丁只有上述 6 个文件，供 Git 对话在共同基线就绪后评审应用；未提交整个工作区。
