param([string]$Entry, [string]$Calls, [string]$Mode, [string]$Scenario)

$ErrorActionPreference = "Stop"
$global:mockCalls = $Calls
$global:mockMode = $Mode
$global:mockScenario = $Scenario
$global:mockBranchName = $null
$global:mockReports = $null
$global:mockPages = 0
$global:mockBranchId = "br-local-acceptance-test"
$global:mockProjectId = "test-project-123"

function Write-MockCall {
  param([string]$Kind, [string[]]$Values)
  Add-Content -LiteralPath $global:mockCalls -Value (@{ kind = $Kind; arguments = @($Values) } | ConvertTo-Json -Compress)
}

function Get-MockArgument {
  param([string[]]$Values, [string]$Name)
  for ($argumentIndex = 0; $argumentIndex -lt $Values.Length - 1; $argumentIndex++) {
    if ($Values[$argumentIndex] -ceq $Name) { return $Values[$argumentIndex + 1] }
  }
  return $null
}

function Write-MockJson {
  param($Value)
  Write-Output (ConvertTo-Json -InputObject $Value -Depth 8 -Compress)
}

function git {
  $global:LASTEXITCODE = 0
  if ($args[0] -eq "rev-parse") { Write-Output "mock-frozen-head" }
}

function pnpm {
  $values = @($args | ForEach-Object { [string]$_ })
  Write-MockCall "pnpm" $values
  if ($env:CI -ne "1" -or $env:MODEL_MOCK -ne "1" -or $env:REAL_MODELS_ENABLED -ne "0" -or $env:PLAYWRIGHT_REUSE_SERVER -ne "0") { throw "模拟验收环境不安全" }
  if (($values -contains "vitest.integration.config.mts" -or $values -contains "vitest.workflow.config.mts") -and $env:MVP_ACCEPTANCE_ISOLATED_DB -ne "1") { throw "真实套件隔离标记不正确" }
  if ($values -contains "db:migrate" -and ($env:DATABASE_URL -ne "postgresql://ci:fixture-db-secret@ep-fixture.neon.tech/ci_test" -or $env:MVP_ACCEPTANCE_ISOLATED_DB -ne "0")) { throw "迁移未使用模拟独立空库" }
  if ($env:NEON_API_KEY) { Write-Output $env:NEON_API_KEY }
  Write-Output "postgresql://ci:fixture-db-secret@ep-fixture.neon.tech/ci_test"
  $global:LASTEXITCODE = 0
}

function node {
  Write-MockCall "node" @($args | ForEach-Object { [string]$_ })
  if ($env:MVP_ACCEPTANCE_ISOLATED_DB -ne "0" -or [string]::IsNullOrWhiteSpace($env:LOCAL_ACCEPTANCE_REPORTS)) { throw "数量守卫环境不正确" }
  $global:LASTEXITCODE = 0
}

function npx {
  $values = @($args | ForEach-Object { [string]$_ })
  Write-MockCall "neon" $values
  if ($values[0] -cne "--yes" -or $values[1] -cne "neonctl@5.0.1" -or $env:CI -ne "1") { throw "禁止非固定CLI或互动登录" }
  if ((Get-MockArgument $values "--api-host") -cne "https://console.neon.tech/api/v2" -or (Get-MockArgument $values "--oauth-host") -cne "https://oauth2.neon.tech") { throw "拒绝非官方API或登录端点" }
  $context = Get-MockArgument $values "--context-file"
  if ([string]::IsNullOrWhiteSpace($context)) { throw "缺少独立上下文" }
  $global:mockReports = [IO.Path]::GetDirectoryName($context)
  $global:LASTEXITCODE = 0
  $command = $values[2]
  if ($command -ceq "api") {
    if ((Get-MockArgument $values "--method") -cne "GET") { throw "模拟API只允许GET" }
    if ($values[3] -ceq "/projects/$global:mockProjectId") {
      if ($global:mockScenario -in @("auth-failure", "missing-session")) { $global:LASTEXITCODE = 17; Write-Output "fixture-oauth-token"; return }
      if ($global:mockScenario -eq "invalid-project-json") { Write-Output "{invalid fixture-oauth-token"; return }
      if ($global:mockScenario -eq "wrong-project-shape") { Write-MockJson @{ project = @("test-project-123") }; return }
      $projectId = if ($global:mockScenario -eq "wrong-project") { "other-project" } else { $global:mockProjectId }
      Write-MockJson @{ project = @{ id = $projectId; private = "fixture-oauth-token" } }
      return
    }
    if ($values[3] -cne "/projects/$global:mockProjectId/branches" -or $values -notcontains "limit=100" -or $values -notcontains "sort_by=created_at" -or $values -notcontains "sort_order=asc") { throw "禁止未限定项目或排序的列表" }
    $global:mockPages++
    if ($global:mockScenario -eq "list-exit") { $global:LASTEXITCODE = 19; Write-Output "fixture-oauth-token"; return }
    if ($global:mockScenario -eq "invalid-list-json") { Write-Output "{invalid fixture-oauth-token"; return }
    if ($global:mockScenario -eq "list-wrong-shape") { Write-MockJson @{ branches = @{}; pagination = @{} }; return }
    if ($global:mockScenario -eq "missing-pagination") { Write-MockJson @{ branches = @() }; return }
    if ($global:mockScenario -eq "empty-next") { Write-MockJson @{ branches = @(); pagination = @{ next = "cursor-one" } }; return }
    $branch = @{ id = "br-other-$global:mockPages"; name = "other-$global:mockPages"; project_id = $global:mockProjectId }
    $next = if ($global:mockPages -eq 1) { "cursor-one" } else { $null }
    if ($global:mockScenario -eq "still-present-later" -and $global:mockPages -eq 2) { $branch.name = $global:mockBranchName }
    if ($global:mockScenario -eq "renamed-id-present" -and $global:mockPages -eq 2) { $branch.id = $global:mockBranchId }
    if ($global:mockScenario -eq "wrong-branch-project") { $branch.project_id = "other-project" }
    if ($global:mockScenario -eq "duplicate-id") { $branch.id = "br-repeated" }
    if ($global:mockScenario -eq "pagination-cycle") { $next = "cursor-one" }
    if ($global:mockScenario -eq "invalid-cursor") { $next = 42 }
    if ($global:mockScenario -eq "page-bound") { $next = "cursor-$global:mockPages" }
    $pagination = @{ sort_by = "created_at"; sort_order = "asc" }
    if ($null -ne $next) { $pagination.next = $next }
    if ($global:mockScenario -eq "null-cursor") { $pagination.next = $null }
    if ($global:mockScenario -eq "blank-cursor") { $pagination.next = "  " }
    if ($global:mockScenario -eq "control-cursor") { $pagination.next = "cursor`nunsafe" }
    if ($global:mockScenario -eq "long-cursor") { $pagination.next = "x" * 4097 }
    if ($global:mockScenario -eq "cursor-only-pagination") { $pagination = @{ cursor = "legacy-cursor" } }
    if ($global:mockScenario -eq "wrong-sort-by") { $pagination.sort_by = "updated_at" }
    if ($global:mockScenario -eq "wrong-sort-order") { $pagination.sort_order = "desc" }
    if ($global:mockScenario -eq "wrong-sort-shape") { $pagination.sort_by = @("created_at") }
    Write-MockJson @{ branches = @($branch); pagination = $pagination }
    return
  }
  if ((Get-MockArgument $values "--project-id") -cne $global:mockProjectId) { throw "云命令项目未冻结" }
  if ($command -ceq "branches" -and $values[3] -ceq "create") {
    $global:mockBranchName = Get-MockArgument $values "--name"
    if ($global:mockScenario -in @("unknown-create", "both-failures")) { $global:LASTEXITCODE = 7; Write-Output "fixture-oauth-token"; return }
    if ($global:mockScenario -eq "invalid-created-json") { Write-Output "{invalid fixture-oauth-token"; return }
    $projectId = if ($global:mockScenario -eq "wrong-created-project") { "other-project" } else { $global:mockProjectId }
    Write-MockJson @{ branch = @{ id = $global:mockBranchId; name = $global:mockBranchName; project_id = $projectId }; endpoints = @() }
    return
  }
  if ($command -ceq "branches" -and $values[3] -ceq "delete") {
    if ($global:mockScenario -in @("delete-failure", "both-failures")) { $global:LASTEXITCODE = 9 }
    Write-Output "fixture-oauth-token"
    return
  }
  if ($command -ceq "databases" -and $values[3] -ceq "create") { Write-MockJson @{}; return }
  if ($command -ceq "connection-string") { Write-Output "postgresql://ci:fixture-db-secret@ep-fixture.neon.tech/ci_test"; return }
  throw "禁止未模拟外部命令"
}

$managedNames = @("DATABASE_URL", "DATABASE_URL_POOLED", "MODEL_MOCK", "REAL_MODELS_ENABLED", "MVP_ACCEPTANCE_ISOLATED_DB", "MODEL_ENCRYPTION_KEY", "CRON_SECRET", "CI", "NODE_OPTIONS", "PLAYWRIGHT_PORT", "PLAYWRIGHT_REUSE_SERVER", "LOCAL_ACCEPTANCE_REPORTS", "NEON_PROFILE", "NEON_API_HOST", "NEON_OAUTH_HOST")
foreach ($name in $managedNames) { [Environment]::SetEnvironmentVariable($name, "original-fixture-$name", "Process") }
$env:NEON_PROJECT_ID = if ($Scenario -eq "missing-project") { "" } else { $global:mockProjectId }
$env:NEON_API_KEY = if ($Mode -eq "api" -or $Scenario -eq "session-api-conflict") { "local-ci-dummy-secret" } else { "" }
if ($Scenario -eq "missing-key") { $env:NEON_API_KEY = "" }
if ($Scenario -eq "whitespace-key") { $env:NEON_API_KEY = "  " }
$env:NEON_PROFILE = if ($Mode -eq "session-default") { $null } elseif ($Mode -eq "session-empty-env") { "" } else { "ambient-profile" }
if ($Scenario -eq "whitespace-profile") { $env:NEON_PROFILE = "  " }
$env:NEON_API_HOST = "https://untrusted.invalid/api/v2"
$env:NEON_OAUTH_HOST = "https://untrusted.invalid/oauth"
if ($Scenario -eq "mixed-original-env") {
  $env:MODEL_MOCK = $null
  $env:PLAYWRIGHT_PORT = $null
  $env:CRON_SECRET = ""
  $env:NODE_OPTIONS = ""
}
$originalManaged = @{}
foreach ($name in $managedNames) {
  $originalManaged[$name] = @{ present = Test-Path -LiteralPath "Env:$name"; value = [Environment]::GetEnvironmentVariable($name, "Process") }
}
$entryArguments = @{}
if ($Mode -ne "api") { $entryArguments.UseNeonCliSession = $true }
if ($Mode -eq "session-explicit") { $entryArguments.NeonProfile = "chosen-profile" }
if ($Scenario -eq "invalid-profile") { $entryArguments.NeonProfile = "--force-auth" }
if ($Scenario -eq "empty-explicit-profile") { $entryArguments.NeonProfile = "" }
if ($Scenario -eq "profile-only") { $env:NEON_API_KEY = ""; $entryArguments.NeonProfile = "chosen-profile" }
try {
  try { & $Entry @entryArguments } catch { Write-Output ("ENTRY-FAILED:" + $_.Exception.Message) }
  $restored = $true
  foreach ($name in $managedNames) {
    $before = $originalManaged[$name]
    if ((Test-Path -LiteralPath "Env:$name") -ne $before.present -or [Environment]::GetEnvironmentVariable($name, "Process") -cne $before.value) { $restored = $false }
  }
  Write-Output "ENV-RESTORED:$restored"
} finally {
  if ($global:mockReports) {
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
    $reportPath = [IO.Path]::GetFullPath($global:mockReports)
    if ([IO.Path]::GetDirectoryName($reportPath) -cne $temporaryRoot -or [IO.Path]::GetFileName($reportPath) -cnotmatch '^local-acceptance-[0-9a-f]{32}$') { throw "拒绝删除非本次模拟报告目录" }
    if (Test-Path -LiteralPath $reportPath) { Remove-Item -LiteralPath $reportPath -Recurse -Force }
  }
}
