$Mode='GitHubOfflineMigrationGeneration'
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$taskRoot=(Get-Location).Path
$env:GIT_OPTIONAL_LOCKS='0'
$taskStages=[ordered]@{}; $taskRaw=[ordered]@{}; $taskGates=@(); $taskFailure=$null; $taskMismatch=@(); $taskInitialized=$false; $taskGenerated=$false
$taskReport=Join-Path $taskRoot 'github-offline-migration-reports'
$taskReportCreated=$false
$taskDeltaValidationFailure=$null
function Read-Git([string[]]$Arguments) {
  $taskValue=@(& git --no-optional-locks @Arguments)
  if ($LASTEXITCODE -ne 0) { throw 'Git identity read failed' }
  return ,$taskValue
}
function Assert-Source {
  if ((Read-Git @('rev-parse','HEAD'))[0] -cne $script:taskHead) { $script:taskMismatch+='HEAD' }
  if ((Read-Git @('branch','--show-current'))[0] -cne $script:taskBranchBefore) { $script:taskMismatch+='BRANCH' }
  if ((Get-FileHash -LiteralPath $script:taskIndexPath).Hash -cne $script:taskIndexBefore) { $script:taskMismatch+='INDEX' }
  $taskCurrentFiles=Read-Git @('ls-files')
  if (Compare-Object $script:taskFiles $taskCurrentFiles) { $script:taskMismatch+='TRACKED_FILE_SET' }
  foreach ($taskFile in $script:taskFiles) { if ($script:taskGenerated -and $taskFile -ceq 'src/db/migrations/meta/_journal.json') { continue }; if ((Get-FileHash -LiteralPath $taskFile).Hash -cne $script:taskBefore[$taskFile]) { $script:taskMismatch+=$taskFile } }
  $taskTrackedState=Read-Git @('status','--porcelain','--untracked-files=no')
  if (@($taskTrackedState | Where-Object { -not ($script:taskGenerated -and $_ -ceq ' M src/db/migrations/meta/_journal.json') }).Count) { $script:taskMismatch+='TRACKED_STATE' }
  if ($script:taskMismatch.Count) { throw 'Source boundary changed' }
}
try {
  if ($env:GITHUB_ACTIONS -cne 'true' -or $env:GITHUB_REF -cne 'refs/heads/codex/ci-backend-migrations-offline' -or $env:RUNNER_OS -cne 'Windows') { throw 'Only authorized GitHub Windows cloud branch; no local execution' }
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
  & git --no-optional-locks merge-base --is-ancestor ba842bb976f6e46b328fcd6fd8e3b49e94a4555b HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Tested baseline must be an ancestor' }
  $taskJournalBefore=Get-Content -Raw -LiteralPath 'src/db/migrations/meta/_journal.json' | ConvertFrom-Json
  $taskHistory=@($taskFiles | Where-Object { $_ -clike 'src/db/migrations/*' })
  if ($taskHistory.Count -ne 71) { throw 'Historical migration file count changed' }
  foreach ($taskBaseFile in (Read-Git @('ls-tree','-r','--name-only','ba842bb976f6e46b328fcd6fd8e3b49e94a4555b'))) {
    if ($taskBaseFile -ceq 'vercel.json') { continue }
    if ((Read-Git @('rev-parse',('HEAD:'+$taskBaseFile)))[0] -cne (Read-Git @('rev-parse',('ba842bb976f6e46b328fcd6fd8e3b49e94a4555b:'+$taskBaseFile)))[0]) { throw 'Tested baseline source changed' }
  }
  $taskVercel=Get-Content -Raw -LiteralPath 'vercel.json' | ConvertFrom-Json
  if ($taskVercel.git.deploymentEnabled.'codex/ci-backend-migrations-offline' -ne $false -or $taskVercel.git.deploymentEnabled.'codex/ci-github-backend-basic' -ne $false) { throw 'CI branch deployment disabled guards missing' }
  $taskGenerated=$false
  $taskDelta=@()
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
  $taskNodeCommand=Get-Command node.exe -CommandType Application | Select-Object -First 1
  $taskNode=[string]$taskNodeCommand.Source
  if ([string]::IsNullOrWhiteSpace($taskNode) -or -not [IO.Path]::IsPathFullyQualified($taskNode) -or -not (Test-Path -LiteralPath $taskNode -PathType Leaf)) { throw 'First Node application path is invalid; no process started' }
  $taskCorepack=Join-Path (Split-Path -Parent $taskNode) 'node_modules/corepack/dist/pnpm.js'
  if (-not (Test-Path -LiteralPath $taskCorepack)) { throw 'Corepack missing; no install attempted' }
  $taskDefinitions=@(
    @{Name='node24';Heap=128;Gate=1024;Args=@('-e','if(process.platform!=="win32"||process.arch!=="x64"||process.versions.node.split(".")[0]!=="24")throw Error("Node24 win32 x64 required");console.log(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch}))')},
    @{Name='pnpm-version';Heap=768;Gate=1792;Args=@($taskCorepack,'--version')},
    @{Name='frozen-install';Heap=768;Gate=1792;Args=@($taskCorepack,'install','--frozen-lockfile','--ignore-scripts')},
    @{Name='generate';Heap=768;Gate=1792;Args=@('--require',(Join-Path $PSScriptRoot 'offline-migration-deny-network.cjs'),(Join-Path $taskRoot 'node_modules/drizzle-kit/bin.cjs'),'generate','--config=drizzle.offline.config.ts','--name=mvp_backend')}
  )
  foreach ($taskDefinition in $taskDefinitions) {
    Assert-Source
    $taskStage=$taskDefinition.Name
    if ($taskStage -eq 'generate') {
      $taskPackage=Get-Content -Raw -LiteralPath 'node_modules/drizzle-kit/package.json' | ConvertFrom-Json
      $taskCliHash=(Get-FileHash -LiteralPath 'node_modules/drizzle-kit/bin.cjs').Hash
      if ($taskPackage.version -cne '0.31.10' -or $taskCliHash -cne '44F5420E63C88E13E750F5233878B054E262C3223BD94EABF6AC05B2AE77ABD7') { throw 'Reviewed drizzle-kit CLI differs' }
    }
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
    $taskStart.Environment['npm_config_userconfig']=Join-Path $PSScriptRoot 'offline-migration-empty-userconfig'
    $taskStart.Environment['COREPACK_ENABLE_NETWORK']=$(if ($taskStage -eq 'generate') {'0'} else {'1'})
    $taskStart.RedirectStandardInput=$true
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
      $taskProcess.StandardInput.Close()
      if ($taskStage -eq 'generate') { $taskGenerated=$true }
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

  }
} catch { $taskFailure=$_.Exception.Message }
if ($taskInitialized) { try { Assert-Source } catch { if (-not $taskFailure) {$taskFailure=$_.Exception.Message} } }
if ($taskGenerated) {
  try {
    $taskUntrackedFiles=Read-Git @('ls-files','--others','--exclude-standard')
    if (@($taskUntrackedFiles | Where-Object { $_ -isnot [string] }).Count) { throw 'Untracked file list must contain individual strings' }
    $taskObserved=@($taskUntrackedFiles | Where-Object { $_ -clike 'src/db/migrations/*' })
    if ((Get-FileHash -LiteralPath 'src/db/migrations/meta/_journal.json').Hash -cne $taskBefore['src/db/migrations/meta/_journal.json']) { $taskObserved+='src/db/migrations/meta/_journal.json' }
    foreach ($taskPath in $taskObserved) {
      $taskBytes=[IO.File]::ReadAllBytes((Join-Path $taskRoot $taskPath))
      if ($taskBytes.Length -gt 64MB) { throw 'Generated file exceeds publication limit' }
      $taskName=$taskPath.Replace('/','__')
      [IO.File]::WriteAllBytes((Join-Path $taskReport $taskName),$taskBytes)
      $taskDelta+=[ordered]@{Path=$taskPath;ReportFile=$taskName;Bytes=$taskBytes.Length;SHA256=(Get-FileHash -LiteralPath $taskPath).Hash}
    }
    $taskAfter=Get-Content -Raw -LiteralPath 'src/db/migrations/meta/_journal.json' | ConvertFrom-Json
    if ($taskAfter.version -cne $taskJournalBefore.version -or $taskAfter.dialect -cne $taskJournalBefore.dialect -or $taskAfter.entries.Count -ne $taskJournalBefore.entries.Count+1) { throw 'Journal must be exactly one append' }
    for ($taskI=0;$taskI -lt $taskJournalBefore.entries.Count;$taskI++) { if (($taskAfter.entries[$taskI]|ConvertTo-Json -Compress) -cne ($taskJournalBefore.entries[$taskI]|ConvertTo-Json -Compress)) { throw 'Historical journal entry changed' } }
    $taskLast=$taskAfter.entries[-1]
    if ($taskLast.idx -ne 35 -or $taskLast.tag -cne '0035_mvp_backend' -or $taskLast.version -cne '7' -or $taskLast.breakpoints -ne $true) { throw 'Unexpected new migration identity' }
    $taskUntrackedFiles=Read-Git @('ls-files','--others','--exclude-standard')
    if (@($taskUntrackedFiles | Where-Object { $_ -isnot [string] }).Count) { throw 'Untracked file list must contain individual strings' }
    $taskUntracked=@($taskUntrackedFiles | Where-Object { $_ -cnotlike 'github-offline-migration-reports/*' })
    $taskExpected=@('src/db/migrations/0035_mvp_backend.sql','src/db/migrations/meta/0035_snapshot.json')
    if ($taskUntracked.Count -ne 2 -or (Compare-Object $taskExpected $taskUntracked)) { throw 'Unexpected generated delta file set' }
    $taskSnapshot=Get-Content -Raw -LiteralPath 'src/db/migrations/meta/0035_snapshot.json'|ConvertFrom-Json
    $taskPrevious=Get-Content -Raw -LiteralPath 'src/db/migrations/meta/0034_snapshot.json'|ConvertFrom-Json
    if ($taskSnapshot.prevId -cne $taskPrevious.id -or $taskSnapshot.version -cne '7' -or $taskSnapshot.dialect -cne 'postgresql') { throw 'Snapshot lineage mismatch' }
  } catch { $taskDeltaValidationFailure=$_.Exception.Message; if (-not $taskFailure) { $taskFailure=$taskDeltaValidationFailure } }
}
$taskResult=[ordered]@{VerificationScope=$Mode;Provider='GitHub Actions standard Windows';RunId=$env:GITHUB_RUN_ID;RunAttempt=$env:GITHUB_RUN_ATTEMPT;TriggeredSha=$env:GITHUB_SHA;TriggeredRef=$env:GITHUB_REF;Head=$taskHead;Tree=$taskTree;IndexBefore=$taskIndexBefore;Stages=$taskStages;Raw=$taskRaw;Gates=$taskGates;SourceMismatch=$taskMismatch;Failure=$taskFailure;DeltaValidationFailure=$taskDeltaValidationFailure;HistoricalFiles=$taskHistory.Count;DrizzleCliSha256=$taskCliHash;Delta=$taskDelta;GenerationPassed=(-not $taskFailure -and -not $taskMismatch.Count -and $taskStages.Count -eq 4 -and $taskGenerated -and $taskDelta.Count -eq 3 -and -not @($taskStages.Values | Where-Object {$_ -ne 0}).Count);MigrationApplied=$false;DatabaseVerified=$false;FullAcceptancePassed=$false}

if ($taskReportCreated) { $taskResult | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskReport 'result.json') -Encoding utf8 }
if ($taskReportCreated) {
  try {
    foreach ($taskEvidenceFile in @(Get-ChildItem -LiteralPath $taskReport -File | Sort-Object Name)) {
      $taskEvidenceStream=$null
      try {
        $taskEvidenceHash=(Get-FileHash -LiteralPath $taskEvidenceFile.FullName).Hash
        $taskEvidenceStream=[IO.File]::OpenRead($taskEvidenceFile.FullName)
        if ($taskEvidenceStream.Length -gt 64MB) { throw 'Evidence exceeds bounded publication limit' }
        $taskEvidenceLength=$taskEvidenceStream.Length
        $taskEvidenceBuffer=[byte[]]::new(6144)
        $taskEvidenceTail=''
        while (($taskEvidenceRead=$taskEvidenceStream.Read($taskEvidenceBuffer,0,$taskEvidenceBuffer.Length)) -gt 0) {
          $taskEvidenceAscii=$taskEvidenceTail+[Text.Encoding]::ASCII.GetString($taskEvidenceBuffer,0,$taskEvidenceRead)
          $taskEvidenceTail=$taskEvidenceAscii.Substring([Math]::Max(0,$taskEvidenceAscii.Length-64))
        }
        $taskEvidenceStream.Position=0
        Write-Output ('OFFLINE_MIGRATION_EVIDENCE_BEGIN '+$taskEvidenceFile.Name+' '+$taskEvidenceLength+' '+$taskEvidenceHash)
        $taskEvidenceChunk=0
        while (($taskEvidenceRead=$taskEvidenceStream.Read($taskEvidenceBuffer,0,$taskEvidenceBuffer.Length)) -gt 0) {
          Write-Output ('OFFLINE_MIGRATION_EVIDENCE_CHUNK '+$taskEvidenceFile.Name+' '+$taskEvidenceChunk+' '+[Convert]::ToBase64String($taskEvidenceBuffer,0,$taskEvidenceRead))
          $taskEvidenceChunk++
        }
        if ($taskEvidenceStream.Length -ne $taskEvidenceLength -or (Get-FileHash -LiteralPath $taskEvidenceFile.FullName).Hash -cne $taskEvidenceHash) { throw 'Published evidence changed' }
        Write-Output ('OFFLINE_MIGRATION_EVIDENCE_END '+$taskEvidenceFile.Name+' '+$taskEvidenceChunk+' '+$taskEvidenceHash)
      } finally { if ($taskEvidenceStream) { $taskEvidenceStream.Dispose() } }
    }
  } catch {
    $taskFailure='Free log evidence publication failed: '+$_.Exception.Message
    $taskResult.Failure=$taskFailure
    $taskResult.GenerationPassed=$false
    $taskResult | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskReport 'result.json') -Encoding utf8
  }
}
$taskResult | ConvertTo-Json -Depth 8
if ($taskFailure -or $taskMismatch.Count) { exit 1 }
