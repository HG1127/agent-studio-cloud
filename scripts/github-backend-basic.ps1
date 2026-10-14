$Mode='GitHubBasic'
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$taskRoot=(Get-Location).Path
$env:GIT_OPTIONAL_LOCKS='0'
$taskStages=[ordered]@{}; $taskRaw=[ordered]@{}; $taskGates=@(); $taskFailure=$null; $taskMismatch=@(); $taskInitialized=$false; $taskFreshAuditPassed=$false
$taskReport=Join-Path $taskRoot 'github-basic-reports'
$taskReportCreated=$false
function Read-Git([string[]]$Arguments) {
  $taskValue=@(& git --no-optional-locks @Arguments)
  if ($LASTEXITCODE -ne 0) { throw 'Git identity read failed' }
  return ,$taskValue
}
function Assert-Source {
  $script:taskMismatch=@()
  if ((Read-Git @('rev-parse','HEAD'))[0] -cne $script:taskHead) { $script:taskMismatch+='HEAD' }
  if ((Read-Git @('branch','--show-current'))[0] -cne $script:taskBranchBefore) { $script:taskMismatch+='BRANCH' }
  if ((Get-FileHash -LiteralPath $script:taskIndexPath).Hash -cne $script:taskIndexBefore) { $script:taskMismatch+='INDEX' }
  $taskCurrentFiles=Read-Git @('ls-files')
  if (Compare-Object $script:taskFiles $taskCurrentFiles) { $script:taskMismatch+='TRACKED_FILE_SET' }
  foreach ($taskFile in $script:taskFiles) { if ((Get-FileHash -LiteralPath $taskFile).Hash -cne $script:taskBefore[$taskFile]) { $script:taskMismatch+=$taskFile } }
  if ((Read-Git @('status','--porcelain','--untracked-files=no')).Count) { $script:taskMismatch+='TRACKED_STATE' }
  if ($script:taskMismatch.Count) { throw 'Source boundary changed' }
}
try {
  if ($env:GITHUB_ACTIONS -cne 'true' -or $env:GITHUB_REF -cne 'refs/heads/codex/ci-github-backend-basic' -or $env:RUNNER_OS -cne 'Windows') { throw 'Only authorized GitHub Windows cloud branch; no local execution' }
  if ($env:GITHUB_REPOSITORY -cne 'HG1127/agent-studio-cloud') { throw 'GitHub repository differs' }
  if ($env:GITHUB_SHA -cnotmatch '^[a-f0-9]{40}$') { throw 'Missing exact GitHub source SHA' }
  $taskHead=(Read-Git @('rev-parse','HEAD'))[0]
  $taskTree=(Read-Git @('rev-parse','HEAD^{tree}'))[0]
  if ($taskHead -cne $env:GITHUB_SHA -or (Read-Git @('status','--porcelain')).Count) { throw 'Exact clean commit required' }
  $taskBranchBefore=(Read-Git @('branch','--show-current'))[0]
  $taskFiles=Read-Git @('ls-files')
  $taskIndexPath=(Read-Git @('rev-parse','--path-format=absolute','--git-path','index'))[0]
  $taskIndexBefore=(Get-FileHash -LiteralPath $taskIndexPath).Hash
  $taskBefore=@{}
  foreach ($taskFile in $taskFiles) { $taskBefore[$taskFile]=(Get-FileHash -LiteralPath $taskFile).Hash }
  $taskInitialized=$true
  if (Test-Path -LiteralPath $taskReport) { throw 'Old reports cannot be reused or overwritten' }
  $null=New-Item -ItemType Directory -Path $taskReport
  $taskReportCreated=$true
  if (-not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'Windows x64 required' }
  foreach ($taskFile in @('.env','.env.local','.env.test','.env.test.local','.env.production','.env.production.local','.env.development','.env.development.local')) {
    if (Test-Path -LiteralPath $taskFile) { throw 'Private environment file present' }
  }
  if (Test-Path -LiteralPath 'node_modules') { throw 'Own clean VM installation required' }
  if ((Read-Git @('rev-parse','HEAD:package.json'))[0] -cne '9f06b679b994bc9fd5a5d771a4aa6f42f5c29dce' -or
      (Read-Git @('rev-parse','HEAD:pnpm-lock.yaml'))[0] -cne 'd6b822d7355b8eabf5112a32662b40c6097b1856') { throw 'Approved package or lock Git blob changed' }
  $taskNode=(Get-Command node.exe -CommandType Application).Source
  $taskCorepack=Join-Path (Split-Path -Parent $taskNode) 'node_modules/corepack/dist/pnpm.js'
  if (-not (Test-Path -LiteralPath $taskCorepack)) { throw 'Corepack missing; no install attempted' }
  $taskDefinitions=@(
    @{Name='node24';Heap=128;Gate=1024;Args=@('-e','if(process.platform!=="win32"||process.arch!=="x64"||process.versions.node.split(".")[0]!=="24")throw Error("Node24 win32 x64 required");console.log(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch}))')},
    @{Name='pnpm-version';Heap=768;Gate=1792;Args=@($taskCorepack,'--version')},
    @{Name='frozen-install';Heap=768;Gate=1792;Args=@($taskCorepack,'install','--frozen-lockfile')},
    @{Name='fresh-audit';Heap=768;Gate=1792;Args=@($taskCorepack,'audit','--prod','--audit-level','high')},
    @{Name='typegen';Heap=1536;Gate=2048;Args=@($taskCorepack,'exec','next','typegen')},
    @{Name='tsc';Heap=1536;Gate=2048;Args=@($taskCorepack,'exec','tsc','--noEmit')},
    @{Name='lint';Heap=768;Gate=2048;Args=@($taskCorepack,'exec','eslint','.','--no-cache','--max-warnings=0')},
    @{Name='full-unit';Heap=768;Gate=2176;Args=@($taskCorepack,'exec','vitest','run','--pool=forks','--maxWorkers=1','--isolate','--no-file-parallelism','--no-cache','--no-fsModuleCache','--retry=0','--execArgv=--max-old-space-size=384','--reporter=default','--reporter=json','--outputFile=github-basic-reports/unit-results.json')},
    @{Name='helper2';Heap=768;Gate=2176;Args=@($taskCorepack,'exec','vitest','run','--config','tests/helpers/mvp-acceptance-recovery.config.mts','--pool=forks','--maxWorkers=1','--isolate','--no-file-parallelism','--no-cache','--retry=0','--execArgv=--max-old-space-size=384','--reporter=default','--reporter=json','--outputFile=github-basic-reports/helper-results.json')},
    @{Name='build';Heap=1536;Gate=8192;Args=@($taskCorepack,'build')}
  )
  foreach ($taskDefinition in $taskDefinitions) {
    Assert-Source
    $taskStage=$taskDefinition.Name
    $taskStart=[Diagnostics.ProcessStartInfo]::new()
    $taskStart.FileName=$taskNode
    $taskStart.WorkingDirectory=$taskRoot
    $taskStart.UseShellExecute=$false
    $taskStart.RedirectStandardOutput=$true
    $taskStart.RedirectStandardError=$true
    $taskStart.Environment.Clear()
    foreach ($taskName in @('SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA')) {
      $taskValue=[Environment]::GetEnvironmentVariable($taskName)
      if ($taskValue) { $taskStart.Environment[$taskName]=$taskValue }
    }
    $taskStart.Environment['CI']='1'
    $taskStart.Environment['NODE_OPTIONS']="--max-old-space-size=$($taskDefinition.Heap)"
    $taskStart.Environment['NEXT_TELEMETRY_DISABLED']='1'
    $taskStart.Environment['DATABASE_URL']='postgresql://ci:ci@127.0.0.1:1/unavailable'
    $taskStart.Environment['DATABASE_URL_POOLED']=$taskStart.Environment['DATABASE_URL']
    $taskStart.Environment['MODEL_MOCK']='1'
    $taskStart.Environment['REAL_MODELS_ENABLED']='0'
    $taskStart.Environment['MVP_ACCEPTANCE_ISOLATED_DB']='0'
    $taskStart.Environment['MODEL_ENCRYPTION_KEY']=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $taskStart.Environment['CRON_SECRET']=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    Write-Output ('::add-mask::' + $taskStart.Environment['MODEL_ENCRYPTION_KEY'])
    Write-Output ('::add-mask::' + $taskStart.Environment['CRON_SECRET'])
    foreach ($taskArg in $taskDefinition.Args) { $taskStart.ArgumentList.Add($taskArg) }
    $taskOs=Get-CimInstance Win32_OperatingSystem
    $taskMemory=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
    $taskPhysical=[math]::Floor($taskOs.FreePhysicalMemory/1024)
    $taskCommit=[math]::Floor(($taskMemory.CommitLimit-$taskMemory.CommittedBytes)/1MB)
    $taskGates+=[ordered]@{Stage=$taskStage;Time=[DateTimeOffset]::UtcNow.ToString('o');PhysicalMiB=$taskPhysical;CommitMiB=$taskCommit;RequiredMiB=$taskDefinition.Gate}
    if ($taskPhysical -lt $taskDefinition.Gate -or $taskCommit -lt $taskDefinition.Gate) { throw "Resource blocked; $taskStage not started" }
    $taskLogName = $taskStage.Replace('/','_') + '.log'
    $taskStdoutPath = Join-Path $taskReport ($taskLogName + '.stdout.raw')
    $taskStderrPath = Join-Path $taskReport ($taskLogName + '.stderr.raw')
    $taskStdout = [System.IO.File]::Create($taskStdoutPath)
    $taskStderr = [System.IO.File]::Create($taskStderrPath)
    $taskTransportFailures = @()
    $taskReadFault = $false
    $taskDrains = @()
    $taskRaw[$taskStage] = [ordered]@{ ProcessId=$null; Terminal=$false; ExitCode=$null; ReadFailure=$false; ProcessMayBeAlive=$null;
      Stdout=$taskStdoutPath; StdoutEof=$false; StdoutComplete=$true; StdoutSha256=$null; StdoutDisplay='not-attempted';
      Stderr=$taskStderrPath; StderrEof=$false; StderrComplete=$true; StderrSha256=$null; StderrDisplay='not-attempted'; TransportFailures=@() }
    try {
      $taskProcess = [System.Diagnostics.Process]::Start($taskStart)
      $taskRaw[$taskStage].ProcessId = $taskProcess.Id
      $taskRaw[$taskStage]['ProcessBirthUtc'] = $taskProcess.StartTime.ToUniversalTime().ToString('o')
      $taskDrains = @(
        @{ Name='Stdout'; Reader=$taskProcess.StandardOutput.BaseStream; Writer=$taskStdout; Buffer=[byte[]]::new(65536); Pending=$null; Active=$true },
        @{ Name='Stderr'; Reader=$taskProcess.StandardError.BaseStream; Writer=$taskStderr; Buffer=[byte[]]::new(65536); Pending=$null; Active=$true }
      )
      $script:taskRetainedTransport = @{ Process=$taskProcess; Readers=$taskDrains; Stage=$taskStage }
      foreach ($taskDrain in $taskDrains) {
        try { $taskDrain.Pending = $taskDrain.Reader.ReadAsync($taskDrain.Buffer, 0, $taskDrain.Buffer.Length) }
        catch {
          $taskDrain.Active = $false
          $taskRaw[$taskStage][$taskDrain.Name + 'Complete'] = $false
          $taskTransportFailures += ($taskDrain.Name.ToLowerInvariant() + '-read-start-failed')
          $taskReadFault = $true
        }
      }
      if ($taskReadFault) { throw "Stage $taskStage reader start failed; preserve process and readers" }
      while (-not $taskRaw[$taskStage].Terminal -or $taskDrains[0].Active -or $taskDrains[1].Active) {
        foreach ($taskDrain in $taskDrains) {
          if (-not $taskDrain.Active -or -not $taskDrain.Pending.IsCompleted) { continue }
          try { $taskChunkLength = $taskDrain.Pending.GetAwaiter().GetResult() }
          catch {
            $taskDrain.Active = $false
            $taskRaw[$taskStage][$taskDrain.Name + 'Complete'] = $false
            $taskTransportFailures += ($taskDrain.Name.ToLowerInvariant() + '-read-failed')
            $taskReadFault = $true
            break
          }
          if ($taskChunkLength -eq 0) {
            $taskDrain.Active = $false
            $taskRaw[$taskStage][$taskDrain.Name + 'Eof'] = $true
            continue
          }
          if ($taskRaw[$taskStage][$taskDrain.Name + 'Complete']) {
            try { $taskDrain.Writer.Write($taskDrain.Buffer, 0, $taskChunkLength) }
            catch {
              $taskRaw[$taskStage][$taskDrain.Name + 'Complete'] = $false
              $taskTransportFailures += ($taskDrain.Name.ToLowerInvariant() + '-write-failed')
            }
          }
          try { $taskDrain.Pending = $taskDrain.Reader.ReadAsync($taskDrain.Buffer, 0, $taskDrain.Buffer.Length) }
          catch {
            $taskDrain.Active = $false
            $taskRaw[$taskStage][$taskDrain.Name + 'Complete'] = $false
            $taskTransportFailures += ($taskDrain.Name.ToLowerInvariant() + '-read-start-failed')
            $taskReadFault = $true
            break
          }
        }
        if ($taskReadFault) { throw "Stage $taskStage reader failed; preserve process and readers" }
        if (-not $taskRaw[$taskStage].Terminal -and $taskProcess.HasExited) {
          $taskRaw[$taskStage].ExitCode = $taskProcess.ExitCode
          $taskRaw[$taskStage].Terminal = $true
          $taskStages[$taskStage] = $taskProcess.ExitCode
        }
        if (-not $taskRaw[$taskStage].Terminal -or $taskDrains[0].Active -or $taskDrains[1].Active) {
          [System.Threading.Thread]::Sleep(10)
        }
      }
    } finally {
      if ($taskReadFault) {
        $taskRaw[$taskStage].ReadFailure = $true
        try {
          if ($taskProcess.HasExited) {
            $taskRaw[$taskStage].ExitCode = $taskProcess.ExitCode
            $taskRaw[$taskStage].Terminal = $true
            $taskStages[$taskStage] = $taskProcess.ExitCode
          }
        } catch { $taskTransportFailures += 'exit-observation-failed' }
      }
      $taskRaw[$taskStage].ProcessMayBeAlive = -not $taskRaw[$taskStage].Terminal
      foreach ($taskWriter in @(@{ Name='Stdout'; Writer=$taskStdout }, @{ Name='Stderr'; Writer=$taskStderr })) {
        try { $taskWriter.Writer.Dispose() }
        catch {
          $taskRaw[$taskStage][$taskWriter.Name + 'Complete'] = $false
          $taskTransportFailures += ($taskWriter.Name.ToLowerInvariant() + '-close-failed')
        }
      }
      $taskRaw[$taskStage].TransportFailures = $taskTransportFailures
    }
    foreach ($taskStreamName in @('Stdout', 'Stderr')) {
      $taskStreamPath = $taskRaw[$taskStage][$taskStreamName]
      if (-not $taskRaw[$taskStage][$taskStreamName + 'Eof'] -or -not $taskRaw[$taskStage][$taskStreamName + 'Complete']) { continue }
      try { $taskRaw[$taskStage][$taskStreamName + 'Sha256'] = (Get-FileHash -LiteralPath $taskStreamPath).Hash }
      catch { $taskTransportFailures += ($taskStreamName.ToLowerInvariant() + '-hash-failed') }
      $taskDisplayStream = $null
      try {
        $taskDisplayStream = [System.IO.File]::OpenRead($taskStreamPath)
        if ($taskDisplayStream.Length -gt 1MB) {
          $taskRaw[$taskStage][$taskStreamName + 'Display'] = 'omitted-over-1MiB'
          Write-Output "$taskStreamName display omitted; full bytes retained in $taskStreamPath"
        } else {
          $taskDisplayBytes = [byte[]]::new([int]$taskDisplayStream.Length + 1)
          $taskDisplayLength = 0
          while ($taskDisplayLength -lt $taskDisplayBytes.Length) {
            $taskRead = $taskDisplayStream.Read($taskDisplayBytes, $taskDisplayLength, $taskDisplayBytes.Length - $taskDisplayLength)
            if ($taskRead -eq 0) { break }
            $taskDisplayLength += $taskRead
          }
          if ($taskDisplayLength -gt 1MB -or $taskDisplayLength -ne $taskDisplayStream.Length) { throw 'Bounded log size changed' }
          $taskStrictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
          Write-Output ($taskStrictUtf8.GetString($taskDisplayBytes, 0, $taskDisplayLength))
          $taskRaw[$taskStage][$taskStreamName + 'Display'] = 'strict-utf8'
        }
      } catch {
        $taskRaw[$taskStage][$taskStreamName + 'Display'] = 'failed'
        $taskTransportFailures += ($taskStreamName.ToLowerInvariant() + '-display-failed')
      } finally { if ($taskDisplayStream) { $taskDisplayStream.Dispose() } }
    }
    $taskRaw[$taskStage].TransportFailures = $taskTransportFailures
    Write-Output "Stage=$taskStage ExitCode=$($taskProcess.ExitCode)"
    if ($taskTransportFailures.Count) { throw "Stage $taskStage transport failed: $($taskTransportFailures -join ', ')" }
    if ($taskProcess.ExitCode -ne 0) { throw "Stage $taskStage failed" }
    Assert-Source
    if ($taskStage -eq 'pnpm-version') {
      $taskVersion=[Text.UTF8Encoding]::new($false,$true).GetString([IO.File]::ReadAllBytes($taskRaw[$taskStage].Stdout)).Trim()
      if ($taskVersion -cne '11.23.0') { throw 'pnpm version mismatch' }
    }
    if ($taskStage -eq 'fresh-audit') { $taskFreshAuditPassed=$true }
    if ($taskStage -in @('full-unit','helper2')) {
      $taskJson=Get-Content -Raw -LiteralPath (Join-Path $taskReport $(if($taskStage -eq 'helper2'){'helper-results.json'}else{'unit-results.json'})) | ConvertFrom-Json
      $taskAssertions=@($taskJson.testResults | ForEach-Object {$_.assertionResults})
      if (-not $taskJson.success -or -not $taskAssertions.Count -or @($taskAssertions | Where-Object status -ne 'passed').Count) { throw 'Assertions missing, skipped or failed' }
      if ($taskStage -eq 'full-unit') {
        $taskExpectedTests=@($taskFiles | Where-Object { $_ -cmatch '^(src/|tests/(contract|domain|component)/).*\.test\.(ts|tsx)$' })
        if (-not $taskExpectedTests.Count) { throw 'Expected ordinary test file set is empty' }
        foreach ($taskTest in $taskExpectedTests) {
          $taskTestPath=[IO.Path]::GetFullPath((Join-Path $taskRoot $taskTest)).Replace('\','/')
          $taskSuites=@($taskJson.testResults | Where-Object { $_.name.Replace('\','/') -ceq $taskTestPath })
          if ($taskSuites.Count -ne 1 -or -not @($taskSuites[0].assertionResults).Count) { throw "Ordinary test file missing: $taskTest" }
        }
      }
      if ($taskStage -eq 'helper2' -and $taskAssertions.Count -ne 2) { throw 'Explicit helper must pass exactly two assertions' }
    }
  }
} catch { $taskFailure=$_.Exception.Message }
if ($taskInitialized) { try { Assert-Source } catch { if (-not $taskFailure) {$taskFailure=$_.Exception.Message} } }
$taskResult=[ordered]@{VerificationScope=$Mode;Provider='GitHub Actions standard Windows';RunId=$env:GITHUB_RUN_ID;RunAttempt=$env:GITHUB_RUN_ATTEMPT;TriggeredSha=$env:GITHUB_SHA;TriggeredRef=$env:GITHUB_REF;Head=$taskHead;Tree=$taskTree;IndexBefore=$taskIndexBefore;Stages=$taskStages;Raw=$taskRaw;Gates=$taskGates;SourceMismatch=$taskMismatch;Failure=$taskFailure;BasicPassed=(-not $taskFailure -and -not $taskMismatch.Count -and $taskStages.Count -eq 10 -and -not @($taskStages.Values | Where-Object {$_ -ne 0}).Count);FullAcceptancePassed=$false;FreshAuditPassed=$taskFreshAuditPassed;UnrunFullGates=@('isolated-db','migration','actual-workflow','41-guard','e2e','strict-cleanup','preview-access','real-provider')}
if ($taskReportCreated) { $taskResult | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskReport 'result.json') -Encoding utf8 }
$taskResult | ConvertTo-Json -Depth 8
if ($taskFailure -or $taskMismatch.Count) { exit 1 }
