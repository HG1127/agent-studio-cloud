# 网页工具 d59 接续记录

接续日期：2026-10-09。实际目录 `D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-web-tools-d59`，分支 `codex/frontend-web-tools-d59`，HEAD `d59bf84ec5902f07441e321537bd39345e4a30b1`。

## 接续基线

Git 交接 manifest 的 366 项字节指纹逐项匹配，暂存区为空，本域 delta 尚未应用时完成核验。原 5b4d 工作区、原六文件补丁和槽位补丁及旧验证记录保持冻结。

已按顺序通过 CLI `--codex-run-as-apply-patch` 应用原六文件与槽位两文件；未使用源文件覆盖或旧 Next 的目录链接。独立 `pnpm install --offline --frozen-lockfile --ignore-scripts` 完成，实际 Next 为 16.3.8、@ai-sdk/mcp 为 2.0.73，package/lock 指纹保持交接值。

原六文件补丁 SHA256：`47A338817E7E82C65F388021CE1774403405376C35A74A76AF6AAFBFF995C397`。

槽位两文件补丁 SHA256：`BB8707EE0404805F9FD2D7C27B960203AC5D237829A7735D733A1D4BECA64FC1`。

新版共享五文件由 Git 单独交付，patch SHA256 `63D49D0ABFB10EECFF3CE13365CF7308D2C9932A5F853F80AABC916476893C5F`，manifest SHA256 `12803D55EA88222391693AE3018FDC96435894B36F9D26BE73F96A9C6F375360`。五项 after 指纹核验一致，本域未修改这些文件。画布四文件未在本区应用。

## 本轮服务端组合

只有工作区手动任务与同助手版本归属核验成功后，才用实际 `run.id` 和 `DEMO_WORKSPACE_ID` 读取步骤。步骤读取独立失败保留最终结果与复制，传空步骤及独立的未知提示，不把查询失败伪装成已知没有步骤。

共享新投射器由总控适配并交 Git 落入本接续区；本域不修改共享组件、契约、查询或复制旧 RunDetail。已在 Server `WebToolSavedRun` 中把真实 key、已脱敏 output 与同任务步骤渲染为 `SavedRunResultValue` ReactNode，经客户端结果组件的 `valuePreviews` 展示槽组合。投射器只收到运行标识与冻结交付契约这个最小 Pick；客户端直接 props 只有结果与展示槽，不增加原始步骤证据、错误或原运行对象。

只有同次真实条件整步输出且值匹配才专门展示业务去向；非空 `sourcePath` 的嵌套业务字段继续普通展示，不改写业务自有 `next`、`matched`、零或否。别次任务的后续步骤名称不能作为本次证据，没有可靠名称保持未知，不声称后续已完成。

顶层字符串可见槽位使用既有 `presentBusinessOutput(output).text`，隐藏闭合推理包装与格式片段，未闭合包装显示无法核对提示；不递归改写深层普通业务值。复制行为保持原 Web6/slots2 约定：整体及逐项复制原脱敏内容，开发者数据也保留原内容，因此复制的字符串可能仍含包装。这与可见业务正文是不同入口，本轮未统一 RunDetail 的字符串复制行为，未改下载报告或底层来源数据，也不把文本展示处理当作字段归属证明。

## 本轮验证

新环境原本域 9 文件 91 项单 worker/no-cache 回归通过，不能用原 86 项记录替代；此接续记录和原两次域检查报告保留。本轮步骤读取边界与保存结果先过 2 文件 31 项，完整组合先过 11 文件 106 项；加入文本展示边界后最终 11 文件 108 项通过，使用 `--maxWorkers 1 --no-cache --no-fsModuleCache`，内存上限 1024 MB。

LeafStrict 临时配置位于本聊天产物目录 `web-tools-d59-transfer/leaf-strict.json`，extends 实际项目 tsconfig，strict/noEmit、incremental:false，包含本域九入口、组件测试、夹具、tests/setup.ts 和真实新投射器。未替换真实契约或项目配置。首轮外置配置未定位 Node 类型及三处旧夹具类型报错；定位实际 node_modules/@types 后，为旧准备测试收窄合法类型、补 type/required，保留非法名称和空路径及全部原断言；改动用例重跑 5/5，最终叶子检查退出 0。

本域全部叶子源码与组件测试、夹具、对应桌面测试执行 ESLint `--no-cache`。未使用总控旧依赖结果证明本区通过。组件测试验证服务端元素组合及客户端直接参数边界，不等于 RSC 网络载荷、浏览器路径或完整验收。没有真实业务执行、浏览器服务、全量 build/Playwright、暂存、提交、合并或部署。原审批恢复、评估保存失败用例没有弱化或删除，基线完整验收失败结论保留。

## 本次补丁范围

本轮独立组合补丁的基准是：366 common → Web6 → slots2 → 新版 Root5。原 Web6、slots2、Root5 不重复计为本域新改动，四个已有文件的前像字节已与 366 manifest 核对一致。

- 修改 `src/features/web-tools/WebToolTrialResult.tsx`、`WebToolSavedRun.tsx`。
- 修改 `tests/component/web-tool-saved-run.test.tsx`（步骤 mock）与 `web-tool-readiness.test.tsx`（上述真实契约夹具类型）。
- 新增 `tests/component/web-tool-step-read-boundary.test.tsx`、`web-tool-server-composition.test.tsx`。
- 新增 `tests/fixtures/web-tool-result-source.ts`。
- 新增本记录 `docs/frontend-parallel/web-tools-d59.md`。

补丁和精确前后 SHA 清单另存本聊天产物目录 `web-tools-d59-composition/`。只交接这八项，本域共享五文件指纹仍应保持 Git 交付值；不能整包 stage dirty 接续工作区。Git 已明确共享 Root5 的 CRLF apply 有空白警告，本域没有覆盖或规范化共享字节，不能声称整个 dirty tree 的差分格式全绿。
