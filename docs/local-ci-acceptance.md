# 本地完整验收

配置未齐时可单独运行 `pnpm acceptance:basic`。这不是完整入口的替代品：基础模式不读取 Neon 管理配置、不调用 Neon CLI、迁移、真实数据库、实际 Workflow、41 项守卫或浏览器；只在不可达数据库占位、模型模拟和隔离标记关闭状态下串行运行锁定安装、生产审计、类型生成、完整类型检查、严格 lint、全量单测、显式 helper 两项及构建。工作区仍必须干净且无共享 `.env` 文件，失败立刻停止，环境在 finally 恢复。

基础入口结束只报告“仅基础门禁通过；完整验收未执行”，不能据此合并或宣称 MVP 完整可用。GitHub CI 不可用时直接采用本地 `pnpm acceptance`，不等待 GitHub 恢复，也不降低同一最终提交的完整门禁、隔离清理与预览访问门槛。完整入口仍要求明确专用 Neon 测试项目，可以使用默认 API Key 路径或下述显式 CLI 会话路径；两入口的结果必须按同一提交分别记录。此前基础模式的模拟入口测试不代表本次登录与清理修改或新的最终组合已经通过。

GitHub Actions 对提交 `0a38c2a0fb544c199870c9300a794108fd1e1384` 的 PR53 运行 `37901806734` 未启动，权威注释指向付款或支出上限问题；具体账单原因未知。本地入口不改计费、不重触发该运行，也不绕过此前真正失败的断言。

独立、干净工作区提交本入口后运行 `pnpm acceptance`。需要 PowerShell 7、当前锁定的 Node/pnpm，以及当前进程中已人工确认专用测试项目的 `NEON_PROJECT_ID`。默认路径仍要求 `NEON_API_KEY`，不自动回退本机登录；入口不读取 GitHub Secrets，不要把凭据写入文件或聊天。本机已有来源不明的数据库地址不作为验收库；工作区存在实际 `.env` 配置文件时拒绝执行。

已通过正常 Neon CLI 登录的本机可显式运行 `pnpm acceptance -UseNeonCliSession`，没有默认 Key 的要求。可用 `-NeonProfile work` 明确选择已存在的登录配置；否则冻结当前 `NEON_PROFILE`，环境值未设置或为空字符串时冻结 `DEFAULT`。继承环境值非空但仅含空白时拒绝；显式提供的 profile 为空或仅含空白也拒绝，不静默改选默认配置。会话模式与任何非空 `NEON_API_KEY` 并存时直接拒绝，包括仅含空白的值；默认 API Key 路径则必须提供非空白 Key。仅提供 `-NeonProfile` 而不选择会话模式同样拒绝。入口不读取、复制、覆盖或创建登录缓存，不执行 `auth`、mint 或互动设置；CLI 自身可能正常刷新 OAuth 会话并原子更新其原有缓存，因此不能声称会话模式零缓存写入。

两种认证路径均冻结项目和认证参数，并把所有 CLI 命令的 `--context-file` 指向本次报告目录中的独立路径，不继承上级 `.neon`。API Key 路径继续使用本次空配置目录并暂时清空 profile；会话路径不覆盖 CLI 配置目录，保留默认、旧 `neonctl` 目录及显式环境目录的正常解析。`CI=1` 始终保留，缺失、失效或无权访问的登录只能失败，不能自动打开浏览器。完整安装前先静默执行项目限定的公开 API GET，要求返回项目身份与冻结标识严格一致；有效登录和项目访问不证明该项目已被人工确认可用于专用验收。

环境恢复区分原本不存在和原本存在的空字符串：原值为 null 时，仅删除既有管理常量清单中该精确 `Env:` 条目；其他值（包括空字符串）通过进程级接口原样恢复，不触碰机器、用户或未知环境变量。PowerShell 7.5+ 保留空环境值，不能把向字符串参数传 null 当作可靠删除，参见官方 [环境变量语义](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables?view=powershell-7.5)。新增缺失 profile、空 profile 环境值和混合管理变量快照的完整入口模拟覆盖；快照仅比较夹具受控值及条目是否存在，不读取真实凭据，这些用例仍未运行。

入口串行执行锁定依赖安装、生产依赖审计、类型生成、完整类型检查、严格 lint、全量单测、显式 helper 两项和构建。随后创建唯一 Neon 临时分支，要求真实返回的分支标识、随机名称及项目归属正确，再以已确认标识创建空 `ci_test` 数据库并获取连接；复制来的 `neondb` 不用于迁移或测试。只在空库完整迁移后为数据库和实际 Workflow 步骤设置隔离标记；后续关闭标记。

两个完整套件的 JSON 报告放在本次随机临时目录。本地守卫直接执行当前 `.github/workflows/ci.yml` 的真实数量检查代码，原 39 项和零参数两项必须全部实际通过，缺失、跳过或失败均拒绝。浏览器使用动态独立端口、不复用其他服务，完整规格串行执行，不占用用户的 3210。

临时分支创建结果不明也在 finally 尝试删除同一随机名称；确认创建标识后则只删除该标识。删除必须成功，随后用项目限定的公开 API GET 分支列表保留分页信息，每页固定 `sort_by=created_at`、`sort_order=asc`，避免按更新时间分页时因更新跨页漏读；若响应回显排序也必须严格一致。逐页检查分支归属和本次精确名称/标识，只在全部页均无本次目标且分页正常结束时确认清理，不用 `branches list` 单页缺失、子串检索、任意合法 JSON 或普通非零退出码冒充不存在。每页最多 100 条、最多 100 页；分页元数据缺失或未知字段（包括旧 `cursor` 形状）、存在却为空/null/非法的 `next`、重复游标/分支、空页带下一页、超界、读取失败或目标仍可见都阻止通过。正常最后页省略 `next`。这只能确认本次活跃分支不再可见，不声称取得跨页线性一致快照，也不证明可恢复数据已真正销毁。环境变量始终恢复。异常中断、断电或外部强制结束可能阻止 finally，必须人工按输出的分支名核对并清理，不得宣称清理完成。不要运行多个本地验收实例，不终止他人进程。测试服务关闭由 Playwright 和 Workflow 测试现有自有句柄收尾负责，不能以分支删除替代工作流终态检查。

上一版入口记录中专用 Neon 管理配置未齐，完整 `pnpm acceptance` 未执行。修改入口前冻结提交 `0a38c2a` 在独立 CI 工作区的类型、完整 lint、317 文件 2775 项单测、helper 两项和构建通过；这是基础门禁证据，不是修改后完整验收。本次会话兼容、项目预检、创建归属及严格分页清理仅完成实现与静态源检查，新增 Windows 实际 PowerShell 入口全模拟用例尚未运行；不启动真实 CLI、账户或数据库的模拟用例也不能代替真实数据库、Workflow、41 项守卫与 E2E。完成后须在精确最终提交重新完整验收，不能借用旧单项绿色结果。

验收入口通过也不自动证明受保护 Vercel 预览实际可访问或真实供应商可用；这两项仍需独立验收。代码后续变化必须在新的精确提交重新完整执行，不能沿用旧提交结果。

## CLI 与失败诊断核对

固定使用 `neonctl@5.0.1`，npm 元数据确认它依赖同版 `neon`；官方发布标签对应提交 `7572bcf6641b2d4ab83873fedae1321b0a8007b9`。官方 [分支源码](https://github.com/neondatabase/neon-pkgs/blob/7572bcf6641b2d4ab83873fedae1321b0a8007b9/packages/cli/src/commands/branches.ts) 的删除命令直接调用 `deleteProjectBranch`，没有交互确认或 force 参数。官方 [凭据中间件](https://github.com/neondatabase/neon-pkgs/blob/7572bcf6641b2d4ab83873fedae1321b0a8007b9/packages/cli/src/utils/middlewares.ts) 支持 Key 环境变量；[认证实现](https://github.com/neondatabase/neon-pkgs/blob/7572bcf6641b2d4ab83873fedae1321b0a8007b9/packages/cli/src/commands/auth.ts) 支持已有 profile、会话刷新及 CI 禁止互动登录；[配置路径实现](https://github.com/neondatabase/neon-pkgs/blob/7572bcf6641b2d4ab83873fedae1321b0a8007b9/internals/cli-core/src/paths.ts) 明确显式配置目录不回退默认登录。密钥不进入命令参数，入口结束后恢复其管理的环境。

官方 [API 透传实现](https://github.com/neondatabase/neon-pkgs/blob/7572bcf6641b2d4ab83873fedae1321b0a8007b9/packages/cli/src/commands/api.ts) 提供 `api [path] --method GET --query key=value`，输出完整响应数据而不裁掉分页。入口只用冻结项目路径执行 GET，不给该命令猜测额外 `--project-id`；创建、数据库、连接和删除命令仍显式传相同项目。分页规则依照官方 [分支列表接口](https://api-docs.neon.tech/reference/listprojectbranches) 的 `limit`、`cursor` 与 `pagination.next`，不把无法确认的响应当成空列表。

创建、空库创建、连接获取和校验、迁移及清理均记录安全阶段；异常保存阶段、分类和退出码，不回显原 HTTP、数据库错误正文或凭据。原执行失败与清理失败同时保留，任何清理不确定都阻止通过。Windows 用例实际解析并执行 PowerShell 函数，以假外部命令验证失败分类和脱敏；非 Windows 用例明确跳过，不能声称实际 PowerShell 已验证。数量守卫的模拟报告测试仍不等于实际41项通过。helper 本机旧冻结提交实际为2/2通过；完整入口配置未齐，修改后真实两项和完整门禁仍需重新执行。
固定版本官方全局选项允许 `NEON_API_HOST` 与 `NEON_OAUTH_HOST` 覆盖默认地址。本入口显式传入 `--api-host https://console.neon.tech/api/v2` 和 `--oauth-host https://oauth2.neon.tech`，在项目预检、创建、连接、删除与全部清理页保持同一官方认证/资源端点，不把自定义环境端点的返回当作隔离项目证明。原环境值不改写；mock 夹具故意设置非官方地址，逐条要求显式官方参数并核对其原值保留。新增两项完整入口模式回归尚未运行，不代表实际登录或 Neon 验收通过。来源为固定版本 [全局参数](https://github.com/neondatabase/neon-pkgs/blob/7572bcf6641b2d4ab83873fedae1321b0a8007b9/packages/cli/src/index.ts)。

同版本 [连接字符串命令](https://github.com/neondatabase/neon-pkgs/blob/7572bcf6641b2d4ab83873fedae1321b0a8007b9/packages/cli/src/commands/connection_string.ts) 已独立静态核对：显式分支、数据库及角色参数与入口一致，默认要求 TLS，普通模式输出原始 URI而非 JSON；入口只捕获、校验并用于本次空库，不回显。该源码核对不是实际 CLI 调用、权限或专用项目归属证据。
