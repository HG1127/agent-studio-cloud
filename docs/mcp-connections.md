# MCP 连接检查后端

本线仅修改连接契约、领域纯函数、查询、只读检查工具、接口、测试和本说明。执行工具注册表与调用核心均沿用核心提交 62c30f7，不修改页面、模型连接或定时配置。

## 登记与发现

管理员仍通过服务端 `TOOL_REGISTRY_JSON` 登记；没有新的连接配置来源，没有浏览器登记地址/凭据入口。只检查 `protocol: "mcp-streamable-http"` 的登记项。MVP 每个已登记工具是一个检查入口，连接标识就是其 `registryToolId`，即使同一地址有多个工具也分别检查，保证不同凭据不会串用。工作区使用现有演示工作区，其他工作区不返回登记且不连接。

`GET /api/mcp/connections` 返回 `{ connections: [{ id, name }] }`。只投影管理员名称与内部选择标识；UI 应展示中文名称，内部标识不应显示给用户。响应禁止缓存。

`POST /api/mcp/connections/check` 只接受严格 JSON `{ connectionId }`（最多 1KB），必须带与请求地址一致的 Origin。地址、凭据、工作区、任意附加字段均被拒绝。未知标识返回 404 且零网络。当前 MVP 无新增登录权限；后续 Auth.js 接入需将演示工作区改成服务端认证上下文，不接受浏览器工作区覆盖。

检查结果是 `{ status, message, tools: [{ registryToolId, name, status }] }`，定义见 `src/contracts/mcp-connection.ts`。总体状态区分 `available`、`credentials-rejected`、`protocol-error`、`unavailable`、`definition-changed`、`not-found`、`configuration-error`。目录缺失、输入定义漂移均标记不可用；可用只表示握手与登记定义核对通过，不代表执行成功、写入防重或业务授权已经验证。

## 安全与协议边界

- 使用核心锁定的官方 `@ai-sdk/mcp` 2.0.73，不升级依赖树；关闭自动协议发现和重试，不配置 OAuth。
- 实际协议请求只允许 `initialize`、`notifications/initialized`、`tools/list`。绝不调用 `tools/call`，不接受额外 JSON-RPC 方法。SDK 的独立 GET 事件订阅在本地返回 405，检查不订阅服务端事件；POST 响应携带的 SSE 仍由 SDK 解析。
- 沿用执行注册表的 HTTP/HTTPS 地址约束，禁止 URL 用户密码，兼容管理员已登记的本机 HTTP 与查询参数；登记地址经 new URL(endpoint).href 规范化后作为固定传输目标和唯一比较基准，兼容根地址尾斜线和主机大小写，不接受其他目标或重定向。Cookie、代理凭据、Host 与连接控制头等配置被拒绝；请求明确省略浏览器凭据，移除 Cookie 与业务防重头。管理员必须登记可信服务地址。单项额外检查限制（如 Cookie 头、定义容量）仅使该登记项返回 configuration-error，不隐藏其他合法连接；核心注册表整体无效时沿用其整体拒绝策略。
- 检查时限 10 秒，会话关闭另限 1 秒，最多 12 次检查输送请求和 1 次会话关闭请求，最多 5 页、100 个工具，每个定义最多 64KB，总响应字节最多 1MB；拒绝分页游标重复、跨页名称重复、非法 UTF-8、超额和非法目录。原始错误、远端名称描述和未登记定义都不会进入响应或日志。
- 只核对已登记 action 和输入定义，字段顺序不影响结果。现有注册表的 outputSchema 用于执行回执验证，不能当成远端必定声明的 outputSchema；检查不声称验证了实际回执。领域函数支持显式登记的输出定义核对，当前查询适配未启用。
- 检查结束关闭本地连接、取消读流；若 SDK 建立了会话，仅向相同登记地址发送一次限时 DELETE 关闭会话，清理失败不改变检查结论；连接检查不持久化业务数据，也不修改或自动新增执行登记。API 的可用结果只能作为绑定选择的提示，真正执行仍由核心调用时重新核对目录，防止检查之后的漂移。

## 验证分工

本地执行契约/领域/查询/路由单测、SDK 模拟输送单测，以及本机动态端口的真实 HTTP 假 MCP 服务测试、类型检查、lint。本机假服务测试经真实注册表查询及 API 入口验证 initialize、notifications/initialized、tools/list，断言 tools/call 为零，并在结束时清理服务与环境配置。没有真实数据库、Workflow、端到端或迁移，也不取消或重跑已有远端 CI。

Git 专用对话负责提交/推送/PR，CI/CD 专用对话负责精确提交的全量 CI、构建与预览，以及服务端配置的真实握手/目录验收。远端需要可信 MCP 服务及管理员 TOOL_REGISTRY_JSON；凭据只配置在服务端，不能发进聊天或测试输出。

本地验证记录：4 个测试文件、32 项测试通过；tsc --noEmit 与改动范围 ESLint 通过。模拟输送及真实本机 HTTP 假服务测试通过，真实外部连接可用性尚待远端验收。
