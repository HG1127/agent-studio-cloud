param()

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Checked {
  param(
    [string]$Label,
    [string]$Command,
    [string[]]$Arguments
  )

  Write-Host "→ $Label"
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label 失败（退出码 $LASTEXITCODE）"
  }
}

if ([string]::IsNullOrWhiteSpace($env:NEON_PROJECT_ID)) {
  throw "完整本地验收需要当前终端中的 NEON_PROJECT_ID；不要使用共享数据库连接串直接跑测试。"
}
$neonAuthArgs = @()
if (-not [string]::IsNullOrWhiteSpace($env:NEON_API_KEY)) {
  $neonAuthArgs = @("--api-key", $env:NEON_API_KEY)
}

$managedNames = @(
  "DATABASE_URL",
  "DATABASE_URL_POOLED",
  "MODEL_MOCK",
  "REAL_MODELS_ENABLED",
  "MODEL_ENCRYPTION_KEY",
  "CRON_SECRET",
  "CI"
)
$original = @{}
foreach ($name in $managedNames) {
  $original[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

$branchName = "local-acceptance-$(Get-Date -Format yyyyMMddHHmmss)-$(Get-Random -Maximum 1000000)"
$branchCreated = $false
$failure = $null
$cleanupFailed = $false

try {
  $buildUrl = "postgresql://build:build@localhost:5432/build"
  $env:DATABASE_URL = $buildUrl
  $env:DATABASE_URL_POOLED = $buildUrl
  $env:MODEL_MOCK = "1"
  $env:REAL_MODELS_ENABLED = "0"
  $env:CI = "1"

  $randomBytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
  $env:MODEL_ENCRYPTION_KEY = [BitConverter]::ToString($randomBytes).Replace("-", "").ToLowerInvariant()
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
  $env:CRON_SECRET = [BitConverter]::ToString($randomBytes).Replace("-", "").ToLowerInvariant()

  Invoke-Checked "安装锁定版本依赖" "pnpm" @("install", "--frozen-lockfile")
  Invoke-Checked "检查生产依赖漏洞" "pnpm" @("audit", "--prod", "--audit-level", "high")
  Invoke-Checked "生成 Next.js 路由类型" "pnpm" @("exec", "next", "typegen")
  Invoke-Checked "检查 TypeScript" "pnpm" @("exec", "tsc", "--noEmit")
  Invoke-Checked "检查代码规范" "pnpm" @("lint")
  Invoke-Checked "运行单元与组件测试" "pnpm" @("test")
  Invoke-Checked "验证生产构建" "pnpm" @("build")

  Write-Host "→ 创建隔离的 Neon 测试分支：$branchName"
  & npx --yes neonctl@5 branches create --name $branchName --project-id $env:NEON_PROJECT_ID @neonAuthArgs --output json | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Neon 测试分支创建失败（退出码 $LASTEXITCODE）；请先登录 Neon CLI 或在当前终端配置 NEON_API_KEY"
  }
  $branchCreated = $true

  $branchUrl = (& npx --yes neonctl@5 connection-string $branchName --project-id $env:NEON_PROJECT_ID --database-name neondb --role-name neondb_owner @neonAuthArgs) -join ""
  if ($LASTEXITCODE -ne 0 -or $branchUrl -notmatch "^postgres(ql)?://") {
    throw "Neon 测试分支未返回有效连接串"
  }
  $env:DATABASE_URL = $branchUrl
  $env:DATABASE_URL_POOLED = $branchUrl

  Invoke-Checked "迁移隔离数据库" "pnpm" @("db:migrate")
  Invoke-Checked "运行数据库集成测试" "pnpm" @("test:integration")
  Invoke-Checked "运行工作流集成测试" "pnpm" @("test:workflow")
  if ($env:OS -eq "Windows_NT") {
    Invoke-Checked "安装 Chromium" "pnpm" @("exec", "playwright", "install", "chromium")
  } else {
    Invoke-Checked "安装 Chromium 与系统依赖" "pnpm" @("exec", "playwright", "install", "--with-deps", "chromium")
  }
  Invoke-Checked "运行浏览器端到端测试" "pnpm" @("test:e2e")
} catch {
  $failure = $_.Exception.Message
} finally {
  try {
    if ($branchCreated) {
      Write-Host "→ 删除 Neon 测试分支：$branchName"
      & npx --yes neonctl@5 branches delete $branchName --project-id $env:NEON_PROJECT_ID @neonAuthArgs | Out-Null
      $cleanupFailed = $LASTEXITCODE -ne 0
    }
  } catch {
    $cleanupFailed = $true
  } finally {
    foreach ($name in $managedNames) {
      [Environment]::SetEnvironmentVariable($name, $original[$name], "Process")
    }
  }
}

if ($cleanupFailed) {
  throw "Neon 测试分支 $branchName 清理失败，请在 Neon 控制台检查并删除；验收不算通过。"
}
if ($failure) {
  throw $failure
}
Write-Host "本地验收全部通过。"
