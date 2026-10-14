# 已登记 MCP 远端名称修复

分支 `codex/mvp-mcp-registered-tool-names` 从完整基底 `d96371a4e2a9039b06290497606668445ec15405` 接续。原 PR49/d59 保持不动。本修复不改连接检查器、请求预算、检查器测试、前端、模型连接、定时配置或迁移。

## 问题与结果

内部登记 `id` 与远端 `action` 是不同字段。旧登记限制首位字母数字且最多 100 字符，合法 `_helper`、101–128 字符远端名称会被拒绝；放开登记后，连接登记的 action 复用内部 ID 契约、写操作载荷的 action 上限 100 又会分别拒绝它们。

`McpRemoteToolName` 统一定义在 `src/contracts/mcp-tool.ts`，允许 1–128 个英文字母、数字、点、连字符或下划线。连接模块继续转导出旧同名符号，现有使用者无需改字段或导入地址。MCP 登记与连接登记使用它；HTTP 或未填协议仍保留操作名称 100 字符限制，内部 id、scope、connectionId 的原约束保持。工作流绑定严格相等保持，业务写入载荷仅容纳完整 128 字符，不增加协议字段。

ToolRegistryOption 的协议条件校验通过 Zod object refinement 实现；服务端 ToolRegistration 使用 safeExtend 保留该校验并兼容 Zod4。已搜索全部 extend/shape/pick/omit 使用者：唯一扩展在服务端登记，模板仅使用 shape.id，已有字段、默认值、协议枚举、普通登记 JSON 序列化均保持。

数据库 action 列已是 text，无需迁移。keyHash 和 requestHash 的材料/算法不改；普通旧名称用固定 JSON 材料验证哈希一致。完整名称被保存在模板快照、已绑定编译结果、账本与实际 SDK tools/call.name 中，不截断，不自动新增登记。

## 本地与远端验证

先复现旧登记、连接与载荷限制以及模板的拒绝，再修复。新专项覆盖 _helper、101/128 字符读写登记、连接检查、模板快照、已绑定编译、模拟数据库账本入口、完整 SDK 调用和旧序列化/哈希；129/非法字符、HTTP101、内部非法/超长 id、scope101、绑定/请求名称不一致仍拒绝。

本机动态端口假 MCP 服务供真实官方 SDK 对照：先经真实登记查询只读检查，断言 tools/call 为零；再单独执行，断言唯一 tools/call.name 与完整登记名称一致，0/false 回执保持。测试关闭端口并恢复环境，只使用测试数据。模拟账本通过 vi.mock，未访问真实数据库。

`tests/integration/mcp-registered-tool-names.test.ts` 和 `tests/workflow/mcp-registered-tool-names.test.ts` 已书写但本地未执行，复用现有 MVP_ACCEPTANCE_ISOLATED_DB 显式隔离开关。各验证三种远端名称：真实账本完整保存 action、第二次运行复用相同回执、只调用一次；Workflow 两次真实持久运行均完成且保持零值/否定值，完整名称只发送一次。

远端门禁须使用本修复的新精确提交，不能继承 d963 的旧结果；该基底 CI 的旧 ci-integration-budget 契约失败已由 CI 专用线处理，本线未修改 CI。CI 专用线需执行新 integration/Workflow 断言及完整 CI、构建、E2E、Vercel 访问。本地禁止真实数据库、Workflow、E2E、迁移，不取消或重跑已有远端 CI。

本地最终记录：12 个指定测试文件、224 项测试通过；低堆（1536MB）tsc --noEmit 与改动范围 ESLint 串行执行，均 exit 0；git diff --check 通过。新增专项本身为 4 文件 35 项。真实隔离数据库和 Workflow 两个新增文件共 6 项仍未在本地运行，不能标绿。

## 单次测试失败/超时的清理补充

已安装 @workflow/vitest 4.0.25 的 dist/setup-file.js 只在 afterAll 调用 teardownWorkflowTests，后者关闭当前 World；@workflow/world-local 4.4.1 的 close 关闭投递队列/HTTP agent。它们没有在本套件每个 afterEach 逐句柄取消，不能替代单次失败后先停止自有运行再删行。

本套件现在保存每次 start 返回的 SDK 句柄。afterEach 只遍历该数组；已 completed/failed/cancelled 的句柄不再次取消，其他状态（或状态读取失败）尝试 cancel 并再次确认终态。SDK core 4.8.9 的 Run.cancel 创建本 run 的 run_cancelled 事件，status 从该 World 的对应 run 读取；没有枚举全局运行或调用全局 World teardown。

所有自有句柄都尝试清理，任一取消/终态确认失败会显式抛出 AggregateError 并跳过数据库删除、保留记录供隔离验收定位；无论该步成功与否都尝试关闭假服务及恢复环境。成功确认终态后才删除本套件记录。取消的确认是引擎终态，不声称立即撤销已经发生的外部副作用；测试服务器关闭使残余连接结束。清理钩子单独限时60秒。

本补充只改本套件Workflow测试/说明，新增本套件清理helper和模拟单测，原13文件提交不改写。模拟验证涵盖活动句柄、三个终态、状态读取失败、单个取消失败仍处理其他自有句柄、未确认停止显式失败以及外部句柄不被取消。若 start 尚未返回句柄，本套件数据库行另记入 pending 集合；清理会显式失败并保留数据库记录，不凭未关联信息猜测引擎运行或删除数据。未在本地启动真实引擎或数据库；最终候选仍需CI执行既有6项真实断言和39项实际数量守卫。

清理补充本地验证：默认Vitest仅运行 tests/domain/mcp-registered-tool-name-cleanup.test.ts，8项模拟测试通过；1536MB低堆类型检查与3个TS文件范围ESLint串行通过；实际数据库/Workflow未运行，原6项实际验收及39数量守卫仍交CI。
