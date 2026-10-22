# 输入映射只读试算传输与取消增量（2026-10-09）

## 精确范围与基准

实际工作区 `D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-harness-d59`，分支 `codex/frontend-harness-d59`，HEAD `d59bf84ec5902f07441e321537bd39345e4a30b1`，继续使用自身独立 Next.js 16.3.8/Vitest 5.0.1 依赖。

本阶段基于自身工作区 Git366common → Harness9 → compat4 → resources6 → Input8 后的 1164 项清单，冻结 `transport-phase-baseline.json` 的 SHA256 为 `750D82308523845B54954729A99C04E3E970FA539D74C5AD4067DD15A747BA7F`。1164 是文件清单数量，不是 Git 未提交文件数。

只修改两个模块，新增两个专属测试与本文，共五文件增量：

| 文件 | 变化 |
|---|---|
| `src/features/workflow-canvas/node-input-mapping-preview-client.ts` | 修改：有界字节流、真实取消、固定地址与提交快照回执核对 |
| `src/features/workflow-canvas/NodeInputMappingPreview.tsx` | 修改：用户取消、编辑/定义变化/卸载实际取消，隔离晚响应 |
| `tests/component/node-input-mapping-preview-transport.test.ts` | 新增：39 个传输、契约及关联用例 |
| `tests/component/node-input-mapping-preview-cancellation.test.tsx` | 新增：9 个组件实际取消用例 |
| `docs/frontend-parallel/input-mapping-preview-transport.md` | 新增：本说明 |

没有修改 NodeInputMappingEditor、node-input-mapping-editing、NodeInspector、FlowCanvas、任何模型或 Root 文件、原三测试、后端/契约/数据库/配置/依赖/锁文件。原 Input8 冻结补丁与清单、其历史初败证据保持不变。索引为空，无暂存、提交、推送、合并或部署。

Root 在主线另行修改的父画布、Editor 和编辑辅助文件不属于本增量。集成只需核对这里两个模块的 before SHA、三新增路径为空并检查补丁；不得据本工作区保护清单反向覆盖 Root 的不重叠改动，也不得重应用原 Input8 包覆盖新父组合。

## 响应读取和取消

已只读参照 Web4 的 workflow-output-preview-client/WorkflowOutputPreview，读取实际 input-mapping-preview 契约、纯 query/domain、真实 Route Handler、JSON 比较与输入约束，以及本地 Next.js 客户端指南。

- 固定本站 `POST /api/workflows/input-preview`，`credentials: same-origin`、`cache: no-store`、`redirect: error`，传入实际 AbortSignal。响应标记已重定向也拒绝读取。
- 只接受实际接口的 application/json；无正文、错误类型、非法 UTF-8、无效结构或超量内容均不采用。错误不将原响应正文或内部异常带入界面。
- 使用流读取，不调用无界 response.json/text。Content-Length 必须是可信安全整数且不超过共享 512 KiB 上限；实际累计字节也受同一限制，包括填充空白和多字节文字，越界立即取消正文。
- 未压缩或 identity 正文的声明长度必须匹配实际 UTF-8 字节。浏览器解压后的正文长度不当成压缩传输长度，压缩情况仍严格核对实际读取上限、编码、结构与请求关联。
- AbortSignal 既传给 fetch，也绑定 reader.cancel。取消挂起读取会释放读取锁；预先取消不发请求，即使模拟网络忽略取消并晚返回，仍取消它的正文并拒绝结果。
- 手动取消、修改输入/成果样例、定义/来源/上下文改变与卸载均真正 abort。同步请求归属检查阻止重复提交；原填写保留，没有自动重发或浏览器持久存储。

## 提交快照与回执关联

请求先通过唯一共享 InputMappingPreviewInput，再以实际发送正文建立独立 JSON 快照并核对编码容量；调用者后续修改原对象不改变提交内容。

成功仅接受真实路由的 HTTP 200、executed=false、正确 scope。目标列表次序、逐字段状态、携带成果标志和实际 input/outputs 都必须与发送快照精确匹配。值与状态校验复用已有纯 resolveNodeInput、resolveInputValue 和 jsonValuesEqual，未修改或复制后端业务；本地校验只拒绝错回执，界面成功仍来自真实 API 响应。

组件使用请求对象、原序号和定义轮次隔离结果，改动后回到旧定义也不能复活旧请求。旧请求在新结果之后返回不能覆盖新结果。界面保持原“只读、不执行、不保存、样例不是实际来源证据”的说明，不制造安全或运行成功结论。

## 实际定向验证

三测试文件 64/64 一次通过：新增传输 39、取消 9，加未修改的原预览 16。命令如下，单 worker、无缓存、堆 1024 MB，耗时 15.32 秒。

```text
node node_modules/vitest/vitest.mjs run tests/component/node-input-mapping-preview-transport.test.ts tests/component/node-input-mapping-preview-cancellation.test.tsx tests/component/node-input-mapping-preview.test.tsx --maxWorkers=1 --configLoader runner --no-cache
```

测试覆盖边界恰好 512 KiB、无长度/低报/超报/非法长度、多字节实际编码、分片、压缩声明、非 JSON、错误编码、重定向、scope/执行/字段次序/状态/标志/数值/成果错关联、异常 HTTP、快照独立性、访问器拒绝、真实挂起流取消/卸载、忽略取消的晚响应、回旧定义和新旧响应乱序。

正常路径桥接实际 Route Handler → 真实只读 query → 纯 domain；无数据库或真实网络。其他传输/延迟模拟不代表真实外部执行。没有更改原三测试来适配新代码。

四个修改源码/新增测试文件的定向 lint 通过；两源码、两新测试加 tests/setup.ts 共五入口及依赖图 Strict/noEmit 诊断为零。原 Input8 阶段首次 34/52 和第二次 50/52 的失败 JSON 原样保留，本轮首次 64/64 不替代或抹掉历史证据。

未运行全仓 tsc、全量 Vitest、build、Playwright、浏览器截图、数据库迁移、实际工作流或工具/模型执行；没有服务启停、生产写入或合并部署。

## 独立增量交接

本轮五文件补丁、before/after 清单与 1162 项受保护文件证明存于任务可视化目录 `input-preview-transport-d59`。原 Input8 补丁 `3584715081B0BE6CFE8F23954C6D8DC7E98DFEAA9F5A43387400C282551E3E03`、清单 `14EAA64ABAD9D6DB842DB19F83E1228E4B209E48776138BDC18E5E15888ED5C5` 保持冻结；本补丁须接续应用，不能替代旧包。

父画布组装及其拒绝回调、全流程确认上下文由 Root 负责。Git 精确集成后再由 CI/CD 串行执行共同门禁与浏览器验收。本轮定向通过不代表可合并上线；既存审批恢复与结果评估保存失败未在本轮解决或弱化。
