#Requires -Version 7.2
# 用法：pwsh -NoProfile -NonInteractive -File scripts/local-acceptance-mock.ps1
# 仅重放固定入口的 48 项遮蔽模拟；不代替数据库、Workflow、浏览器或完整 CI。
# 原入口会短暂监听 Loopback 选择端口并在 finally 关闭；不连接外部服务。
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# 指纹只统一 CRLF/LF，保留 BOM、末尾空白和全部正文，兼容正常 Git checkout。
$entrySha = '59095BCA92BE33621E8770BD37F1E173B8F9BBBED11B1EF359E21D38CDF1AD8E'
$fixtureSha = '4B183FAFF93B47173B9F0F9779BADED7EA89EADCF7744572F043EB1D724A50EA'
$script:failureCode = 'driver-preflight'
$ownedRoot = $null
$ownedRootCreated = $false
$preserveRoot = $false
$passed = 0
$failed = 0
$ownedProcesses = [Collections.Generic.List[object]]::new()

function Assert-MockCondition {
  param([bool]$Condition, [string]$Code)
  if (-not $Condition) {
    $script:failureCode = $Code
    throw '模拟检查失败；不输出原始进程内容。'
  }
}

function Get-AbsoluteMockPath {
  param([string]$Path)
  Assert-MockCondition ([IO.Path]::IsPathFullyQualified($Path)) 'path-not-absolute'
  return [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($Path))
}

function Assert-NoMockReparse {
  param([string]$Path)
  $current = Get-AbsoluteMockPath $Path
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      Assert-MockCondition (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'reparse-refused'
    }
    $parent = [IO.Path]::GetDirectoryName($current)
    if (-not $parent -or [string]::Equals($parent, $current, [StringComparison]::OrdinalIgnoreCase)) { break }
    $current = $parent
  }
}

function Assert-DirectMockChild {
  param([string]$Parent, [string]$Path)
  $parentPath = Get-AbsoluteMockPath $Parent
  $childPath = Get-AbsoluteMockPath $Path
  Assert-MockCondition ([string]::Equals([IO.Path]::GetDirectoryName($childPath), $parentPath, [StringComparison]::OrdinalIgnoreCase)) 'path-parent-refused'
  Assert-NoMockReparse $childPath
}

function New-OwnedMockDirectory {
  param([string]$Parent, [string]$Name)
  Assert-MockCondition ($Name -cmatch '^[a-z0-9-]+$') 'directory-name-refused'
  $path = [IO.Path]::GetFullPath((Join-Path $Parent $Name))
  Assert-DirectMockChild $Parent $path
  Assert-MockCondition (-not (Test-Path -LiteralPath $path)) 'directory-collision'
  $null = [IO.Directory]::CreateDirectory($path)
  Assert-DirectMockChild $Parent $path
  return $path
}

function Assert-MockSha {
  param([string]$Path, [string]$Expected)
  Assert-NoMockReparse $Path
  Assert-MockCondition ([IO.File]::Exists($Path)) 'source-missing'
  $script:failureCode = 'source-encoding-invalid'
  $utf8 = [Text.UTF8Encoding]::new($false, $true)
  $text = $utf8.GetString([IO.File]::ReadAllBytes($Path))
  $canonical = $text.Replace([string]::Concat([char]13, [char]10), [string][char]10)
  $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($utf8.GetBytes($canonical)))
  Assert-MockCondition ($actual -ceq $Expected) 'source-drift'
}

function Copy-PinnedMockFile {
  param([string]$Source, [string]$Parent, [string]$Name, [string]$Expected)
  Assert-MockSha $Source $Expected
  $destination = [IO.Path]::GetFullPath((Join-Path $Parent $Name))
  Assert-DirectMockChild $Parent $destination
  Assert-MockCondition (-not (Test-Path -LiteralPath $destination)) 'artifact-collision'
  [IO.File]::WriteAllBytes($destination, [IO.File]::ReadAllBytes($Source))
  Assert-DirectMockChild $Parent $destination
  Assert-MockSha $destination $Expected
  return $destination
}

function Get-RecordedMockArgument {
  param([string[]]$Values, [string]$Name)
  for ($index = 0; $index -lt $Values.Count; $index++) {
    if ($Values[$index] -ceq $Name) {
      if ($index + 1 -lt $Values.Count) { return $Values[$index + 1] }
      return $null
    }
  }
  return $null
}

function Read-OwnedMockCalls {
  param([string]$CaseDirectory, [string]$Path)
  Assert-DirectMockChild $CaseDirectory $Path
  Assert-MockCondition ([IO.File]::Exists($Path)) 'calls-missing'
  Assert-MockCondition ((Get-Item -LiteralPath $Path).Length -le 2MB) 'calls-too-large'
  $records = [Collections.Generic.List[object]]::new()
  foreach ($line in [IO.File]::ReadAllLines($Path, [Text.Encoding]::UTF8)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    Assert-MockCondition ($line.Length -le 32768) 'call-line-too-large'
    $script:failureCode = 'call-json-invalid'
    $call = ConvertFrom-Json -InputObject $line -AsHashtable -ErrorAction Stop
    Assert-MockCondition ($call -is [Collections.IDictionary] -and $call.Count -eq 2 -and $call.Contains('kind') -and $call.Contains('arguments')) 'call-shape'
    Assert-MockCondition ($call.kind -is [string] -and $call.kind -cin @('neon', 'pnpm', 'node')) 'call-kind'
    Assert-MockCondition ($call.arguments -is [Array] -and $call.arguments.Count -le 256) 'call-arguments'
    foreach ($argument in $call.arguments) { Assert-MockCondition ($argument -is [string]) 'call-argument-type' }
    $records.Add($call)
  }
  return $records.ToArray()
}

function Assert-OwnedMockContexts {
  param([object[]]$Calls, [string]$TemporaryDirectory)
  foreach ($call in $Calls) {
    if ($call.kind -cne 'neon') { continue }
    $context = Get-RecordedMockArgument $call.arguments '--context-file'
    Assert-MockCondition (-not [string]::IsNullOrWhiteSpace($context)) 'context-missing'
    $contextPath = Get-AbsoluteMockPath $context
    Assert-MockCondition ([IO.Path]::GetFileName($contextPath) -ceq 'neon-context.json') 'context-name'
    $reportPath = [IO.Path]::GetDirectoryName($contextPath)
    Assert-DirectMockChild $TemporaryDirectory $reportPath
    Assert-MockCondition ([IO.Path]::GetFileName($reportPath) -cmatch '^local-acceptance-[0-9a-f]{32}$') 'report-name'
    Assert-DirectMockChild $reportPath $contextPath
  }
}

function Assert-SuccessfulMock {
  param([string]$Mode, [string]$Output, [object[]]$Calls, [string]$TemporaryDirectory)
  Assert-MockCondition ($Output.Contains('本地完整门禁通过') -and -not $Output.Contains('ENTRY-FAILED')) 'success-marker'
  $neon = @($Calls | Where-Object { $_.kind -ceq 'neon' })
  Assert-MockCondition ($neon.Count -gt 0) 'neon-calls-missing'
  $contexts = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($call in $neon) { $null = $contexts.Add((Get-RecordedMockArgument $call.arguments '--context-file')) }
  Assert-MockCondition ($contexts.Count -eq 1) 'context-changed'
  Assert-OwnedMockContexts $Calls $TemporaryDirectory
  foreach ($call in $neon) {
    $values = $call.arguments
    Assert-MockCondition ($values.Count -ge 4 -and $values[0] -ceq '--yes' -and $values[1] -ceq 'neonctl@5.0.1') 'cli-version'
    Assert-MockCondition ($values -cnotcontains '--api-key' -and $values -cnotcontains '--force-auth' -and $values[2] -cnotmatch '^(auth|login|profile)$') 'auth-boundary'
    Assert-MockCondition ($values -ccontains '--no-analytics') 'analytics-boundary'
    Assert-MockCondition ((Get-RecordedMockArgument $values '--api-host') -ceq 'https://console.neon.tech/api/v2') 'api-host'
    Assert-MockCondition ((Get-RecordedMockArgument $values '--oauth-host') -ceq 'https://oauth2.neon.tech') 'oauth-host'
    $context = Get-RecordedMockArgument $values '--context-file'
    if ($Mode -ceq 'api') {
      Assert-MockCondition ((Get-RecordedMockArgument $values '--config-dir') -ceq (Join-Path ([IO.Path]::GetDirectoryName($context)) 'neon-config')) 'api-config-dir'
      Assert-MockCondition ($null -eq (Get-RecordedMockArgument $values '--profile')) 'api-profile'
    } else {
      $profile = if ($Mode -cin @('session-default', 'session-empty-env')) { 'DEFAULT' } elseif ($Mode -ceq 'session-explicit') { 'chosen-profile' } else { 'ambient-profile' }
      Assert-MockCondition ($values -cnotcontains '--config-dir' -and (Get-RecordedMockArgument $values '--profile') -ceq $profile) 'session-profile'
    }
    if ($values[2] -ceq 'api') {
      Assert-MockCondition ($values[3] -cmatch '^/projects/test-project-123(?:/branches)?$' -and (Get-RecordedMockArgument $values '--method') -ceq 'GET' -and $values -cnotcontains '--project-id') 'api-project'
    } else {
      Assert-MockCondition ((Get-RecordedMockArgument $values '--project-id') -ceq 'test-project-123') 'command-project'
    }
  }
  $pages = @($neon | Where-Object { $_.arguments[3].EndsWith('/branches', [StringComparison]::Ordinal) })
  Assert-MockCondition ($pages.Count -eq 2) 'success-page-count'
  Assert-MockCondition ($pages[0].arguments -ccontains 'limit=100' -and $pages[1].arguments -ccontains 'cursor=cursor-one') 'page-cursor'
  foreach ($page in $pages) { Assert-MockCondition ($page.arguments -ccontains 'sort_by=created_at' -and $page.arguments -ccontains 'sort_order=asc') 'page-order' }
  $creates = @($neon | Where-Object { $_.arguments[2] -ceq 'branches' -and $_.arguments[3] -ceq 'create' })
  $removes = @($neon | Where-Object { $_.arguments[2] -ceq 'branches' -and $_.arguments[3] -ceq 'delete' })
  Assert-MockCondition ($creates.Count -eq 1 -and $removes.Count -eq 1) 'branch-call-count'
  Assert-MockCondition ((Get-RecordedMockArgument $creates[0].arguments '--name') -cmatch '^local-acceptance-[0-9a-f]{32}$' -and $creates[0].arguments -ccontains '--no-secrets') 'random-branch-name'
  Assert-MockCondition ($removes[0].arguments[4] -ceq 'br-local-acceptance-test') 'delete-branch-id'
  $commands = (@($Calls | Where-Object { $_.kind -cin @('pnpm', 'node') } | ForEach-Object { $_.arguments -join ' ' })) -join ([char]10)
  foreach ($command in @('install --frozen-lockfile', 'audit --prod --audit-level high', 'next typegen', 'tsc --noEmit', 'eslint . --no-cache --max-warnings=0', 'vitest run --maxWorkers=1', 'mvp-acceptance-recovery.config.mts', 'build', 'db:migrate', 'vitest.integration.config.mts', 'vitest.workflow.config.mts', 'scripts/check-local-acceptance.mjs', 'playwright install chromium', 'playwright test --workers=1')) {
    Assert-MockCondition ($commands.Contains($command)) 'heavy-gate-missing'
  }
  Assert-MockCondition ($Calls[0].kind -ceq 'neon' -and $Calls[0].arguments[3] -ceq '/projects/test-project-123') 'authentication-not-first'
}

function Assert-MockCase {
  param($Case, [string]$Output, [object[]]$Calls, [string]$TemporaryDirectory)
  Assert-MockCondition ($Output.Contains('ENV-RESTORED:True')) 'environment-not-restored'
  Assert-MockCondition ($Output -cnotmatch 'local-ci-dummy-secret|fixture-oauth-token|fixture-db-secret') 'dummy-secret-leaked'
  Assert-OwnedMockContexts $Calls $TemporaryDirectory
  if ($Case.Group -cin @('authentication', 'hosts', 'mixed')) {
    Assert-SuccessfulMock $Case.Mode $Output $Calls $TemporaryDirectory
    if ($Case.Group -ceq 'hosts') {
      foreach ($call in $Calls) {
        if ($call.kind -ceq 'neon') { Assert-MockCondition (-not (($call.arguments -join ' ').Contains('untrusted.invalid'))) 'ambient-host-leaked' }
      }
    }
    if ($Case.Group -ceq 'mixed') {
      Assert-MockCondition (@($Calls | Where-Object { $_.kind -ceq 'pnpm' -and $_.arguments -ccontains 'db:migrate' }).Count -gt 0) 'mixed-migration-missing'
      Assert-MockCondition (@($Calls | Where-Object { $_.kind -ceq 'pnpm' -and ($_.arguments -join ' ') -ceq 'exec playwright test --workers=1' }).Count -gt 0) 'mixed-browser-missing'
    }
    return
  }
  Assert-MockCondition ($Output.Contains('ENTRY-FAILED') -and -not $Output.Contains('本地完整门禁通过')) 'failure-marker'
  if ($Case.Group -ceq 'preflight') {
    foreach ($call in $Calls) { Assert-MockCondition ($call.kind -ceq 'neon' -and $call.arguments.Count -gt 3 -and $call.arguments[2] -ceq 'api' -and $call.arguments[3] -ceq '/projects/test-project-123') 'preflight-heavy-call' }
    Assert-MockCondition (@($Calls | Where-Object { $_.arguments.Count -gt 3 -and $_.arguments[3] -ceq 'create' }).Count -eq 0) 'preflight-created'
    return
  }
  $neon = @($Calls | Where-Object { $_.kind -ceq 'neon' })
  $creates = @($neon | Where-Object { $_.arguments.Count -gt 3 -and $_.arguments[3] -ceq 'create' })
  $removes = @($neon | Where-Object { $_.arguments.Count -gt 3 -and $_.arguments[3] -ceq 'delete' })
  Assert-MockCondition ($removes.Count -gt 0) 'cleanup-delete-missing'
  $pages = @($neon | Where-Object { $_.arguments.Count -gt 3 -and $_.arguments[3].EndsWith('/branches', [StringComparison]::Ordinal) })
  if ($Case.Group -ceq 'unknown-create') {
    Assert-MockCondition (-not $Output.Contains('清理未确认')) 'unknown-create-cleanup-failed'
    Assert-MockCondition ($creates.Count -eq 1 -and $removes.Count -eq 1) 'unknown-create-count'
    $name = Get-RecordedMockArgument $creates[0].arguments '--name'
    Assert-MockCondition ($name -cmatch '^local-acceptance-[0-9a-f]{32}$' -and $removes[0].arguments[4] -ceq $name) 'unknown-create-wrong-target'
    Assert-MockCondition ($pages.Count -eq 2) 'unknown-create-pages'
    Assert-MockCondition (@($Calls | Where-Object { $_.arguments -ccontains 'db:migrate' }).Count -eq 0) 'unknown-create-migrated'
    if ($Case.Scenario -ceq 'unknown-create') { Assert-MockCondition ($Output.Contains('退出码=7')) 'unknown-create-code' }
    return
  }
  Assert-MockCondition ($Case.Group -ceq 'cleanup' -and $Output.Contains('清理未确认')) 'cleanup-failure-marker'
  if ($Case.Scenario -ceq 'both-failures') {
    Assert-MockCondition ($Output.Contains('原失败=验收失败') -and $Output.Contains('退出码=7') -and $Output.Contains('退出码=9')) 'original-failure-lost'
  }
  if ($Case.Scenario -cin @('still-present-later', 'renamed-id-present', 'pagination-cycle')) { Assert-MockCondition ($pages.Count -eq 2) 'cleanup-two-pages' }
  if ($Case.Scenario -ceq 'page-bound') { Assert-MockCondition ($pages.Count -eq 100) 'cleanup-page-bound' }
}

function Confirm-OwnedMockProcessStopped {
  param($Record)
  if (-not $Record.StartAttempted) { return $true }
  $clock = [Diagnostics.Stopwatch]::StartNew()
  try {
    if (-not $Record.Process.HasExited) { $Record.Process.Kill() }
    $remaining = [Math]::Max(0, 2000 - [int]$clock.ElapsedMilliseconds)
    if (-not $Record.Process.WaitForExit($remaining) -or -not $Record.Process.HasExited) { return $false }
    if ($null -eq $Record.Stdout -or $null -eq $Record.Stderr) { return $false }
    $remaining = [Math]::Max(0, 2000 - [int]$clock.ElapsedMilliseconds)
    $drain = [Threading.Tasks.Task]::WhenAll([Threading.Tasks.Task[]]@($Record.Stdout, $Record.Stderr))
    if (-not $drain.Wait($remaining)) { return $false }
    return $Record.Stdout.IsCompletedSuccessfully -and $Record.Stderr.IsCompletedSuccessfully
  } catch { return $false }
}

function Invoke-OwnedMockProcess {
  param($Case, [string]$CaseDirectory, [string]$Entry, [string]$Fixture, [string]$Calls, [string]$TemporaryDirectory, [string]$Pwsh, [string]$SystemDirectory, [string]$WindowsDirectory, [string]$ModuleDirectory)
  Assert-DirectMockChild $CaseDirectory $Entry
  Assert-DirectMockChild $CaseDirectory $Fixture
  Assert-DirectMockChild $CaseDirectory $Calls
  Assert-DirectMockChild $CaseDirectory $TemporaryDirectory
  Assert-MockSha $Entry $entrySha
  Assert-MockSha $Fixture $fixtureSha
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $Pwsh
  $info.WorkingDirectory = $CaseDirectory
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = [Text.Encoding]::UTF8
  $info.StandardErrorEncoding = [Text.Encoding]::UTF8
  # 不读取真实钥匙或继承调用方 PATH/模块/profile；临时报告只能落在本案目录。
  $info.Environment.Clear()
  $info.Environment['SystemRoot'] = $WindowsDirectory
  $info.Environment['WINDIR'] = $WindowsDirectory
  $info.Environment['ComSpec'] = Join-Path $SystemDirectory 'cmd.exe'
  $info.Environment['PATH'] = ([IO.Path]::GetDirectoryName($Pwsh), $SystemDirectory, $WindowsDirectory) -join ';'
  $info.Environment['PSModulePath'] = $ModuleDirectory
  $info.Environment['TEMP'] = $TemporaryDirectory
  $info.Environment['TMP'] = $TemporaryDirectory
  foreach ($argument in @('-NoProfile', '-NonInteractive', '-File', $Fixture, '-Entry', $Entry, '-Calls', $Calls, '-Mode', $Case.Mode, '-Scenario', $Case.Scenario)) { $info.ArgumentList.Add([string]$argument) }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $info
  $record = [pscustomobject]@{ Process = $process; StartAttempted = $false; Stdout = $null; Stderr = $null }
  $ownedProcesses.Add($record)
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $script:failureCode = 'child-start-unconfirmed'
  $record.StartAttempted = $true
  Assert-MockCondition ($process.Start()) 'child-start-unconfirmed'
  $record.Stdout = $process.StandardOutput.ReadToEndAsync()
  $record.Stderr = $process.StandardError.ReadToEndAsync()
  $remaining = [Math]::Max(0, 10000 - [int]$clock.ElapsedMilliseconds)
  Assert-MockCondition ($process.WaitForExit($remaining)) 'child-timeout'
  $remaining = [Math]::Max(0, 10000 - [int]$clock.ElapsedMilliseconds)
  $drain = [Threading.Tasks.Task]::WhenAll([Threading.Tasks.Task[]]@($record.Stdout, $record.Stderr))
  $script:failureCode = 'child-output-unconfirmed'
  Assert-MockCondition ($drain.Wait($remaining) -and $record.Stdout.IsCompletedSuccessfully -and $record.Stderr.IsCompletedSuccessfully) 'child-output-unconfirmed'
  $stdout = $record.Stdout.GetAwaiter().GetResult()
  $stderr = $record.Stderr.GetAwaiter().GetResult()
  Assert-MockCondition ([Text.Encoding]::UTF8.GetByteCount($stdout) + [Text.Encoding]::UTF8.GetByteCount($stderr) -le 1MB) 'child-output-too-large'
  $captured = $stdout + $stderr
  Assert-MockCondition ($captured.Contains('ENV-RESTORED:True')) 'environment-not-restored'
  Assert-MockCondition ($captured -cnotmatch 'local-ci-dummy-secret|fixture-oauth-token|fixture-db-secret') 'dummy-secret-leaked'
  Assert-MockCondition ($process.HasExited -and $process.ExitCode -eq 0) 'child-exit'
  return $captured
}

function Assert-OwnedMockTree {
  param([string]$Root, [string]$Parent, [string]$ExpectedName)
  Assert-DirectMockChild $Parent $Root
  Assert-MockCondition ([IO.Path]::GetFileName($Root) -ceq $ExpectedName -and $ExpectedName -cmatch '^local-acceptance-mock-[0-9a-f]{32}$') 'root-ownership-refused'
  $directories = [Collections.Generic.Stack[string]]::new()
  $directories.Push($Root)
  while ($directories.Count -gt 0) {
    $directory = $directories.Pop()
    Assert-NoMockReparse $directory
    foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
      Assert-DirectMockChild $directory $item.FullName
      if ($item -is [IO.DirectoryInfo]) { $directories.Push($item.FullName) }
    }
  }
}

try {
  Assert-MockCondition ($IsWindows) 'windows-required'
  $projectDirectory = Get-AbsoluteMockPath ([IO.Path]::GetDirectoryName($PSScriptRoot))
  $entrySource = [IO.Path]::GetFullPath((Join-Path $projectDirectory 'acceptance.ps1'))
  $fixtureSource = [IO.Path]::GetFullPath((Join-Path $projectDirectory 'tests/fixtures/local-acceptance-commands.ps1'))
  Assert-NoMockReparse $projectDirectory
  Assert-MockSha $entrySource $entrySha
  Assert-MockSha $fixtureSource $fixtureSha
  $tokens = $null
  $parseErrors = $null
  $fixtureAst = [Management.Automation.Language.Parser]::ParseFile($fixtureSource, [ref]$tokens, [ref]$parseErrors)
  Assert-MockCondition ($parseErrors.Count -eq 0) 'fixture-parse'
  $functions = @($fixtureAst.FindAll({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] }, $true))
  foreach ($name in @('git', 'pnpm', 'node', 'npx')) {
    Assert-MockCondition (@($functions | Where-Object { $_.Name -ceq $name }).Count -eq 1) 'shadow-function-missing'
  }
  $pwsh = Get-AbsoluteMockPath (Join-Path $PSHOME 'pwsh.exe')
  $moduleDirectory = Get-AbsoluteMockPath (Join-Path $PSHOME 'Modules')
  $windowsDirectory = Get-AbsoluteMockPath ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows))
  $systemDirectory = Get-AbsoluteMockPath (Join-Path $windowsDirectory 'System32')
  foreach ($path in @($pwsh, $moduleDirectory, $windowsDirectory, $systemDirectory)) { Assert-NoMockReparse $path }
  Assert-MockCondition ([IO.File]::Exists($pwsh) -and [IO.Directory]::Exists($moduleDirectory) -and [IO.Directory]::Exists($systemDirectory)) 'system-path-missing'
  $temporaryBase = Get-AbsoluteMockPath ([IO.Path]::GetTempPath())
  Assert-NoMockReparse $temporaryBase
  $ownedName = 'local-acceptance-mock-' + [Guid]::NewGuid().ToString('N')
  $ownedRoot = New-OwnedMockDirectory $temporaryBase $ownedName
  $ownedRootCreated = $true

  $cases = [Collections.Generic.List[object]]::new()
  foreach ($mode in @('api', 'session-default', 'session-empty-env', 'session-env', 'session-explicit')) {
    $cases.Add([pscustomobject]@{ Group = 'authentication'; Mode = $mode; Scenario = 'success' })
  }
  foreach ($mode in @('api', 'session-empty-env')) {
    $cases.Add([pscustomobject]@{ Group = 'hosts'; Mode = $mode; Scenario = 'redirected-hosts' })
  }
  $cases.Add([pscustomobject]@{ Group = 'mixed'; Mode = 'session-empty-env'; Scenario = 'mixed-original-env' })
  foreach ($pair in @(
    @('api', 'missing-key'), @('api', 'whitespace-key'), @('api', 'profile-only'), @('api', 'auth-failure'),
    @('session-env', 'missing-project'), @('session-env', 'missing-session'), @('session-env', 'auth-failure'),
    @('session-env', 'session-api-conflict'), @('session-env', 'whitespace-key'), @('session-env', 'whitespace-profile'),
    @('session-explicit', 'empty-explicit-profile'), @('session-explicit', 'invalid-profile'),
    @('session-env', 'wrong-project'), @('session-env', 'wrong-project-shape'), @('session-env', 'invalid-project-json')
  )) { $cases.Add([pscustomobject]@{ Group = 'preflight'; Mode = $pair[0]; Scenario = $pair[1] }) }
  foreach ($scenario in @('unknown-create', 'invalid-created-json', 'wrong-created-project')) {
    $cases.Add([pscustomobject]@{ Group = 'unknown-create'; Mode = 'session-env'; Scenario = $scenario })
  }
  foreach ($scenario in @('delete-failure', 'both-failures', 'list-exit', 'invalid-list-json', 'list-wrong-shape', 'missing-pagination', 'wrong-branch-project', 'still-present-later', 'renamed-id-present', 'duplicate-id', 'pagination-cycle', 'invalid-cursor', 'null-cursor', 'blank-cursor', 'control-cursor', 'long-cursor', 'cursor-only-pagination', 'wrong-sort-by', 'wrong-sort-order', 'wrong-sort-shape', 'empty-next', 'page-bound')) {
    $cases.Add([pscustomobject]@{ Group = 'cleanup'; Mode = 'session-env'; Scenario = $scenario })
  }
  Assert-MockCondition ($cases.Count -eq 48) 'case-count'
  foreach ($expected in @(@('authentication', 5), @('hosts', 2), @('mixed', 1), @('preflight', 15), @('unknown-create', 3), @('cleanup', 22))) {
    Assert-MockCondition (@($cases | Where-Object { $_.Group -ceq $expected[0] }).Count -eq $expected[1]) 'case-group-count'
  }
  Write-Output ("模拟版本：PowerShell={0}；neonctl=5.0.1；入口LF规范SHA={1}；fixtureLF规范SHA={2}；计划=48" -f $PSVersionTable.PSVersion, $entrySha, $fixtureSha)
  for ($caseIndex = 0; $caseIndex -lt $cases.Count; $caseIndex++) {
    $case = $cases[$caseIndex]
    $caseLabel = '{0:D2}-{1}-{2}' -f ($caseIndex + 1), $case.Mode, $case.Scenario
    $script:failureCode = 'case-preparation'
    $firstProcessIndex = $ownedProcesses.Count
    try {
      Assert-MockSha $entrySource $entrySha
      Assert-MockSha $fixtureSource $fixtureSha
      $caseDirectory = New-OwnedMockDirectory $ownedRoot ('case-' + ($caseIndex + 1).ToString('D2'))
      $caseTemporary = New-OwnedMockDirectory $caseDirectory 'temp'
      $caseEntry = Copy-PinnedMockFile $entrySource $caseDirectory 'acceptance.ps1' $entrySha
      $caseFixture = Copy-PinnedMockFile $fixtureSource $caseDirectory 'mock-commands.ps1' $fixtureSha
      $callsPath = [IO.Path]::GetFullPath((Join-Path $caseDirectory 'calls.jsonl'))
      Assert-DirectMockChild $caseDirectory $callsPath
      Assert-MockCondition (-not (Test-Path -LiteralPath $callsPath)) 'calls-collision'
      [IO.File]::WriteAllText($callsPath, '', [Text.UTF8Encoding]::new($false))
      $output = Invoke-OwnedMockProcess $case $caseDirectory $caseEntry $caseFixture $callsPath $caseTemporary $pwsh $systemDirectory $windowsDirectory $moduleDirectory
      $calls = @(Read-OwnedMockCalls $caseDirectory $callsPath)
      Assert-MockCase $case $output $calls $caseTemporary
      $passed++
      Write-Output ("模拟通过：{0}" -f $caseLabel)
    } catch {
      $failed++
      Write-Output ("模拟失败：{0}；原因={1}" -f $caseLabel, $script:failureCode)
    } finally {
      $output = $null
      $calls = $null
      for ($recordIndex = $firstProcessIndex; $recordIndex -lt $ownedProcesses.Count; $recordIndex++) {
        if (-not (Confirm-OwnedMockProcessStopped $ownedProcesses[$recordIndex])) { $preserveRoot = $true }
      }
    }
    if ($preserveRoot) { break }
  }
} catch {
  $failed++
  Write-Output ("模拟驱动失败；原因={0}" -f $script:failureCode)
} finally {
  foreach ($record in $ownedProcesses) {
    $stopped = Confirm-OwnedMockProcessStopped $record
    if (-not $stopped) { $preserveRoot = $true }
    if ($stopped) { $record.Process.Dispose() }
  }
  if ($ownedRootCreated -and -not $preserveRoot) {
    try {
      Assert-OwnedMockTree $ownedRoot $temporaryBase $ownedName
      Remove-Item -LiteralPath $ownedRoot -Recurse -Force
      Assert-MockCondition (-not (Test-Path -LiteralPath $ownedRoot)) 'root-cleanup-unconfirmed'
    } catch {
      $preserveRoot = $true
      $failed++
      Write-Output '模拟临时目录清理未确认；已阻断成功结论。'
    }
  }
  if ($preserveRoot) {
    if ($failed -eq 0) { $failed++ }
    Write-Output ("进程退出或输出清空未确认；保留本批目录：{0}" -f [IO.Path]::GetFileName($ownedRoot))
  }
}
Write-Output ("仅模拟，完整验收未执行；通过={0}；失败={1}；计划=48" -f $passed, $failed)
if ($failed -gt 0 -or $passed -ne 48 -or $preserveRoot) { exit 1 }
exit 0
