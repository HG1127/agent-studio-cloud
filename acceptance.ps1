param([switch]$BasicsOnly)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$stage = "预检查"
$failureCategory = "preflight"
$failureExitCode = $null
function Set-Stage {
  param([string]$Label, [string]$Category = "external-command")
  $script:stage = $Label
  $script:failureCategory = $Category
  $script:failureExitCode = $null
  Write-Host "→ $Label"
}

function Invoke-NeonQuiet {
  param([string]$Label, [string[]]$Arguments)
  Set-Stage $Label "neon-command"
  & npx --yes neonctl@5.0.1 @Arguments *> $null
  $script:failureExitCode = $LASTEXITCODE
  if ($LASTEXITCODE -ne 0) { throw "Neon阶段失败。" }
}

function Invoke-Checked {
  param([string]$Label, [string]$Command, [string[]]$Arguments)
  Set-Stage $Label
  & $Command @Arguments 2>&1 | ForEach-Object {
    $line = [string]$_
    $sensitiveNames = @("DATABASE_URL", "DATABASE_URL_POOLED", "MODEL_ENCRYPTION_KEY", "CRON_SECRET")
    if (-not $BasicsOnly) { $sensitiveNames += "NEON_API_KEY" }
    foreach ($name in $sensitiveNames) {
      $secret = [Environment]::GetEnvironmentVariable($name, "Process")
      if ($secret) { $line = $line.Replace($secret, "[已隐藏]") }
    }
    Write-Host ($line -replace 'postgres(?:ql)?://[^\s"'']+', '[已隐藏数据库连接]')
  }
  $script:failureExitCode = $LASTEXITCODE
  if ($LASTEXITCODE -ne 0) { throw "$Label 失败（退出码 $LASTEXITCODE）" }
}

if (-not $BasicsOnly) {
foreach ($name in @("NEON_PROJECT_ID")) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
    throw "缺少 $name；完整验收未执行。请配置专用测试项目，不使用共享数据库。"
  }
}
}
foreach ($file in @(".env", ".env.local", ".env.test", ".env.test.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local")) {
  if (Test-Path -LiteralPath $file) { throw "验收工作区含 $file；请使用不加载共享配置的独立工作区。" }
}
$dirty = (& git status --porcelain) -join ""
if ($LASTEXITCODE -ne 0 -or $dirty) { throw "验收工作区必须干净，提交入口变更后重新完整验收。" }
$managed = @("DATABASE_URL", "DATABASE_URL_POOLED", "MODEL_MOCK", "REAL_MODELS_ENABLED", "MVP_ACCEPTANCE_ISOLATED_DB", "MODEL_ENCRYPTION_KEY", "CRON_SECRET", "CI", "NODE_OPTIONS", "PLAYWRIGHT_PORT", "PLAYWRIGHT_REUSE_SERVER", "LOCAL_ACCEPTANCE_REPORTS", "NEON_PROFILE")
$original = @{}
foreach ($name in $managed) { $original[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
$branchName = "local-acceptance-$([Guid]::NewGuid().ToString('N'))"
$reports = Join-Path ([IO.Path]::GetTempPath()) $branchName
$null = New-Item -ItemType Directory -Path $reports
$creationAttempted = $false
$failure = $null
$cleanupFailed = $false
$neonArgs = @()
if (-not $BasicsOnly) {
  $neonArgs = @("--project-id", $env:NEON_PROJECT_ID, "--no-analytics")
  if (-not [string]::IsNullOrWhiteSpace($env:NEON_API_KEY)) {
    $neonArgs += @("--config-dir", (Join-Path $reports "neon-config"))
  }
}
$head = (& git rev-parse HEAD) -join ""
if ($LASTEXITCODE -ne 0) { throw "不能确认验收提交。" }
Write-Host "验收提交：$head；报告目录：$reports"

try {
  if (-not [string]::IsNullOrWhiteSpace($env:NEON_API_KEY)) { $env:NEON_PROFILE = $null }
  $env:DATABASE_URL = "postgresql://ci:ci@127.0.0.1:1/unavailable"
  $env:DATABASE_URL_POOLED = $env:DATABASE_URL
  $env:MODEL_MOCK = "1"
  $env:REAL_MODELS_ENABLED = "0"
  $env:MVP_ACCEPTANCE_ISOLATED_DB = "0"
  $env:CI = "1"
  $env:PLAYWRIGHT_REUSE_SERVER = "0"
  $env:MODEL_ENCRYPTION_KEY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  $env:CRON_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  $env:NODE_OPTIONS = "--max-old-space-size=1536"
  Invoke-Checked "锁定依赖安装" "pnpm" @("install", "--frozen-lockfile")
  Invoke-Checked "生产依赖审计" "pnpm" @("audit", "--prod", "--audit-level", "high")
  Invoke-Checked "路由类型生成" "pnpm" @("exec", "next", "typegen")
  Invoke-Checked "完整类型检查" "pnpm" @("exec", "tsc", "--noEmit")
  $env:NODE_OPTIONS = "--max-old-space-size=768"
  Invoke-Checked "完整代码规范" "pnpm" @("exec", "eslint", ".", "--no-cache", "--max-warnings=0")
  Invoke-Checked "全量单测" "pnpm" @("exec", "vitest", "run", "--maxWorkers=1", "--no-cache", "--no-fsModuleCache")
  Invoke-Checked "显式恢复假服务两项" "pnpm" @("exec", "vitest", "run", "--config", "tests/helpers/mvp-acceptance-recovery.config.mts", "--maxWorkers=1", "--no-cache")
  $env:NODE_OPTIONS = "--max-old-space-size=1536"
  Invoke-Checked "完整生产构建" "pnpm" @("build")

  if (-not $BasicsOnly) {
  $creationAttempted = $true
  Invoke-NeonQuiet "创建临时分支（失败可能已创建，仍严格清理）" (@("branches", "create", "--name", $branchName) + $neonArgs + @("--output", "json"))
  Invoke-NeonQuiet "创建临时空库ci_test" (@("databases", "create", "--name", "ci_test", "--branch", $branchName, "--owner-name", "neondb_owner") + $neonArgs + @("--output", "json"))
  Set-Stage "获取临时空库连接" "neon-command"
  $branchUrl = (& npx --yes neonctl@5.0.1 connection-string $branchName --database-name ci_test --role-name neondb_owner @neonArgs 2>$null) -join ""
  $failureExitCode = $LASTEXITCODE
  if ($LASTEXITCODE -ne 0) { throw "临时空库连接获取失败。" }
  Set-Stage "验证临时空库连接归属" "invalid-isolated-url"
  $parsedUrl = $null
  if (-not [Uri]::TryCreate($branchUrl, [UriKind]::Absolute, [ref]$parsedUrl) -or $parsedUrl.Scheme -notin @("postgres", "postgresql") -or $parsedUrl.AbsolutePath -ne "/ci_test" -or $parsedUrl.Host -notmatch '\.neon\.tech$') {
    throw "未确认临时空库的有效连接；拒绝迁移或执行。"
  }
  $env:DATABASE_URL = $branchUrl
  $env:DATABASE_URL_POOLED = $branchUrl
  Invoke-Checked "迁移本次临时空库" "pnpm" @("db:migrate")
  Invoke-Checked "迁移后类型生成" "pnpm" @("exec", "next", "typegen")
  $env:NODE_OPTIONS = "--max-old-space-size=768"
  $env:MVP_ACCEPTANCE_ISOLATED_DB = "1"
  Invoke-Checked "完整隔离数据库验收" "pnpm" @("exec", "vitest", "run", "--config", "vitest.integration.config.mts", "--maxWorkers=1", "--reporter=default", "--reporter=json", "--outputFile=$(Join-Path $reports 'integration-results.json')")
  Invoke-Checked "完整实际 Workflow 验收" "pnpm" @("exec", "vitest", "run", "--config", "vitest.workflow.config.mts", "--maxWorkers=1", "--reporter=default", "--reporter=json", "--outputFile=$(Join-Path $reports 'workflow-results.json')")
  $env:MVP_ACCEPTANCE_ISOLATED_DB = "0"
  $env:LOCAL_ACCEPTANCE_REPORTS = $reports
  Invoke-Checked "同一运行实际41项数量守卫" "node" @("scripts/check-local-acceptance.mjs")
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { $env:PLAYWRIGHT_PORT = [string]$listener.LocalEndpoint.Port } finally { $listener.Stop() }
  Invoke-Checked "安装浏览器" "pnpm" @("exec", "playwright", "install", "chromium")
  Invoke-Checked "完整浏览器验收" "pnpm" @("exec", "playwright", "test", "--workers=1")
  }
} catch {
  $exitDescription = if ($null -eq $failureExitCode) { "未返回" } else { [string]$failureExitCode }
  $failure = "验收失败：阶段=$stage；分类=$failureCategory；退出码=$exitDescription。后续未执行项不算通过。"
  Write-Host $failure
} finally {
  try {
    if ($creationAttempted) {
      Invoke-NeonQuiet "严格删除本次临时分支" (@("branches", "delete", $branchName) + $neonArgs)
      Set-Stage "确认临时分支已删除" "cleanup-list-command"
      $remaining = (& npx --yes neonctl@5.0.1 branches list @neonArgs --output json 2>$null) -join ""
      $failureExitCode = $LASTEXITCODE
      if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remaining) -or $remaining.Contains($branchName)) { throw "无法确认临时分支已经删除。" }
      Set-Stage "核对清理确认JSON" "cleanup-invalid-json"
      $null = ConvertFrom-Json -InputObject $remaining -ErrorAction Stop
    }
  } catch {
    $cleanupFailed = $true
    $exitDescription = if ($null -eq $failureExitCode) { "未返回" } else { [string]$failureExitCode }
    $cleanupDiagnostic = "阶段=$stage；分类=$failureCategory；退出码=$exitDescription"
  }
  finally {
    foreach ($name in $managed) { [Environment]::SetEnvironmentVariable($name, $original[$name], "Process") }
  }
}
if ($cleanupFailed) { throw "原失败=$failure；临时分支 $branchName 清理未确认：$cleanupDiagnostic；验收不算通过，请人工核对。" }
if ($failure) { throw $failure }
if ($BasicsOnly) {
  Write-Host "仅基础门禁通过；完整验收未执行：真实数据库、Workflow、41项实际数量守卫、E2E和预览访问均未验证。"
} else {
  Write-Host "本地完整门禁通过；Vercel保护预览访问和真实供应商仍需独立验收。"
}
