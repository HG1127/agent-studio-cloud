# 结果结构规则 r2：未知保存锁与旧助手回执隔离

日期：2026-10-10。状态：仅作者代码和规格；checks=false、release=false，未执行任何测试或验收。

## 独立增量与前像

工作树为 `D:/Downloads/agent-studio-cloud/.worktree-cache/evaluation-result-schema-completion-r2-d59`，分支 `codex/evaluation-result-schema-completion-r2-d59`，HEAD 仍为 `d59bf84ec5902f07441e321537bd39345e4a30b1`。

本增量必须串行接在旧 8 文件包之后，不可直接应用到冻结 564 的 EvaluationPanel。旧包目录为 `D:/Downloads/agent-studio-cloud/.worktree-cache/evaluation-result-schema-completion-d59/qa/evaluation-result-schema-d59-2026-10-10-candidate`；旧 patch SHA256 为 `4C0AF43E29EE6FC5C419B23F99A4B757501464320054437A2326E25A7348B6FA`，旧 manifest SHA256 为 `3DA339F2020EC684A7FB6611CBF14BFA81C0CDCE2ABDAEDF2450212D8F1EF030`。旧工作树和旧封包原字节保留。

改动前 Panel SHA256 为 `54B229CC18DC5B8B78A467CB16594C0B55DAE401D41BB7331387A730E9B641E0`；父组合规格 SHA256 为 `80D57320D62064953BC6BC14656A984718DFDC79A957B9F6580030E05745D3B3`。本包仅修改这两个文件并新增本说明；封存清单记录逐文件前后 SHA 和 patch SHA。其余旧 8 文件包内容、冻结资源、后端、契约、数据库、依赖和中央文档均未修改。

## 已修正的实际父层行为

未知保存后手动核对收到失败回执，不等于证明第一次未保存。父组件继续保存原 CaseSaveRequest 对象，保持原名称、输入、字段检查和规则锁定，提醒先核对已保存的样例记录。再次手动核对继续发送同一 payload 对象和原 expectedUpdatedAt，不读取后来填写或刷新后的修订。首次提交直接得到明确失败时仍保留全部填写并恢复编辑。没有新增恢复查询、自动重提或后端接口；成功回执仍只确认保存，不代表规则或验收通过。此处取代旧说明中可能被理解为“任何明确回执都可解锁”的表述。

按助手 key 隔离的父层会话使用布局提交阶段建立与撤销的代次守卫，不依赖被动 effect 清理。保存、启动验收、生成样例、归档及恢复动作均在发送前捕获提交代次，完成、失败、未知异常以及 finally 先核对会话归属；旧助手 A→B→A 的回执不能清除新表单、写旧错误、结束当前处理状态或刷新当前页面。旧启动回执也不能删除新会话仍需要的请求恢复线索。恢复微任务及运行刷新计时器使用同一会话守卫。未改变真实后端行为。

原共享 EvaluationResultSchema 与省略保留、null 清除、合法对象替换的保存语义不变；不迁移服务端语义校验，不生成示例规则。

## 作者规格与未验证边界

真实 EvaluationPanel 与规则编辑组件一起使用，动作模块只替换 I/O 响应。父组合规格加强：create/update 未知→失败→再次手动核对仍是原对象及原修订，失败核对后真实输入处理入口仍锁定；首次直接冲突或语义拒绝可继续编辑；create/update/start/generate/archive/restore 的成功、失败和未知回执逐项经过助手 A→B→A；切换布局提交阶段送达的旧保存回执不得刷新当前助手。另覆盖真实恢复线索：回到 A 后核对同一验收请求，旧启动的三种回执都不能删除原线索、解锁当前处理或刷新页面，只有当前回执可以完成自己的处理。

这些规格仅已作者，未运行。没有安装、审计、类型生成、类型检查、lint、Vitest、构建、数据库/Workflow 集成、浏览器、Playwright、完整 acceptance 或预览访问；没有提交、推送、合并、部署、清理或更改现有网页服务。后续由专用 CI/CD 对话针对最终组合代码完整验收。最新主项目 AGENTS.md 优先；GitHub CI 不可用时先补齐 acceptance 入口和安全隔离配置，再执行完整本地 CI，不能使用生产或归属不明数据库。此增量不消除既有候选失败记录，也不满足发布门槛。
