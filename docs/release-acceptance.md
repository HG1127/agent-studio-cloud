# 合并与上线前验收

每次验收针对最终准备合并或上线的提交进行；验收后若代码变化，重新验收。GitHub CI 与本地脚本执行同一组质量检查，并在隔离的 Neon 分支上运行数据库及浏览器测试。Vercel 预览可访问是两种方式共同的合并门槛。

## 先判断 GitHub CI 能否免费运行

1. 查看仓库所有者的 [GitHub Actions 用量与免费额度](https://github.com/settings/billing/usage) 和 [预算](https://github.com/settings/billing/budgets)。私人仓库使用 GitHub 托管 runner 会消耗账户每月免费分钟。先确认没有可产生超额费用的设置：例如账户没有有效付款方式，或 Actions 的 $0 预算启用了“达到限额停止使用”。无法确认免费额度与费用上限时，直接走本地验收。
2. 额度不足时直接走本地验收。只有确认本次运行不会产生额外付费，才在仓库 **Actions → CI → Run workflow** 中选择待验收分支手动触发。当前 CI 不随 push 或 PR 自动运行。若因账单限制在 runner 启动前失败，改走本地验收；若测试本身失败，先修复问题，不得切换方式绕过失败。
3. GitHub 的手动运行入口要求工作流文件已在默认分支。此流程首次合并前，直接使用本地验收。

不要为验收添加付款方式或调高预算。GitHub Free 私人仓库的标准 runner 免费分钟按月重置；无有效付款方式时，超出额度的使用会被阻止。[GitHub 计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

## 本地完整验收

本机需要 Node.js 24、pnpm 11、PowerShell 7，以及 Neon 项目的分支创建权限。先关闭占用本地 3210 端口的开发服务。首次使用可运行 `npx --yes neonctl@5 auth` 在本机登录一次；此后每次只需设置非密钥的项目 ID：

```powershell
$env:NEON_PROJECT_ID = "你的 Neon 项目 ID"
pnpm acceptance
```

若不使用 Neon CLI 登录，也可在当前终端以安全输入方式设置 `NEON_API_KEY`，运行后清除；不要发到聊天中或提交到仓库：

```powershell
$secureKey = Read-Host "Neon API key" -AsSecureString
$env:NEON_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
pnpm acceptance
Remove-Item Env:NEON_API_KEY
```

`acceptance.ps1` 先运行锁定依赖安装、生产依赖审计、Next.js 类型生成、TypeScript、lint、单元与组件测试和生产构建。全部通过后，脚本创建唯一的临时 Neon 分支，覆盖当前进程中的数据库连接变量，执行迁移、集成测试、Workflow 测试、Playwright E2E，最后删除临时分支。即使本地 `.env.local` 指向共享数据库，测试也不会直接对该连接执行写入。临时分支清理失败视为验收失败，应在 Neon 控制台按脚本输出的分支名检查并删除。

本地脚本失败时，修复原因并重新完整运行；不要只运行失败的单项测试后标记为通过。若未登录 Neon CLI、也没有 Neon API key，或缺少项目 ID，则完整本地验收尚不可运行。

本地验收只迁移临时分支，不会修改生产数据库。生产迁移仍是单独的上线步骤；现有生产迁移 GitHub 工作流也会受到同一 runner 计费限制。
自动测试使用演示模型；真实模型接口连通性需要在受控环境另行验证。

## 验收记录

在 PR 或上线记录中写明：验收提交、方式（GitHub CI 运行链接或本地脚本）、结果、Vercel 预览地址与检查结果。若 GitHub 分支保护把 CI 状态设为必需检查，需按此验收流程调整该规则，否则本地验收通过后仍无法合并。
