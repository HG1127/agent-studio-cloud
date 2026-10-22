# 验收样例结果结构规则：未验证接线包

日期：2026-10-10。状态：只完成代码与规格作者工作，所有执行检查为 false，禁止据此合并或上线。

## 归属与精确前像

工作树为 `D:/Downloads/agent-studio-cloud/.worktree-cache/evaluation-result-schema-completion-d59`，分支 `codex/evaluation-result-schema-completion-d59`，提交仍是 `d59bf84ec5902f07441e321537bd39345e4a30b1`。

独立接线包以冻结 564 文件候选 `D:/Downloads/agent-studio-cloud/.worktree-cache/frontend-verified-failure-repair-candidate-d59` 为前像，不以当前主树或 Git HEAD 中的旧页面为前像。冻结清单是 `C:/Users/Administrator/.codex/visualizations/2026/10/09/01a11ea1-980c-7900-acf8-51bc728d570b/frontend-verified-failure-repair-candidate-d59-manifest.json`，其 SHA256 为 `DCE977CAB47834506C42F9371DF3E3940885A7365FBCDA9AC68F2A3E465B516C`；已有 EvaluationPanel 前像 SHA256 为 `8D90B544A8E73174E868CB276C983890772D82376A5219E0DC2996A22986E48F`。

已接手旧工作树 `C:/Users/Administrator/.codex/worktrees/frozen-resource-comparison-d59/agent-studio-cloud` 中保存的五个未封存文件，继续完成父层能力。旧 C 工作树、旧资源比较包和非本任务文件全部保留。纯函数规格从本任务未封存的 `tests/unit/` 副本移到现有 Vitest 会发现的 `src/features/agents/evaluation-result-schema-draft.test.ts`；没有修改测试配置。

包仅包含 EvaluationPanel、结果结构规则编辑/摘要、纯前端 helper、对应纯函数/组件/浏览器规格和本文件。中央文档由主对话更新；不修改 contracts、server、db、lib、package 或配置。

## 真实保存边界

- 使用已有共享 `EvaluationResultSchema`，前端仅读取对象格式、根对象类型和 UTF-8 32KB 容量；没有引入第二份跨端结构，也没有导入服务端语义校验。
- 省略 `resultSchema` 表示保留原规则；明确确认清除才提交 `null`；合法对象表示替换。对象里的 0、false 以及原有名称、输入、字段检查不会被规则操作丢掉。
- 新建规则编辑区为空，不自动生成示例规则。取消只取消本条规则填写，其他表单填写保留；清除也须保存样例才生效。
- 已保存来源分别展示“未提供字段”“明确未设置”“可读取对象”“暂时无法解释”。缺失或不可解释来源不会被当成已经清除。只有结构规则而没有字段检查的样例显示结构检查，不能声称只检查流程完成。
- 规则的实际支持范围仍由已有 `evaluationResultSchemaIssue` 和服务端动作核对。只读代码依据显示，现有后端支持类型、properties/required/items、enum/const、字符串长度与安全 pattern、数字上下界、数组与对象数量边界及 additionalProperties 等；不支持的关键字（例如 oneOf）、非法定义和凭据仍由后端拒绝。前端没有扩展这些能力。
- 保存调用现有 create/update 动作。服务端失败或版本冲突保留全部填写；真正收到 ok 回执才显示保存成功。对象可解析、规则已保存都不代表样例验收通过，也不会自动启动验收。

## 编辑与未知回执保护

运行、处理请求、读取恢复线索以及未知启动回执时，规则和样例写入处理入口锁定。同步 ref 在同批事件中拦住重复提交和随后修改，不能只靠按钮 disabled。

未知样例保存回执时，核对严格重用原请求对象，包括原 resultSchema 和 expectedUpdatedAt；不拼接后来的草稿或刷新后的样例版本。原编辑内容保留，其他样例编辑和整轮验收暂停，直到取得明确回执。

切换样例或重置表单会递增编辑代次；规则清除/取消确认还需核对修订。规则 A→B→A 不能复活旧确认。父层按助手隔离会话，助手 A→B→A 返回时旧保存回执不能清除新表单、显示旧错误或刷新新会话。没有添加数据库写入口、存储草稿或生产连接串。

## 作者规格与未完成验收

纯函数规格位于 `src/features/agents/evaluation-result-schema-draft.test.ts`。叶子组件规格为 `tests/component/evaluation-result-schema-editor.test.tsx`；真实父组件规格为 `tests/component/evaluation-result-schema-composition.test.tsx`，只在已有服务端动作模块的 I/O 边界替换响应，真实 EvaluationPanel 和规则叶子一起运行。

父层规格覆盖省略/null/对象实际载荷、非法对象不发送、后端语义拒绝与冲突保留全部填写、取消只恢复规则、真实处理中同批重复提交和后续输入保护、丢失 create/update 回执重用同一请求、规则 A→B→A、样例切换/重置，以及助手 A→B→A 的旧回执隔离。

浏览器规格 `tests/e2e/evaluation-result-schema-desktop.spec.ts` 作者了真实导入、创建/修改/取消/清除样例、刷新后读取已保存规则、后端拒绝不支持规则，以及两页真实版本冲突。无跳过分支，无伪造保存成功回执；规格要求由 CI/CD 对话在安全隔离应用和 Neon 分支执行。它不运行模型或业务任务。

本任务没有执行依赖安装/审计、Next 类型生成、类型检查、lint、Vitest、构建、数据库/Workflow 集成、浏览器、Playwright、完整 acceptance 或预览访问。没有提交、推送、合并、部署或清理。此前候选的实际失败记录没有被本包改写成通过。

只读确认：此冻结候选的 package.json 没有 acceptance 命令，acceptance.ps1 不存在。最新主项目 AGENTS.md 的完整本地 CI 规则优先；验收专用对话必须先补齐最终验收树入口和安全隔离条件，再对最终同一份代码完整执行。GitHub CI 不可用（账单、免费额度或 runner 状态不明也包含在内）时须转本地完整 CI，不能等待远程恢复，不能使用生产或归属不明数据库；预览可访问门槛仍需满足。
