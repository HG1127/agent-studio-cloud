param()

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Checked {
  param([string]$Label, [string]$Command, [string[]]$Arguments)
  Write-Host "→ $Label"
  & $Command @Arguments 2>&1 | ForEach-Object {
    $line = [string]$_
    foreach ($name in @("NEON_API_KEY", "DATABASE_URL", "DATABASE_URL_POOLED", "MODEL_ENCRYPTION_KEY", "CRON_SECRET")) {
      $secret = [Environment]::GetEnvironmentVariable($name, "Process")
      if ($secret) { $line = $line.Replace($secret, "[已隐藏]") }
    }
    Write-Host ($line -replace 'postgres(?:ql)?://[^\s"'']+', '[已隐藏数据库连接]')
  }
  if ($LASTEXITCODE -ne 0) { throw "$Label 失败（退出码 $LASTEXITCODE）" }
}

foreach ($name in @("NEON_PROJECT_ID", "NEON_API_KEY")) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
    throw "缺少 $name；完整验收未执行。请配置专用测试项目，不使用共享数据库。"
  }
}
foreach ($file in @(".env", ".env.local", ".env.test", ".env.test.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local")) {
  if (Test-Path -LiteralPath $file) { throw "验收工作区含 $file；请使用不加载共享配置的独立工作区。" }
}
$dirty = (& git status --porcelain) -join ""
if ($LASTEXITCODE -ne 0 -or $dirty) { throw "验收工作区必须干净，提交入口变更后重新完整验收。" }
$managed = @("DATABASE_URL", "DATABASE_URL_POOLED", "MODEL_MOCK", "REAL_MODELS_ENABLED", "MVP_ACCEPTANCE_ISOLATED_DB", "MODEL_ENCRYPTION_KEY", "CRON_SECRET", "CI", "NODE_OPTIONS", "PLAYWRIGHT_PORT", "PLAYWRIGHT_REUSE_SERVER", "LOCAL_ACCEPTANCE_REPORTS")
$original = @{}
foreach ($name in $managed) { $original[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
$branchName = "local-acceptance-$([Guid]::NewGuid().ToString('N'))"
$reports = Join-Path ([IO.Path]::GetTempPath()) $branchName
$null = New-Item -ItemType Directory -Path $reports
$creationAttempted = $false
$failure = $null
$cleanupFailed = $false
$neonArgs = @("--project-id", $env:NEON_PROJECT_ID, "--api-key", $env:NEON_API_KEY)
$head = (& git rev-parse HEAD) -join ""
if ($LASTEXITCODE -ne 0) { throw "不能确认验收提交。" }
Write-Host "验收提交：$head；报告目录：$reports"

try {
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

  $creationAttempted = $true
  & npx --yes neonctl@5 branches create --name $branchName @neonArgs --output json *> $null
  if ($LASTEXITCODE -ne 0) { throw "临时分支创建结果异常；仍尝试清理同一唯一分支。" }
  & npx --yes neonctl@5 databases create --name ci_test --branch $branchName --owner-name neondb_owner @neonArgs --output json *> $null
  if ($LASTEXITCODE -ne 0) { throw "临时空库创建失败。" }
  $branchUrl = (& npx --yes neonctl@5 connection-string $branchName --database-name ci_test --role-name neondb_owner @neonArgs 2>$null) -join ""
  if ($LASTEXITCODE -ne 0) { throw "临时空库连接获取失败。" }
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
} catch {
  $failure = "验收步骤失败；未执行的后续步骤不算通过。"
  Write-Host $failure
} finally {
  try {
    if ($creationAttempted) {
      & npx --yes neonctl@5 branches delete $branchName @neonArgs *> $null
      if ($LASTEXITCODE -ne 0) { throw "删除结果异常。" }
      $remaining = (& npx --yes neonctl@5 branches list @neonArgs --output json 2>$null) -join ""
      if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remaining) -or $remaining.Contains($branchName)) { throw "无法确认临时分支已经删除。" }
      $null = ConvertFrom-Json -InputObject $remaining -ErrorAction Stop
    }
  } catch { $cleanupFailed = $true }
  finally {
    foreach ($name in $managed) { [Environment]::SetEnvironmentVariable($name, $original[$name], "Process") }
  }
}
if ($cleanupFailed) { throw "临时分支 $branchName 清理未确认；验收不算通过，请人工核对。" }
if ($failure) { throw $failure }
Write-Host "本地完整门禁通过；Vercel保护预览访问和真实供应商仍需独立验收。"
