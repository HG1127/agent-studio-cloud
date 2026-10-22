# 固定工具核对请求历史读取交接候选

日期：2026-10-10。固定提交后的历史读取可能长期未返回，父表单原 inspect 没有取消信号，checking 期间按钮持续禁用。本交付新增独立客户端读取叶子，提供慢读提示、显式中止本次读取和手动重读；父表单与工作台接线仍由 Root 完成。所有类型、lint、测试、构建、浏览器和原生验收均未执行，候选不能作为通过证据。

## 独立基线和读取映射

工作树 D:/Downloads/agent-studio-cloud/.worktree-cache/frontend-tool-operation-read-recovery-d59，分支 codex/tool-operation-read-recovery-d59，HEAD d59bf84ec5902f07441e321537bd39345e4a30b1，基线 877 个已有文件。独立目录和功能分支通过 Git 建立，禁用 checkout hooks；没有安装、链接或复用 node_modules。

主线只读根 D:/Downloads/agent-studio-cloud/.worktree-cache/frontend-tool-registry-details-d59。原 ToolOperationReconciliationForm、tool-operation-client 和 tool-operation-request-hash 入口不在新基线，叶子使用回调接入，不复制、移动或覆盖这些父源码。唯一 src/contracts/tool-operation.ts 与主线逐字节一致，保留现有 ToolOperationResolveInput、ToolOperationGetResult、ToolOperationView 和历史记录契约。

主线 readToolOperation(operationId, signal) 已向现有 GET 传递 AbortSignal；原 inspect 调用未传信号。主线 toolOperationRequestHash 对共享契约校验后的完整输入使用 canonicalJson 和浏览器 SHA-256，不能计算时返回 null。读取和摘要回调必须分别接到这两个既有客户端函数，不能提供固定摘要字符串或伪造读取结果。

已核对实际 AGENTS.md 与 Next.js 16.3.8 客户端指南。新组件从已有客户端父表单接收函数回调；这些回调不能作为普通函数从服务端组件跨边界传入。没有新后端接口、跨端数据结构、数据库字段或依赖。

## 六个新增文件

| 路径 | 职责 |
| --- | --- |
| src/features/tool-operations/ToolOperationHistoryReader.tsx | 手动读取、中止入口、慢读和未知状态、键盘及焦点恢复 |
| src/features/tool-operations/tool-operation-history-reader.ts | 读取控制器、取消信号、单调代次、迟到响应与卸载隔离 |
| src/features/tool-operations/tool-operation-read-evidence.ts | 完整原输入副本与共享契约证据核对纯函数 |
| tests/domain/tool-operation-read-recovery.test.ts | 同请求证据、内容保真、取消、代次、摘要迟到与清理专属测试 |
| tests/component/tool-operation-history-reader.test.tsx | 界面手动恢复、离页保护、键盘与回调归属专属测试 |
| docs/frontend-parallel/tool-operation-read-recovery-d59.md | 本交接候选 |

所有路径均为新增，导入前应不存在。父 Form、Workbench、Root 源码、旧网页交付、容量六文件、轨迹六文件及其证据、后端、契约、数据库、配置、依赖和锁文件保持原样。

## 父客户端接线要求

ToolOperationHistoryReader 接收以下客户端属性：

| 属性 | 绑定规则 |
| --- | --- |
| payload | 原已提交并固定的完整 ToolOperationResolveInput，包括实际回执、依据、确认项、种类和原请求标识 |
| sourceRunId | 原提交时捕获的任务来源；不能用随后刷新的另一条记录替代 |
| requestGeneration | 客户端安全整数代次；完整内容或来源换绑时严格增加，A 到 B 再到 A 也使用新的代次 |
| readEnabled | 原提交已经结束并可核对时启用；原 POST 仍进行时为 false |
| read | 既有 readToolOperation，必须向只读 GET 继续传入收到的信号 |
| hashPayload | 既有 toolOperationRequestHash，对传入的完整原输入副本实际计算摘要 |
| onRecorded | 仅收到严格同请求证据时回调 operation、原 payload 副本、原来源和原代次 |

Root 应在固定 attempt 区域接入，并将原历史读取逻辑替换为这个受控叶子；不能同时留下不受本控制器管理的旧 inspect GET。回调处理须再次确认父层当前 attempt 的完整原内容、来源和代次仍匹配，再接受保存历史并转为已登记。叶子不提供重发、撤销、解锁或创建请求的回调。

父层既有未知提交保护继续独立保持。中止、读错、未读到、内容或来源不一致都不触发 onRecorded，也不改变父层离页保护。代次是客户端读取归属，不能据此生成新的业务 requestId。父接线完成之前，不能声称现有表单已提供恢复入口。

## 慢读和证据边界

挂载、换绑和更新回调均不自动读取。每次点击仅开始一次只读读取，5 秒后提示较慢，不自动超时重试或轮询。用户中止时只取消本次读取信号、清理提示计时器并使旧读取失效；用户再次点击才重读原操作。中止后焦点回到手动读取按钮。

控制器分别保留单调请求代次和读取代次。完整输入、来源、启用状态变化或卸载时取消旧读取；不遵守取消信号的迟到 GET、旧摘要计算和旧读取的 finally 也不能覆盖新读取。相同代次更换内容、倒退代次和复用旧代次进入未知状态，须更高代次才能重新绑定。控制器保留原输入的独立副本，摘要和确认回调取得各自副本，避免回调修改固定提交。

只有共享响应校验通过、原 operationId 与 sourceRunId 精确一致、历史中存在唯一原 requestId、原 kind 一致且完整实际 requestHash 相等，才通知本次已记录。缺失或无法计算摘要、重复同请求记录、不一致记录、未读到和读取失败均未知。历史达到 50 条时按覆盖边界保守保留未知，即使其中有同标识摘要，也不据此解除未知提交保护。

归属核对使用共享契约实际提供的操作与来源字段；不补造账号、工作区或服务端判决字段。业务状态 completed、其他请求历史或业务回执存在都不能证明本次请求已登记。界面只显示简单中文，不显示标识、摘要、原回执或底层错误细节；结论登记不表示工具执行成功、旧任务恢复或产生新运行。

## 精确交付和后续验收

证据根 C:/Users/Administrator/.codex/visualizations/2026/10/09/01a11eb2-ce0d-7c00-9608-f92981ab4981/tool-operation-read-recovery。qa/source-mapping.json 保存主线四个只读入口和 AGENTS 的实际 SHA 及缺失入口映射；qa/baseline-files.json 保存独立基线逐文件 SHA。

六文件增量补丁、before/after 清单和后像输出到该证据根的 unaccepted-handoff，所有 beforeSha256 为 null。CI 导入前核对新增路径不存在，导入后逐文件核对 afterSha256，并确认既有文件没有变化。此交付不包含父级对齐、旧包、安装产物或完整工作树差异。

两份专属测试已编写，尚未执行；并不把静态核查或文件 SHA 核对当作测试通过。当前没有检查窗口，未安装、运行 types、lint、Vitest、build、浏览器、acceptance 或原生测试。全部后续验收只交 CI 专用对话，在最终同源基础上串行执行完整本地 CI。本线没有暂存、提交、推送、合并或部署。

已只读核对主项目 D:/Downloads/agent-studio-cloud/AGENTS.md 第 92–95 行，SHA-256 为 4D214ED53B9304FEFB00A026C1E39EB91A3CD682D2EC56C46775C4D93CFEBEBC。GitHub 免费 CI 未确认可用时，最终验收按 pnpm acceptance 转为本地 CI；同一最终代码须完整执行锁定依赖安装、依赖审计、Next.js 类型生成、类型检查、lint、Vitest、构建、隔离 Neon 迁移、数据库与 Workflow 集成测试和 Playwright，保留 Vercel 预览可访问门槛。执行前由 CI 确认 package.json 的 acceptance 命令、acceptance.ps1、运行环境及隔离测试配置齐备；条件缺失应记录并补齐，不能使用生产或归属不明的数据库。GitHub 测试失败必须修复，不能切换本地绕过；最终记录不可用原因、代码版本、命令、完整结果和未完成项，未执行、跳过或失败一律不算通过。这个主项目文件的更新不导入本叶子补丁，也不改写工作树既有 AGENTS。
