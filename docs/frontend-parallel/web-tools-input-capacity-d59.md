# d59 网页填写总容量交接

日期：2026-10-09。源码根为 D:/Downloads/agent-studio-cloud/.worktree-cache/frontend-web-tools-d59，分支 codex/frontend-web-tools-d59，提交 d59bf84ec5902f07441e321537bd39345e4a30b1。本轮基于任务开始时 1164 个已有文件的精确字节快照，不以 Git 提交差异替代增量边界。

## 行为变化

网页填写区不再给每项文字、数字、对象和列表设置 4000 字符的浏览器截断。原始长文、换行、空白和结构化草稿继续完整保留在当前页面状态中；展开、布局切换、检查格式、取消试运行确认、超限提示和取消清空均不截断或替换填写值。清空仍需确认，试运行仍走原有确认与请求锁定。

总容量复用现有共享契约 RunInputPayload 与 MAX_RUN_INPUT_BYTES，当前为 100 * 1024，即 102400 字节，没有扩大服务端上限。新纯函数 previewInputCapacity(fields, values) 只返回 number | null，使用与 preparePreviewInput 相同的字段转换，再计算 JSON.stringify 后的 UTF-8 字节数，包含字段名、引号、转义和数据结构。数字、是或否、对象和列表按实际转换后的提交值计算；选填空值及原有未声明字段忽略规则保持不变。

转换尚未完成、必填缺失或深层草稿无法序列化时显示容量未知，不伪造准确数值。单项字符计数只是原始填写值的 JavaScript 字符串长度，不能替代总字节容量、格式核对或业务正确性。

preparePreviewInput 的公开返回结构不变，最终仍由 RunInputPayload.safeParse 校验全部共享约束。总输入恰好等于上限可通过；多一字节或多项合计超限时 input 为 null，完整填写留在页面，并明确提示没有启动任务。字段保留字、结构深度和列表数量等已有约束继续生效。超限时检查与试运行均不会进入任务确认或调用 startRunAction；修正后仍需原有单独确认才能提交完整值。

## 精确六文件范围

| 操作 | 路径 | 范围 |
| --- | --- | --- |
| 修改 | src/features/web-tools/WebToolInputPreview.tsx | 移除两处 maxLength，增加真实总容量提示，保留原确认流程 |
| 修改 | src/features/web-tools/preview-input.ts | 共用转换逻辑、UTF-8 总容量与共享契约超限提示 |
| 修改 | tests/component/web-tool-form-usability.test.tsx | 仅更新一条字符计数文案断言，测试数 4 → 4 |
| 修改 | tests/component/web-tool-trial-run.test.tsx | 仅更新一条超限错误文案断言，保留原超限拦截行为，测试数 10 → 10 |
| 新增 | tests/component/web-tool-input-capacity.test.tsx | 16 项容量、完整保留与启动边界测试 |
| 新增 | docs/frontend-parallel/web-tools-input-capacity-d59.md | 本交接记录 |

原两份测试的两条文案更新已获主线明确授权。没有修改真实运行和结果父组件、保存输入覆盖组件、画布父组件、共享契约、后端、数据库、依赖、锁文件或项目配置。

## 验证证据

最终定向 Vitest：4 个文件，33 项通过；新增容量测试 16 项、原表单易用性 4 项、原试运行 10 项、未修改的输入预览回归 3 项。最终日志起始时间 15:40:24，耗时 28.36 秒。不累加此前批次或中间 32 项运行数，不作为全量门禁。

覆盖超过 4000 字符的多行填写与实际粘贴、102400 字节精确边界和加一字节、中文与表情 UTF-8、转义及字段名开销、多字段合计超限、长数字原文和实际转换、长结构草稿、必填与格式未知、已有保留字及列表数量约束、极深结构不崩溃、超限不启动、修正后完整提交、取消确认、布局与展开、确认清空。

执行命令使用 NODE_OPTIONS=--max-old-space-size=1024：

    pnpm exec vitest run --project component --maxWorkers 1 --no-cache --no-fsModuleCache tests/component/web-tool-input-capacity.test.tsx tests/component/web-tool-form-usability.test.tsx tests/component/web-tool-trial-run.test.tsx tests/component/web-tool-input-preview.test.tsx

本轮两个源码与三个测试文件的 ESLint 使用 --no-cache --max-warnings 0，退出码 0、零警告。外置叶级 Strict 配置继承当前项目 tsconfig，strict=true、noEmit=true、incremental=false；包括本轮源码与测试及相邻输入预览回归，tsc 退出码 0。外置配置与日志均在可视化交接目录，不进入六文件增量。

已读取当前安装的 Next.js 16.3.8 的 node_modules/next/AGENTS.md、use-client、forms 和 mutating-data 文档，保持现有客户端状态与 Server Action 调用边界。

## 导入与冻结

增量顺序为公共 366 文件基线 → Web 六文件 → slots 两文件 → Root5 → 组合八文件 → 复制提示两文件 → 交付试算四文件 → 保存输入覆盖三文件 → 本轮容量六文件。前四个修改路径须先匹配本轮清单的 beforeSha256，再应用本轮独立补丁并匹配 afterSha256；两个新增路径须不存在。

补丁、清单、四个精确前像、六个后像、最终局部日志和基线快照输出至 C:/Users/Administrator/.codex/visualizations/2026/10/09/01a11eb2-ce0d-7c00-9608-f92981ab4981/web-tools-input-capacity。已有冻结包保持原 SHA。本轮交给主线、Git 和 CI 后冻结，不包含其他域的组装候选。

未启动或更改 3210 进程，未执行浏览器、完整 CI、构建或 Playwright；未访问数据库或模型服务。完整门禁由 CI 统一排队。本轮没有暂存、提交、推送、合并、发布或部署。
