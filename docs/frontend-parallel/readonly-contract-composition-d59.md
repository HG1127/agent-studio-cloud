# 冻结字段、网页保存输入与试算取消组装

## 实际接续范围

本轮基于 d59bf84ec5902f07441e321537bd39345e4a30b1 的独立私有集成目录，接续已冻结 403 → Frozen4 → Model5 → Input8 → Root18；不是将全部脏工作区差异当成本轮增量。首先只按最终 403 清单机械对齐网页域支持文件，核对 24 项，其中 12 项私有旧支持文件需要对齐；这一对齐不属于后续新增父组装增量。

随后原样导入三份已交付增量，共 11 项（9 新增、2 修改），每项原指纹、交付指纹和严格正反补丁检查通过：

- FrozenNodeContracts3：1B0ADAC99CBE14E612DC03B9D7FF7D72A870AF82ABEA81A36691D26061E97464。
- InputPreviewTransport5：C85261B28C54014764EE6A50045090F2192DF82A5ECA8765740AAA80B61DCF87。
- WebSavedInputCoverage3：0EE4979AD86AB495EC57724341FC6A7057E93EE70ED021A415ACDCA85E041CF4。

父组装修改只在前端 app/features 和测试/记录中。无 contracts、server、db、package 或 lock 修改，保护基线 456 项；原前端的 213 项旧后端/契约/原失败 E2E 仍另外核对。各域原冻结交付和旧联合候选不被覆盖；本轮没有提交、推送、合并、部署或启停用户 3210。

## 真实页面接线

冻结版本仍经 getVersionExportSource 的工作区、助手及版本条件读取原 manifest，先用唯一 AgentManifest 校验。页面将同一 source.manifest.workflowSnapshot 提供给 frozenWorkflowView；视图先检查被动数据、容量、契约及与已校验快照的一致性，再只对两个字段保留脱敏原值。不能拿另一份快照、当前草稿或解析默认配置补原记录。

FrozenNodeDetails 已实际挂载 FrozenNodeContracts，顶层、组内原映射/模型规则可核对。未保存 providerMode、maxRepairAttempts、required、includeUpstreamOutputs 时明确缺省；未知键只读保留，零/否、含点字面层级和原模拟样例不被重新制造。仍无编辑、试算、保存或运行入口，readonly 图、路径、查找、复制和来源定位保留。

WebToolSavedRun 仍在 WebToolTrialResult 验证内部 manual 任务及同助手选中版本之后组装；用该次 run.input/inputContract，不借当前选中版本字段。原服务端 SavedRunResultValue 槽、同次步骤证据、正文整理/原保存数据复制差异提醒和独立步骤读取失败边界均保留。原只显示已有声明字段的输入列表改为 WebToolSavedInputCoverage：声明项的缺失、空内容、类型不符及约定外实际保存项完整核对。原输入不改，不推断过去提交是否合法，也不把基本类型符合说成业务验收成功。

输入试算在实际 NodeInspector → NodeContractEditors → NodeInputMappingEditor 路径上消费真实只读 Route Handler。收到的 512 KiB 有界响应及回执须对应实际提交，取消真正传递 AbortSignal/取消流；完整草稿变化、样例变化、卸载、用户取消和旧定义回归均不复活迟到结果。此处只有用户明确样例的字段试算，不是步骤执行或提供商调用。

## 验证边界

首轮实际收集 14 个唯一文件：207/208。一个目标文件名误写未收集，已改为真实 frozen-output-source.test.tsx，不能声称首轮检查了 15 项。唯一失败为新增完整保存输入开发者区后，旧 getByText 的宽泛文字查询命中业务值及原 JSON 两处；只定位到真实输入约定列表，原内容断言不弱化。初败日志/退出码保留。

本轮新增真实父页与取消组装回归，不借各域历史 25/64/15 或 Root18 的 204 汇总。最终同源码 15 文件 213/213（56.08 秒）通过；20 入口及真实传递依赖 Strict/noEmit 退出 0，18 个实际变更代码/测试文件 lint（max-warnings=0）退出 0。命令退出、原/私有保护指纹及精确 delta 在 qa/readonly-contract-composition-d59-2026-10-09 中记录，以实际最终清单为准。

已有两个桌面 Playwright 规格增强了真实冻结原记录、只读字段区、完整保存输入和业务状态断言，未在开发主线执行。旧审批恢复及历史验收输入首次保存失败未弱化或删除，原 m3-flows.spec.ts 保留。完整类型/lint/Vitest/build、Workflow、隔离 Neon、全部原生关键路径及实际可访问预览仍需在精确共同源码上串行验收；局部结果不代表可合并上线。

## 完整目标仍待继续

- 未应用表单跨步骤选择与离页的保护仍未实施；折叠保留和上下文失效不等于此项完成。
- 网页试填 4000 字符的人为限制由网页域接续按真实 100 KiB 总 UTF-8 契约补齐，未交付前仍算前端待办。
- 网页页实时结果更新有既有任务 SSE 入口可接，仍是前端接线项，不泛称后端缺失。
- 独立网页定义/持久展示配置/外部发布密钥调用、Harness 守护规则持久管理、MCP 持久连接授权与发现工具入库等按实际接口缺口继续记录；不能伪造完成。
- 桌面网页继续主目标，不新增手机任务。
