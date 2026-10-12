# d59 交付参考数据试算组件阶段交接

日期：2026-10-09。工作目录：D:/Downloads/agent-studio-cloud/.worktree-cache/frontend-web-tools-d59。
分支：codex/frontend-web-tools-d59。基线提交：d59bf84ec5902f07441e321537bd39345e4a30b1。

## 归属与组装

本批仅新增四个文件：

- src/features/workflow-canvas/WorkflowOutputPreview.tsx
- src/features/workflow-canvas/workflow-output-preview-client.ts
- tests/component/workflow-output-preview.test.tsx
- 本阶段报告

命名导出 WorkflowOutputPreview，实际参数为：

    {
      workflow: WorkflowDraft;
      sources: readonly WorkflowNode[];
      sourceLabels?: Readonly<Record<string, string>>;
    }

父组件传入实际可用来源和显示名称；组件不创建、推测或重写来源、嵌套关系及来源子路径。sourceLabels 只用于前端显示，未新增跨服务端数据结构。全部参数按实际唯一契约类型消费。未修改 WorkflowOutputEditor、FlowCanvas、workflow-output-editing、共享契约、服务端、接口、项目配置或验收来源。

## 实际只读边界

已重新读取本工作树的 contracts/workflow-output-preview、server/queries/workflow-output-preview、app/api/workflows/output-preview/route 及 server/domain/runtime/workflow-output-preview。
请求只提交到本站 POST /api/workflows/output-preview，使用 WorkflowOutputPreviewInput 和 WorkflowOutputPreviewResult。合法结果必须 executed:false 且 scope:final-delivery-fields。客户端先读取有界正文并解析结果，再处理状态码；HTTP 200 的正式失败仍是失败，非成功状态码的成功载荷不采用。

接口只调用现有纯试算查询与业务逻辑。组件没有启动运行、模型、业务工具、数据库写入、保存、发布、复制及浏览器存储操作。正文中显著说明：“只试算参考数据，不执行、不保存、不证明真实交付或质量。”

参考值逐项使用父组件传入的真实来源标识构造 outputs，界面显示来源名称及无标识的序号回退。所有参考值初始为空，留空不补示例。试算使用用户填写的数据；主视图只核对字段状态和参考结构，原始结构放在开发者数据折叠区。条件样例中的关联值不推测成真实执行路径。

## 状态与保留

- 请求、参考值合计和响应分别使用唯一契约中的容量常量。响应按声明及实际字节流共同限量，并验证编码与结果结构；超限或无效数据不采用。
- 格式与容量错误保留原填写，逐项格式错误聚焦对应填写区；不截断原值冒充有效数据。
- 必填缺失、空内容、可选省略、数字零和否值采用真实试算结果的字段状态。缺少或重复返回的字段状态显示未知。
- 凭据拒绝、403、503、网络中断、取消与未知响应使用固定中文反馈，不展示服务端错误正文。
- 等待期间只发一项请求，没有自动重发。取消立即解锁并保留输入，旧请求不能替换新会话。
- 参考值、流程、来源或显示名称变化后，旧结果永久过期；即使改回原数据也不恢复。变更后的晚响应舍弃，字段状态及名称不混用新定义。
- 清除参考值需要确认；返回保留填写及焦点。确认期间数据变化时拒绝旧确认。
- 来源暂时移出参考列表时不偷偷清除原填写；同一来源恢复后仍保留本页内存中的原值。离开页面后不保存。

## 验证

最终验证针对本批实际四文件增量，不叠加历史测试数量。

- 1 个新增组件测试文件，39 项通过。包含实际 RouteHandler → query → 纯业务逻辑桥接，以及契约合法模拟响应；未读数据库或调用真正供应商。
- 新增两个源码文件及自身测试的 no-cache ESLint，max-warnings 0，退出码 0。
- 外部独立叶子配置继承本工作树 tsconfig，strict:true、noEmit:true、incremental:false，并使用本工作树实际依赖与类型；检查组件、请求辅助、自身测试及真实传递依赖，退出码 0。
- NODE_OPTIONS 最大堆 1024；Vitest 单 worker、no-cache、no-fsModuleCache。未运行全量构建、浏览器验收或真实执行，不代表整仓或联合验收通过。

轻量检查的配置及日志在本聊天的 workflow-output-preview 交接目录，不修改项目 tsconfig。

## 基线与冻结

本增量相对于本工作树既有的提示增量之后导出；前序依次为公共基线、Web 六文件、slots 两文件、Root5、组合八文件、复制提示两文件。四项新增路径在前置基线中均不存在。

前置全文件 SHA 快照记录了 1157 个已有文件，最终核对无漂移；index 保持为空。以下旧补丁保持原有指纹：

- Web 六文件：47A338817E7E82C65F388021CE1774403405376C35A74A76AF6AAFBFF995C397
- slots 两文件：BB8707EE0404805F9FD2D7C27B960203AC5D237829A7735D733A1D4BECA64FC1
- 组合八文件：DA83710EA87D12376E2F248A21920BE1EAB4A9D6EFB82383E36515AC90487ED4
- 复制提示两文件：B78C81F11F65705B64A3EFA881A2FF2070314A82F66714BF670553543744D037

Root5 的已有源码及所有已有文件均未修改。本批不改冻结目录、历史报告或验收来源，无 stage、commit、push、merge、deploy。父组件组装及来源子路径、嵌套来源由主代理负责。
