# 连接配置状态只读叶子（未功能验证）

本包只新增真实配置诊断卡片，将其接到实际外部连接父页、已登记连接检查的上方。不覆盖此前 sealed MCP7、protocol7 或 protocol-r2，不改中央能力定义、管理权限、服务端、契约或依赖。

## 实际契约与边界

只调用 `GET /api/mcp/connections/configuration`，使用真实 `McpConnectionConfigurationResult.safeParse`。d43 handler 返回 `Cache-Control: no-store`；查询只读取服务端登记快照并进行本地配置投影，不握手、不读远端目录、不执行业务工具，不访问数据库或写入配置。

目标后端：`d43e22227f43fb8cc39238b3f96e113d5219ea2b`。

| 只读依赖 | 目标文件 SHA256 |
| --- | --- |
| `src/contracts/mcp-connection.ts` | `429CD52B1E2D9274934199155DC10C9DEE9C0B2C2CD61E6BD0B217121472D137` |
| `src/app/api/mcp/connections/configuration/route.ts` | `04DD6FF685C41A18EEB41E8804053CB9AA8F25C2A4134FFD1D5D21711A926F38` |
| `src/server/queries/mcp-connections.ts` | `BFA5B88306CBDB828B292830E0F5BA1BBF4C9C91CD50779B3BF9284ACE3B0793` |
| `src/server/domain/mcp-configuration.ts` | `613A0BA6C1C845E5F45862A9BABA1D3FC42C7CA99D57C336DFFFC99EAF5F0193` |

作者独立树仍是 d59 后端；其契约缺少新增导出，配置 handler/domain 文件也不存在。本包明确依赖目标 d43 的实际共享契约，不复制或改写契约，不在作者树声称可编译或已验证。所有功能验证必须由专用 CI/CD 对话在最终同代码目标完成。

## 中文状态

| 返回状态 | 页面说明 |
| --- | --- |
| `configured` | 已配置，仅本地声明通过，尚未检查远端服务 |
| `partially-configured` | 部分配置需要处理，保留各项配置状态 |
| `not-configured` | 尚未登记连接，只有此状态可明确表示未配置 |
| `configuration-error` | 配置错误；空诊断项仍是全局配置无效，不当作未配置 |

请求失败或非成功状态使用独立读取失败提示；JSON 或共享契约不合法使用独立未知提示。共享 strict 契约拒绝矛盾状态、重复登记标识、私有额外字段和越界数量。展示只使用验证通过的安全 DTO 名称及本地枚举文案，不展示响应 message、异常正文、内部标识、地址、请求头、输入定义或凭据，不写入浏览器持久存储。

## 读取与范围保护

正常挂载读取一次本地配置，手动重读只调用同一 GET，不自动重试或检查远端。事件 handler 通过同步请求引用立即互斥，不依赖按钮旧渲染。每次请求有代次；layout 卸载清理先失效代次并中止浏览器读取。忽略中止的迟到 fetch/body 回复不能写入另一组件实例；Strict Mode 的旧效果回复同样失效。重新读取时不将旧快照显示成当前结果。

配置快照与批量检查独立，互不注入或清空结果。不用登记名称、标识或条目数量猜服务器关系，不自动连接两个不同时间的响应。当前后端归属固定由服务端裁定，不增加客户端工作区选择或归属标识；未来引入归属切换必须为实际归属建立独立生命周期，不能沿用旧快照。

旧 V5.7 `ResourceHubV20.tsx` 的地址/凭据编辑、保存并测试、发现、删除及账号授权属于另一套管理服务。这里不移植这些按钮，不伪造云端尚未提供的管理接口。

## 五文件范围与规格

- 新增 `src/features/connections/McpConfigurationStatus.tsx`。
- 修改 `src/app/(console)/connections/page.tsx`，只增加真实组件 import 与上方组合。
- 新增 `tests/component/mcp-configuration-status.test.tsx`，真实组件只替换 fetch I/O：四枚举、读取失败/未知、敏感字段拒绝、即时互斥、迟到 fetch/body、卸载与 Strict Mode。
- 新增 `tests/e2e/mcp-configuration-status-desktop.spec.ts`，不路由 mock、不种数据、不造成功结果。先监听真实 GET 完整响应并解析共享契约，再按实际枚举与条目计数断言，手动重读真实 GET；监视无写请求、连接检查或业务工具调用。
- 本独立说明。

补丁通过新临时 Git 上下文原生 `git diff --output` 机械生成，不经过 PowerShell stdout 拆行；严格正向检查/应用与反向检查/恢复、前后 SHA 只证明补丁字节一致，不是功能 CI。

`checks=false`、`release=false`。未执行安装、依赖审计、类型生成、类型检查、lint、Vitest、构建、数据库/Workflow 集成、Playwright、浏览器或 acceptance；未提交、推送、合并或部署。
