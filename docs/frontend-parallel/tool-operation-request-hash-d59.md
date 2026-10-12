# 工具核对请求摘要独立修正

本增量叠加在既有工具人工核对12文件包之上。独立源为 `D:\Downloads\agent-studio-cloud\.worktree-cache\frontend-mcp-connections-d59`，HEAD `d59bf84ec5902f07441e321537bd39345e4a30b1`。原持久12文件补丁 SHA `1160CB30E24323F7D2E6B856FA80C1FD4ABB78071418DBA7CB04B988DE09D8BA`、恢复清单 SHA `6E2CE92CDD9AED0794437C15D3A725B4540433F74EBC64D7EDC03FCC55CC07FB`保持原字节，不能拿本修正覆盖原包。

## 问题与行为

此前读取历史只匹配请求标识和结论种类，即声称本次核对已登记。同标识、同种类但不同原因或回执时，这个判断不能证明记录来自当前固定请求。

现先检查返回操作和任务归属与本次固定操作一致，再仅在请求标识、结论种类与完整请求摘要三者匹配时显示本次已登记。任务归属随首次发送固定在组件状态中，不依赖父回调过滤错误任务。`tool-operation-request-hash.ts` 复用唯一 `ToolOperationResolveInput.parse` 与既有纯 `canonicalJson`，使用安全浏览器的 Web Crypto SHA-256 对本页固定完整请求进行验证。输入解析、原因去空格、递归对象键顺序、数组顺序、UTF-8 字节和原始回执类型均遵循服务端既有算法，没有重写后端算法或引入新 DTO。共享排序保留原默认localeCompare；跨环境产生不一致一律未知，不改后端算法。

后端 `resolve-tool-operation` 在原因脱敏前生成请求摘要。因此比较原始固定请求，不拿历史中的脱敏原因或当前展示回执重建原请求。页面不显示摘要或内部标识。

摘要缺失、不匹配、非安全浏览器、缺少计算能力、计算拒绝或异常长度都保留未知，锁定原请求与内容，禁止重发，不声称登记成功。最新历史尚无该请求时仍不把空历史当失败；仅在本页原请求摘要可计算且原有服务端状态条件允许时，保留之前“先读取，再明确确认重发同一内容”的路径，没有自动重发。

读取与摘要两个异步边界之后均检查组件是否仍挂载，迟到结果不回调父组件、不解锁旧表单、不发后续写请求。网络取消或页面离开不会被说成业务撤销。读取异常也保留未知。

现有唯一契约已经返回 `resolution.requestHash`，本修正不需要额外后端字段。API 已对其形状校验，表单额外对缺失字段保持防御；发现数据无法核对时只报告未知。

## 六文件范围

- 修改 `src/features/tool-operations/ToolOperationReconciliationForm.tsx`：固定任务归属、摘要比对及异步卸载保护。
- 修改 `tests/component/tool-operation-workbench.test.tsx`：仅测试环境、真实摘要夹具；原74条断言文本逐项一致，原46用例保留。
- 新增 `src/features/tool-operations/tool-operation-request-hash.ts`。
- 新增 `tests/component/tool-operation-request-hash.test.ts`。
- 新增 `tests/component/tool-operation-request-hash-form.test.tsx`。
- 新增本文。

不修改 Workbench、page、共享导航、原客户端适配、后端、契约、数据库、包或锁文件。其余1175个写前文件保持原SHA，包括原12包四份持久交付物。源表单与夹具的修改作为独立后续补丁，原12包保持不变。

## 新鲜定向验证

本轮直接把日志保存在 `qa/tool-operation-request-hash-d59-2026-10-09-verified/`，没有复用此前丢失日志，所有网络均为模拟，无生产写入或供应商调用。检查串行、Node堆1024MB，测试单worker。

| 检查 | 本轮实际结果 |
| --- | --- |
| Vitest：原3文件 + 新2文件 | 5文件69/69通过，含原46 + 新23；退出0；2026-10-09 19:33:08 Asia/Shanghai开始，19.81秒 |
| TypeScript Strict：表单、帮助模块、5测试及既有setup，递归真实依赖 | 8根，strict/noEmit开启、incremental关闭，0诊断，退出0 |
| ESLint：2代码 + 修改的原测试夹具 + 新2测试 | 5文件，max-warnings=0，0错误/警告，退出0 |
| 原断言保护 | 修改前后的原组件测试74条断言文本序列完全一致 |
| 写前文件保护 | 1177个写前文件中，除获准2项修改外1175个原字节一致 |

测试将真正的浏览器摘要与 Node 服务端算法逐字节比较，覆盖两种结论、中文与嵌套键序、原因去空格、数组/零/假/空值、同请求不同原因/回执、脱敏原因真正匹配、同操作标识同摘要但不同任务、缺失摘要、非安全/未知环境、缺失/失败能力、异常长度、读取/摘要迟到卸载及无自动重发。

```powershell
$env:NODE_OPTIONS='--max-old-space-size=1024'
pnpm exec vitest run --project component tests/component/tool-operation-client.test.ts tests/component/tool-operation-page.test.tsx tests/component/tool-operation-workbench.test.tsx tests/component/tool-operation-request-hash.test.ts tests/component/tool-operation-request-hash-form.test.tsx --maxWorkers=1 --fileParallelism=false
pnpm exec eslint src/features/tool-operations/ToolOperationReconciliationForm.tsx src/features/tool-operations/tool-operation-request-hash.ts tests/component/tool-operation-workbench.test.tsx tests/component/tool-operation-request-hash.test.ts tests/component/tool-operation-request-hash-form.test.tsx --max-warnings=0
```

Strict 按原tsconfig选项使用 TypeScript createProgram，只纳入上述8根与真实依赖。原始日志为本QA目录的 `vitest.log`、`strict.log`、`lint.log`；lint实际无输出，空输出文件与 `lint-result.json` 的实际退出0对应，串行检查退出结果另存 `check-results.json` 与交付清单。未运行全仓检查、build、native、Playwright或系统验收，不宣称满足合并门槛。

## 冻结交付

本QA目录持久保存写前 `before-files.json`（SHA `20D03D3600F70AAEC7DC36CD984FAE283769678E94FAFDA613CF98861F685295`）和两个获准修改文件的原字节 `.before`。新 `tool-operation-request-hash-d59.delta.patch` 仅包含上述六文件；同名 `.delta.json` 列出每项精确 `beforeSha256/afterSha256/changeType`、父包指纹、新鲜验证日志指纹和保护结果。主线先接原12包，再核对本修正两项before SHA并应用增量；本线只在自己的修改后源树检查补丁反向应用，未自行接入主线父组装。

本轮不 stage、commit、push、合并或部署；冻结后不改本修正包。
