#Requires -Version 7.5
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$CaseId,
  [Parameter(Mandatory)][string]$ContextFile,
  [Parameter(Mandatory)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:WorkflowCreationPins = @{}
$script:WorkflowDirectoryPins = @{}
$script:WorkflowCaseFilePins = @{}
$script:WorkflowProcessRuns = @{}
. (Join-Path $PSScriptRoot 'workflow-acceptance-control-plane.ps1')
function Invoke-OwnedCaseProcess {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$CaseDirectory, [string]$BridgeRequestFile,
    [ValidateSet('business','bridge','migration')][string]$Phase = 'business')
  if ($BridgeRequestFile) { $Phase = 'bridge' }
  $taskProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $taskNode = 'C:/Program Files/nodejs/node.exe'
  $taskCli = Join-Path $taskProjectRoot 'node_modules/vitest/vitest.mjs'
  $taskConfig = Join-Path $taskProjectRoot 'tests/workflow/owned-case-child.config.mts'
  $taskBusinessDependencies = @()
  if ($Phase -eq 'business') {
    $taskCli = Join-Path $taskProjectRoot 'tests/helpers/owned-workflow-cli.mjs'
    $taskPreloadFile = [IO.Path]::GetFullPath((Join-Path $taskProjectRoot 'tests/helpers/owned-workflow-preload.mjs'))
    $taskBusinessDependencies = @($taskPreloadFile,
      (Join-Path $taskProjectRoot 'tests/workflow/owned-case-child-entry.ts'),
      (Join-Path $taskProjectRoot 'tests/workflow/owned-case-business.ts'),
      (Join-Path $taskProjectRoot 'tests/helpers/collect-owned-workflow-realms.ts'))
  }
  if ($Phase -eq 'bridge') { $taskConfig = Join-Path $taskProjectRoot 'tests/workflow/owned-case-bridge.config.mts' }
  if ($Phase -eq 'migration') { $taskCli = Join-Path $taskProjectRoot 'node_modules/drizzle-kit/bin.cjs'; $taskConfig = Join-Path $taskProjectRoot 'drizzle.config.ts' }
  foreach ($taskFile in @($taskNode, $taskCli, $taskConfig)) {
    if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw '独占子域运行依赖未就绪。' }
  }
  foreach ($taskFile in $taskBusinessDependencies) {
    if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw '专用业务入口、业务执行或空间收集依赖尚未齐备，拒绝启动。' }
  }
  $taskSdkRoot = [IO.Path]::GetFullPath([string]$Context.sdkDirectory)
  foreach ($taskDirectory in @($CaseDirectory, $taskSdkRoot, (Join-Path $taskSdkRoot 'realms'))) {
    $taskCurrent = [IO.Path]::GetFullPath($taskDirectory)
    while ($taskCurrent) {
      $taskItem = Get-Item -LiteralPath $taskCurrent -Force
      if (-not $taskItem.PSIsContainer -or ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '自有执行目录存在重解析或归属未知。' }
      $taskParent = [IO.Path]::GetDirectoryName($taskCurrent)
      if (-not $taskParent -or $taskParent -eq $taskCurrent) { break }
      $taskCurrent = $taskParent
    }
  }
  $taskOutput = Join-Path $CaseDirectory 'child-result.json'
  if ($Phase -eq 'business' -and (Test-Path -LiteralPath $taskOutput)) { throw '子报告已存在，拒绝覆盖旧案例。' }
  if (-not $script:WorkflowOwnedCreations.ContainsKey([string]$Context.databaseBranchId)) { throw '子域没有本次父创建事件。' }
  $taskCreation = $script:WorkflowOwnedCreations[[string]$Context.databaseBranchId]
  $taskFinalizing = ($Phase -eq 'bridge' -and $taskCreation.ContainsKey('absenceVerified') -and $taskCreation.absenceVerified -eq $true -and
    [IO.Path]::GetFileName($BridgeRequestFile) -ceq 'finalize-request.json')
  $taskDirectUri = $null
  if (-not $taskFinalizing) {
    if (-not $script:WorkflowDirectConnections.ContainsKey([string]$Context.databaseBranchId)) { throw '没有本控制器实际读取的专用连接，拒绝借用外部URI。' }
    $taskDirectUri = $script:WorkflowDirectConnections[[string]$Context.databaseBranchId]
    if ([string]::IsNullOrWhiteSpace($taskDirectUri)) { throw '缺少经父控制器验证的专用直接连接。' }
  }
  if (-not ('AgentStudioAcceptance.OwnedProcessDomain' -as [type])) {
    Add-Type -LiteralPath (Join-Path $PSScriptRoot 'workflow-acceptance-process-domain.cs')
  }
  $taskEnvironment = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
  $taskWindows = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
  $taskEnvironment['SystemRoot'] = $taskWindows
  $taskEnvironment['WINDIR'] = $taskWindows
  $taskEnvironment['PATH'] = ([IO.Path]::GetDirectoryName($taskNode), (Join-Path $taskWindows 'System32')) -join ';'
  $taskEnvironment['TEMP'] = $CaseDirectory
  $taskEnvironment['TMP'] = $CaseDirectory
  $taskEnvironment['CI'] = '1'
  $taskEnvironment['MODEL_MOCK'] = '1'
  $taskEnvironment['REAL_MODELS_ENABLED'] = '0'
  $taskEnvironment['MVP_ACCEPTANCE_ISOLATED_DB'] = '1'
  $taskEnvironment['MVP_WORKFLOW_ACCEPTANCE_CONTEXT'] = $Context | ConvertTo-Json -Depth 5 -Compress
  if (-not $taskFinalizing) { $taskEnvironment['MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED'] = $taskDirectUri }
  $taskEnvironment['MVP_WORKFLOW_ACCEPTANCE_CHILD_REPORT'] = $taskOutput
  $taskEnvironment['MVP_WORKFLOW_ACCEPTANCE_REALM_DIRECTORY'] = Join-Path $taskSdkRoot 'realms'
  $taskEnvironment['NODE_OPTIONS'] = '--max-old-space-size=768'
  $taskEnvironment['WORKFLOW_LOCAL_QUEUE_MAX_VISIBILITY'] = '5'
  if ($Phase -eq 'migration') { $taskEnvironment['DATABASE_URL'] = $taskDirectUri }
  if ($Phase -eq 'bridge') {
    $taskPin = $script:WorkflowCreationPins[[string]$Context.executionDomainId]
    if (-not $taskPin -or $taskPin.branchId -cne $Context.databaseBranchId -or $taskPin.directory -cne [IO.Path]::GetFullPath($CaseDirectory) -or $taskPin.handle.IsClosed -or -not $taskPin.handle.OriginalBytesUnchanged() -or $script:WorkflowDirectoryPins[[string]$Context.executionDomainId].IsClosed -or -not [IO.Path]::IsPathFullyQualified($BridgeRequestFile) -or [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($BridgeRequestFile)) -cne $taskPin.directory) { throw '父持有的本次创建文件或桥接路径未确认。' }
    if (-not $taskFinalizing) { $taskCreation = Confirm-OwnedWorkflowNeonBranch -BranchId $Context.databaseBranchId }
    if ($taskCreation.requestId -cne $taskPin.requestId) { throw '创建文件不属于本父控制器POST事件。' }
    $taskControlKey = [Environment]::GetEnvironmentVariable('NEON_API_KEY', 'User')
    if ([string]::IsNullOrWhiteSpace($taskControlKey)) { throw '专用观察桥配置未确认。' }
    $taskEnvironment['MVP_WORKFLOW_ACCEPTANCE_CREATION_SHA256'] = $taskPin.sha256
    $taskEnvironment['MVP_WORKFLOW_ACCEPTANCE_CONTROL_KEY'] = $taskControlKey
    $taskEnvironment['MVP_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_FILE'] = $BridgeRequestFile
    if ($taskPin.ContainsKey('observedPin')) {
      if ($taskPin.observedPin.IsClosed -or -not $taskPin.observedPin.OriginalBytesUnchanged()) { throw '父实际停止观察文件固定失效。' }
      $taskEnvironment['MVP_WORKFLOW_ACCEPTANCE_OBSERVED_SHA256'] = $taskPin.observedPin.Sha256
    }
    if ($taskCreation.ContainsKey('cleanupPin')) {
      if ($taskCreation.cleanupPin.IsClosed -or -not $taskCreation.cleanupPin.OriginalBytesUnchanged()) { throw '父真实清理回执固定失效。' }
      $taskEnvironment['MVP_WORKFLOW_ACCEPTANCE_CLEANUP_SHA256'] = $taskCreation.cleanupPin.Sha256
    }
    if ($taskFinalizing -and (-not $taskPin.ContainsKey('observedPin') -or -not $taskCreation.ContainsKey('cleanupPin'))) { throw '最终桥接缺少父真实观察与清理原字节证明。' }
    $taskControlKey = $null
  }
  foreach ($taskArgument in @($taskCli, $taskConfig)) {
    if ($taskArgument -match '["\r\n\x00]') { throw '子执行路径不可安全引用。' }
  }
  if ($Phase -eq 'business') {
    $taskPreloadUri = [Uri]::new($taskPreloadFile, [UriKind]::Absolute)
    if (-not $taskPreloadUri.IsFile -or $taskPreloadUri.Host -or $taskPreloadUri.Query -or $taskPreloadUri.Fragment -or
      -not [string]::Equals([IO.Path]::GetFullPath($taskPreloadUri.LocalPath), $taskPreloadFile, [StringComparison]::OrdinalIgnoreCase)) { throw '本树预加载文件地址未确认。' }
    $taskPreloadUrl = $taskPreloadUri.AbsoluteUri
    if ($taskPreloadUrl -match '["\r\n\x00]') { throw '预加载地址不可安全引用。' }
    $taskArguments = '--max-old-space-size=768 --import "' + $taskPreloadUrl + '" "' + $taskCli + '"'
  } else {
    $taskArguments = '"' + $taskCli + '" run --config "' + $taskConfig + '" --maxWorkers=1 --no-cache --no-fsModuleCache'
    if ($Phase -eq 'migration') { $taskArguments = '"' + $taskCli + '" migrate --config "' + $taskConfig + '"' }
  }
  $taskClock = $script:WorkflowExecutionClock
  if (-not $taskClock) { $taskClock = [Diagnostics.Stopwatch]::StartNew() }
  if (-not $script:WorkflowCaseFilePins.ContainsKey([string]$Context.executionDomainId) -or
    -not $script:WorkflowProcessRuns.ContainsKey([string]$Context.executionDomainId)) { throw '本次父创建的执行域不存在。' }
  $taskEsbuild = Join-Path $taskProjectRoot 'node_modules/.pnpm/@esbuild+win32-x64@0.28.2/node_modules/@esbuild/win32-x64/esbuild.exe'
  $taskBinaryPins = [Collections.Generic.List[IDisposable]]::new()
  $taskPinsRegistered = $false
  $taskDomain = $null
  $taskRecord = $null
  $taskImagesConfirmed = $false
  try {
    $taskNodePin = [AgentStudioAcceptance.OwnedBinaryPin]::OpenNode($taskNode)
    $taskBinaryPins.Add($taskNodePin)
    $taskEsbuildPin = [AgentStudioAcceptance.OwnedBinaryPin]::OpenEsbuild($taskEsbuild)
    $taskBinaryPins.Add($taskEsbuildPin)
    foreach ($taskBinaryPin in $taskBinaryPins) { $script:WorkflowCaseFilePins[[string]$Context.executionDomainId].Add($taskBinaryPin) }
    $taskPinsRegistered = $true
    $taskDomain = [AgentStudioAcceptance.OwnedProcessDomain]::new($taskNodePin, $taskEsbuildPin)
    $taskRemaining = [Math]::Max(0, 240000 - [int]$taskClock.ElapsedMilliseconds)
    if ($taskRemaining -le 0) { throw '原案例截止时间已到，拒绝启动子执行域。' }
    $taskDomain.StartRedirected($taskNode, $taskArguments, $taskProjectRoot, $taskEnvironment)
    $taskRemaining = [Math]::Max(0, 240000 - [int]$taskClock.ElapsedMilliseconds)
    if (-not $taskDomain.WaitForRootExit($taskRemaining)) { throw '子执行域超时，保留数据库资源。' }
    $taskRemaining = [Math]::Max(0, 240000 - [int]$taskClock.ElapsedMilliseconds)
    if (-not $taskDomain.WaitForZeroExitDomainStop($taskRemaining)) {
      throw '后台worker逐成员零退出或完整进程观测未确认，保留数据库资源。'
    }
    $taskRemaining = [Math]::Max(0, 240000 - [int]$taskClock.ElapsedMilliseconds)
    if (-not $taskDomain.WaitForOutputEof($taskRemaining)) {
      throw '自有进程、后台worker或输出终态未确认，保留数据库资源。'
    }
  } finally {
    try {
      if ($taskDomain -and $taskDomain.ProcessId -ne 0) {
        $taskInventory = $taskDomain.SnapshotProcessFacts()
        $taskImagesConfirmed = $taskDomain.AllProcessImagesConfirmed()
        if (-not $taskImagesConfirmed) { $taskInventory = $taskDomain.SnapshotProcessFacts() }
        $taskIds = @($taskInventory['members'] | ForEach-Object { [long]($_['processId']) })
        if ($taskIds.Count -lt 1 -or $taskIds.Count -gt 64 -or @($taskIds | Where-Object { $_ -lt 1 -or $_ -gt 0xffffffff }).Count) { throw '实际自有进程清单超出共享边界。' }
        $taskInventory['version'] = 1
        $taskInventory['phase'] = $Phase
        $taskInventory['context'] = @{ version = $Context.version; batchId = $Context.batchId; caseId = $Context.caseId;
          sourceCommit = $Context.sourceCommit; sourceFingerprint = $Context.sourceFingerprint; executionDomainId = $Context.executionDomainId;
          databaseBranchId = $Context.databaseBranchId; applicationName = $Context.applicationName; sdkDirectory = $Context.sdkDirectory }
        $taskRootMember = @($taskInventory['members'] | Where-Object { $_['processId'] -eq [long]$taskDomain.ProcessId })
        if ($taskRootMember.Count -ne 1) { throw '实际全量清单没有唯一根进程。' }
        $taskStoppedAt = $null
        if ($null -ne $taskInventory['stoppedAt']) {
          $taskStoppedAt = [DateTimeOffset]::ParseExact([string]$taskInventory['stoppedAt'], "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
            [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
        }
        $taskRecord = @{ phase = $Phase; processIds = $taskIds; rootProcessId = [long]$taskDomain.ProcessId;
          zeroExitObserved = $taskInventory['inventoryComplete']; natural = $false; inventoryComplete = $taskInventory['inventoryComplete'];
          outputEof = ($taskInventory['stdoutEof'] -and $taskInventory['stderrEof']); exitCode = $taskRootMember[0]['exitCode'];
          remainingProcesses = $taskInventory['remainingOwnedProcesses']; stoppedAt = $taskStoppedAt; processInventory = $taskInventory }
      }
    } finally {
      # Disposal of a still-live job is forced termination, never a passing cleanup acknowledgement.
      if ($taskDomain) {
        $taskDomain.Dispose()
        if ($taskRecord -and $taskDomain.ForcedTermination) { $taskRecord.processInventory['termination'] = 'forced' }
      }
      if (-not $taskPinsRegistered) { foreach ($taskBinaryPin in $taskBinaryPins) { $taskBinaryPin.Dispose() } }
      $taskEnvironment.Clear()
      $taskDirectUri = $null
    }
    if ($taskRecord) {
      # This private serialized fact is not an observe-v1 payload or cleanup authorization.
      $taskInventoryJson = $taskRecord.processInventory | ConvertTo-Json -Depth 16 -Compress
      if ([Text.Encoding]::UTF8.GetByteCount($taskInventoryJson) -gt 256KB) { throw '父方进程事实超过共享字节上限。' }
      $taskRecord.processInventoryJson = $taskInventoryJson
      $script:WorkflowProcessRuns[[string]$Context.executionDomainId].Add($taskRecord)
    }
  }
  # Vitest forks normally kills its worker. Zero member exit codes cannot attest a kill-free lifecycle or complete VM coverage.
  if (-not $taskImagesConfirmed -or -not $taskRecord -or -not $taskRecord.zeroExitObserved -or -not $taskRecord.inventoryComplete -or -not $taskRecord.outputEof -or
    $taskRecord.exitCode -ne 0 -or $taskRecord.remainingProcesses -ne 0) { throw '本次原生执行域终态未闭合。' }
  return $taskRecord
}
foreach ($taskPath in @($ContextFile, $OutputDirectory)) {
  if (-not [IO.Path]::IsPathFullyQualified($taskPath)) { throw '验收路径必须是自有本地绝对路径。' }
}
if (-not (Test-Path -LiteralPath $ContextFile -PathType Leaf)) { throw '缺少经父控制器生成的执行上下文。' }
if ((Get-Item -LiteralPath $ContextFile).Length -gt 8192) { throw '执行上下文超过上限。' }
$taskContext = Get-Content -LiteralPath $ContextFile -Raw | ConvertFrom-Json
if ($taskContext.caseId -cne $CaseId -or $taskContext.version -ne 1) { throw '执行案例与上下文不一致。' }

function Assert-OwnedWorkflowSource {
  param([Parameter(Mandatory)]$Preparation)
  $taskProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $taskHead = (& git --no-optional-locks -C $taskProjectRoot rev-parse HEAD) -join ''
  if ($LASTEXITCODE -ne 0 -or $taskHead -cne $Preparation.sourceCommit) { throw '实际代码提交与准备请求不一致。' }
  $taskDirty = @(& git --no-optional-locks -C $taskProjectRoot status --porcelain)
  if ($LASTEXITCODE -ne 0 -or $taskDirty.Count) { throw '父控制器仅运行已经冻结且干净的最终代码。' }
  $taskManifestFile = [Environment]::GetEnvironmentVariable('MVP_WORKFLOW_ACCEPTANCE_SOURCE_MANIFEST', 'Process')
  if (-not $taskManifestFile -or -not [IO.Path]::IsPathFullyQualified($taskManifestFile)) { throw '缺少完整冻结源码清单。' }
  if ((Get-FileHash -LiteralPath $taskManifestFile).Hash.ToLowerInvariant() -cne $Preparation.sourceFingerprint) { throw '源码清单指纹不一致。' }
  $taskManifest = Get-Content -LiteralPath $taskManifestFile -Raw | ConvertFrom-Json
  $taskTracked = @(& git --no-optional-locks -C $taskProjectRoot ls-files)
  if ($LASTEXITCODE -ne 0 -or $taskManifest.files.Count -ne $taskTracked.Count) { throw '冻结源码清单不是完整提交集合。' }
  $taskSeen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($taskFile in $taskManifest.files) {
    if ($taskFile.path -isnot [string] -or [IO.Path]::IsPathFullyQualified($taskFile.path) -or $taskFile.path -match '[\x00-\x1f\x7f:]' -or
      @($taskFile.path.Split('/') | Where-Object { $_ -in @('','.', '..') }).Count -or $taskFile.path -notin $taskTracked -or
      -not $taskSeen.Add([string]$taskFile.path)) { throw '源码清单包含未知或重复路径。' }
    if ((Get-FileHash -LiteralPath (Join-Path $taskProjectRoot $taskFile.path)).Hash -cne $taskFile.sha256.ToUpperInvariant()) { throw '代码与冻结清单不一致。' }
  }
  foreach ($taskName in @('.env','.env.local','.env.test','.env.test.local','.env.production','.env.production.local','.env.development','.env.development.local')) {
    if (Test-Path -LiteralPath (Join-Path $taskProjectRoot $taskName)) { throw '执行树含未知环境文件，拒绝运行。' }
  }
  return $taskProjectRoot
}

function Initialize-OwnedWorkflowCase {
  param([Parameter(Mandatory)]$Preparation, [Parameter(Mandatory)][string]$Directory)
  $null = Assert-OwnedWorkflowSource $Preparation
  $taskDomainId = [Guid]::NewGuid().ToString('D')
  $taskSdk = Join-Path $Directory ('sdk-' + $taskDomainId)
  if (Test-Path -LiteralPath $taskSdk) { throw '私有执行目录已存在，拒绝覆盖。' }
  $null = New-Item -ItemType Directory -Path $taskSdk
  $null = New-Item -ItemType Directory -Path (Join-Path $taskSdk 'realms')
  if (-not ('AgentStudioAcceptance.OwnedDirectoryPins' -as [type])) { Add-Type -LiteralPath (Join-Path $PSScriptRoot 'workflow-acceptance-process-domain.cs') }
  $taskDirectories = [AgentStudioAcceptance.OwnedDirectoryPins]::new()
  $taskDirectories.Pin([IO.Path]::GetFullPath($Directory)); $taskDirectories.Pin($taskSdk); $taskDirectories.Pin((Join-Path $taskSdk 'realms'))
  $script:WorkflowDirectoryPins[$taskDomainId] = $taskDirectories
  $script:WorkflowCaseFilePins[$taskDomainId] = [Collections.Generic.List[IDisposable]]::new()
  $script:WorkflowProcessRuns[$taskDomainId] = [Collections.Generic.List[object]]::new()
  $taskDraft = @{ version = 1; batchId = ([Guid]::Parse([string]$Preparation.batchId)).ToString('D'); caseId = $Preparation.caseId;
    sourceCommit = $Preparation.sourceCommit; sourceFingerprint = $Preparation.sourceFingerprint; executionDomainId = $taskDomainId;
    applicationName = 'mvp_wf_' + $taskDomainId.Replace('-',''); sdkDirectory = $taskSdk }
  $taskBranch = New-OwnedWorkflowNeonBranch -Context $taskDraft
  $taskDraft.databaseBranchId = $taskBranch
  $null = New-OwnedWorkflowEmptyDatabase -BranchId $taskBranch
  $taskProvenance = Get-OwnedWorkflowBranchProvenance -BranchId $taskBranch
  foreach ($taskRecord in @(@{ name = 'context.json'; value = $taskDraft }, @{ name = 'creation-provenance.json'; value = $taskProvenance })) {
    $taskJson = $taskRecord.value | ConvertTo-Json -Depth 8 -Compress
    $taskFilePin = [AgentStudioAcceptance.OwnedJsonPin]::Create((Join-Path $Directory $taskRecord.name), $taskJson, 32768)
    $script:WorkflowCaseFilePins[$taskDomainId].Add($taskFilePin)
    if ($taskRecord.name -ceq 'creation-provenance.json') {
      $script:WorkflowCreationPins[$taskDomainId] = @{ handle = $taskFilePin; sha256 = $taskFilePin.Sha256; branchId = $taskBranch;
        directory = [IO.Path]::GetFullPath($Directory); requestId = $taskProvenance.creationRequestId }
    }
  }
  $taskMarkerPin = [AgentStudioAcceptance.OwnedJsonPin]::Create((Join-Path $taskSdk 'owner-context.json'), ($taskDraft | ConvertTo-Json -Depth 8 -Compress), 8192)
  $script:WorkflowCaseFilePins[$taskDomainId].Add($taskMarkerPin)
  return $taskDraft
}

function Close-OwnedWorkflowCreationPin {
  param([Parameter(Mandatory)][string]$ExecutionDomainId)
  if ($script:WorkflowCreationPins.ContainsKey($ExecutionDomainId)) {
    $script:WorkflowCreationPins[$ExecutionDomainId].handle.Dispose()
    $script:WorkflowCreationPins.Remove($ExecutionDomainId)
  }
  if ($script:WorkflowDirectoryPins.ContainsKey($ExecutionDomainId)) {
    $script:WorkflowDirectoryPins[$ExecutionDomainId].Dispose()
    $script:WorkflowDirectoryPins.Remove($ExecutionDomainId)
  }
  if ($script:WorkflowCaseFilePins.ContainsKey($ExecutionDomainId)) {
    foreach ($taskPin in $script:WorkflowCaseFilePins[$ExecutionDomainId]) { $taskPin.Dispose() }
    $script:WorkflowCaseFilePins.Remove($ExecutionDomainId)
  }
}

function Invoke-OwnedWorkflowEmptyObservation {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$Directory)
  $taskPin = $script:WorkflowCreationPins[[string]$Context.executionDomainId]
  if (-not $taskPin -or $taskPin.handle.IsClosed -or -not $taskPin.handle.OriginalBytesUnchanged()) { throw '缺少父持有的创建事件文件。' }
  $taskProvenance = Get-OwnedWorkflowBranchProvenance -BranchId $Context.databaseBranchId
  $taskRequest = @{ version = 1; operation = 'observe-empty'; context = $Context; caseDirectory = [IO.Path]::GetFullPath($Directory); provenance = $taskProvenance }
  $taskRequestFile = Join-Path $Directory 'observe-empty-request.json'
  $taskRequestHandle = [AgentStudioAcceptance.OwnedJsonPin]::Create($taskRequestFile, ($taskRequest | ConvertTo-Json -Depth 12 -Compress), 32768)
  $taskStartedAt = [DateTimeOffset]::UtcNow
  try {
    $null = Invoke-OwnedCaseProcess -Context $Context -CaseDirectory $Directory -BridgeRequestFile $taskRequestFile
    $taskObservationFile = Join-Path $Directory 'empty-database-observation.json'
    $taskObservationHandle = [AgentStudioAcceptance.OwnedJsonPin]::Open($taskObservationFile, 2048)
    try {
      $taskObserved = $taskObservationHandle.Text | ConvertFrom-Json -AsHashtable -DateKind String
    } finally { $taskObservationHandle.Dispose() }
    $taskNow = [DateTimeOffset]::UtcNow
    $taskCheckedAt = [DateTimeOffset]::ParseExact([string]$taskObserved.checkedAt, 'yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
    if ($taskObserved.Count -ne 7 -or $taskObserved.version -ne 1 -or $taskObserved.databaseBranchId -cne $Context.databaseBranchId -or $taskObserved.endpointId -cne $taskProvenance.endpointId -or $taskObserved.databaseName -cne 'ci_test' -or $taskObserved.observationStatus -cne 'observed' -or $taskObserved.userRelationCount -isnot [long] -and $taskObserved.userRelationCount -isnot [int]) { throw '本次空库观察未确认，禁止迁移。' }
    if ($taskObserved.userRelationCount -ne 0 -or $taskCheckedAt -lt $taskStartedAt -or $taskCheckedAt -gt $taskNow -or ($taskNow-$taskCheckedAt).TotalSeconds -gt 30) { throw '空库数量非零或SQL观察已过期，禁止迁移。' }
    return $taskObserved
  } finally { $taskRequestHandle.Dispose() }
}

function Invoke-OwnedWorkflowBridgeRequest {
  param([Parameter(Mandatory)]$Request, [Parameter(Mandatory)][string]$Name)
  if ($Name -cnotin @('observe-request.json','finalize-request.json')) { throw '父桥接请求名未确认。' }
  $taskFile = Join-Path $Request.caseDirectory $Name
  $taskPin = [AgentStudioAcceptance.OwnedJsonPin]::Create($taskFile, ($Request | ConvertTo-Json -Depth 16 -Compress), 32768)
  try { return Invoke-OwnedCaseProcess -Context $Request.context -CaseDirectory $Request.caseDirectory -BridgeRequestFile $taskFile }
  finally { $taskPin.Dispose() }
}

function Invoke-OwnedWorkflowClosedObservation {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$Directory)
  $taskRuns = $script:WorkflowProcessRuns[[string]$Context.executionDomainId]
  $taskBusiness = @($taskRuns | Where-Object { $_.phase -ceq 'business' })
  if ($taskBusiness.Count -ne 1 -or -not $taskBusiness[0].natural -or -not $taskBusiness[0].inventoryComplete -or -not $taskBusiness[0].outputEof -or
    $taskBusiness[0].exitCode -ne 0 -or $taskBusiness[0].remainingProcesses -ne 0) { throw '本案例实际业务Job自然终态未确认。' }
  $null = Assert-OwnedWorkflowSource $Context
  $taskDirectories = $script:WorkflowDirectoryPins[[string]$Context.executionDomainId]
  if ($taskDirectories.IsClosed) { throw '父私有目录生命周期已失效。' }
  foreach ($taskPin in $script:WorkflowCaseFilePins[[string]$Context.executionDomainId]) {
    if ($taskPin.IsClosed -or -not $taskPin.OriginalBytesUnchanged()) { throw '本次冻结目录或原始父文件身份发生变化。' }
  }
  $taskProvenance = Get-OwnedWorkflowBranchProvenance -BranchId $Context.databaseBranchId
  $taskProcessObservation = @{ executionDomainId = $Context.executionDomainId; sourceMatched = $true; launchOwnershipVerified = $true;
    termination = 'natural'; exitCode = $taskBusiness[0].exitCode; processObservationComplete = $taskBusiness[0].inventoryComplete;
    remainingOwnedProcesses = $taskBusiness[0].remainingProcesses; allRealmReceiptsCollected = $false; ownedBranchVerified = $false;
    applicationName = $Context.applicationName; databaseBranchId = $Context.databaseBranchId; databaseObservationComplete = $false;
    databaseSnapshotFresh = $false; databaseConnections = $null; activeSql = $null; sdkDirectoryOwnershipVerified = $true }
  $taskRequest = @{ version = 1; operation = 'observe'; context = $Context; caseDirectory = [IO.Path]::GetFullPath($Directory);
    provenance = $taskProvenance; ownedProcessIds = $taskBusiness[0].processIds; processObservation = $taskProcessObservation }
  $null = Invoke-OwnedWorkflowBridgeRequest -Request $taskRequest -Name 'observe-request.json'
  $taskObservedPin = [AgentStudioAcceptance.OwnedJsonPin]::Open((Join-Path $Directory 'observed-record.json'), 1MB)
  $script:WorkflowCaseFilePins[[string]$Context.executionDomainId].Add($taskObservedPin)
  $script:WorkflowCreationPins[[string]$Context.executionDomainId].observedPin = $taskObservedPin
  return $taskObservedPin.Text | ConvertFrom-Json -AsHashtable -DateKind String
}

function Confirm-OwnedWorkflowCleanupEvidence {
  param([Parameter(Mandatory)]$Context)
  $taskPin = $script:WorkflowCreationPins[[string]$Context.executionDomainId]
  if (-not $taskPin.ContainsKey('observedPin') -or $taskPin.observedPin.IsClosed -or -not $taskPin.observedPin.OriginalBytesUnchanged()) { throw '没有父持有的实际停止观测文件。' }
  $taskObserved = $taskPin.observedPin.Text | ConvertFrom-Json -AsHashtable -DateKind String
  if ($taskObserved -isnot [Collections.IDictionary] -or $taskObserved.version -ne 1 -or $taskObserved.caseDirectory -cne $taskPin.directory) { throw '父停止记录不是本次案例。' }
  foreach ($taskField in $Context.Keys) {
    if ($taskObserved.context[$taskField] -cne $Context[$taskField] -or $taskObserved.child.context[$taskField] -cne $Context[$taskField]) { throw '停止记录混入其他冻结上下文。' }
  }
  $taskProvenance = $taskPin.handle.Text | ConvertFrom-Json -AsHashtable -DateKind String
  foreach ($taskField in $taskProvenance.Keys) { if ($taskObserved.provenance[$taskField] -cne $taskProvenance[$taskField]) { throw '停止记录不是父本次POST创建事件。' } }
  $taskRuns = $script:WorkflowProcessRuns[[string]$Context.executionDomainId]
  $taskBusiness = @($taskRuns | Where-Object { $_.phase -ceq 'business' })
  if ($taskRuns.Count -lt 4 -or $taskBusiness.Count -ne 1 -or @($taskRuns | Where-Object { $_.phase -ceq 'migration' }).Count -ne 1) { throw '迁移、业务和实际数据库观察未完整执行。' }
  foreach ($taskRun in $taskRuns) {
    if (-not $taskRun.natural -or -not $taskRun.inventoryComplete -or -not $taskRun.outputEof -or $taskRun.exitCode -ne 0 -or $taskRun.remainingProcesses -ne 0) { throw '原生自有执行域未全部自然退出。' }
  }
  $taskIds = [Collections.Generic.HashSet[long]]::new()
  foreach ($taskId in $taskBusiness[0].processIds) { if (-not $taskIds.Add([long]$taskId)) { throw '本次Job进程清单重复。' } }
  if ($taskObserved.ownedProcessIds.Count -ne $taskIds.Count) { throw '停止记录遗漏本次Job进程。' }
  foreach ($taskId in $taskObserved.ownedProcessIds) { if (-not $taskIds.Contains([long]$taskId)) { throw '停止记录混入非本次Job进程。' } }
  $taskObservation = $taskObserved.observation
  if ($taskObservation.executionDomainId -cne $Context.executionDomainId -or $taskObservation.applicationName -cne $Context.applicationName -or
    $taskObservation.databaseBranchId -cne $Context.databaseBranchId -or -not $taskObservation.sourceMatched -or -not $taskObservation.launchOwnershipVerified -or
    $taskObservation.termination -cne 'natural' -or $taskObservation.exitCode -ne $taskBusiness[0].exitCode -or -not $taskObservation.processObservationComplete -or
    $taskObservation.remainingOwnedProcesses -ne 0 -or -not $taskObservation.sdkDirectoryOwnershipVerified -or -not $taskObservation.ownedBranchVerified) { throw '父停止记录与实际原生Job事实不一致。' }
  # Only the independently instrumented bridge may derive this flag; paired realm files or OS exit alone never establish VM coverage.
  if (-not $taskObservation.allRealmReceiptsCollected -or $taskObserved.child.businessStatus -cne 'passed' -or $null -ne $taskObserved.child.failureCode -or
    $taskObserved.child.realms.Count -lt 1) { throw '完整执行空间覆盖或原业务断言未确认，保留资源。' }
  $taskPoolCount = 0
  foreach ($taskRealm in $taskObserved.child.realms) {
    if (-not $taskIds.Contains([long]$taskRealm.processId) -or $taskRealm.executionDomainId -cne $Context.executionDomainId -or
      $taskRealm.pools.ownerId -cne $Context.executionDomainId -or $taskRealm.pools.state -cne 'callbacks_completed' -or
      $taskRealm.pools.failedIds.Count -ne 0 -or $taskRealm.pools.unknownIds.Count -ne 0 -or
      $taskRealm.pools.poolIds.Count -ne $taskRealm.pools.completedIds.Count) { throw '登记池的原生关闭回执不完整。' }
    $taskPoolCount += $taskRealm.pools.poolIds.Count
  }
  if ($taskPoolCount -lt 1) { throw '真实业务连接没有登记关闭证据。' }
  $taskDatabase = $taskObserved.databaseObservation
  if ($taskDatabase.observationStatus -cne 'observed' -or $taskDatabase.databaseBranchId -cne $Context.databaseBranchId -or
    $taskDatabase.applicationName -cne $Context.applicationName -or $taskDatabase.databaseConnections -ne 0 -or $taskDatabase.activeSql -ne 0 -or
    -not $taskObservation.databaseObservationComplete -or -not $taskObservation.databaseSnapshotFresh -or
    $taskObservation.databaseConnections -ne 0 -or $taskObservation.activeSql -ne 0) { throw '实际数据库停止观察未确认。' }
  $taskCheckedAt = [DateTimeOffset]::ParseExact([string]$taskDatabase.checkedAt, 'yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal)
  $taskNow = [DateTimeOffset]::UtcNow
  if ($taskCheckedAt -lt $taskBusiness[0].stoppedAt -or $taskCheckedAt -gt $taskNow -or ($taskNow-$taskCheckedAt).TotalSeconds -gt 30) { throw '停止SQL不是自然退出后的新鲜观察。' }
  $null = Assert-OwnedWorkflowSource $Context
  $script:WorkflowCleanupPermissions[[string]$Context.databaseBranchId] = @{ creationRequestId = $taskProvenance.creationRequestId;
    executionDomainId = $Context.executionDomainId; observedPin = $taskPin.observedPin; directoryPins = $script:WorkflowDirectoryPins[[string]$Context.executionDomainId];
    runs = $taskRuns; sqlCheckedAt = $taskCheckedAt }
  Assert-OwnedWorkflowCleanupPermission $Context.databaseBranchId
}

function Invoke-OwnedWorkflowCaseChain {
  param([Parameter(Mandatory)]$Preparation, [Parameter(Mandatory)][string]$Directory)
  $taskContext = $null
  $script:WorkflowExecutionClock = [Diagnostics.Stopwatch]::StartNew()
  try {
    $taskContext = Initialize-OwnedWorkflowCase -Preparation $Preparation -Directory $Directory
    $null = Get-OwnedWorkflowDirectConnection -BranchId $taskContext.databaseBranchId
    $null = Invoke-OwnedWorkflowEmptyObservation -Context $taskContext -Directory $Directory
    $null = Invoke-OwnedCaseProcess -Context $taskContext -CaseDirectory $Directory -Phase 'migration'
    $null = Invoke-OwnedCaseProcess -Context $taskContext -CaseDirectory $Directory -Phase 'business'
    $null = Invoke-OwnedWorkflowClosedObservation -Context $taskContext -Directory $Directory
    Confirm-OwnedWorkflowCleanupEvidence -Context $taskContext
    $taskCleanup = Remove-OwnedWorkflowNeonBranch -BranchId $taskContext.databaseBranchId
    $taskCreation = $script:WorkflowOwnedCreations[[string]$taskContext.databaseBranchId]
    $taskCleanupPin = [AgentStudioAcceptance.OwnedJsonPin]::Create((Join-Path $Directory 'cleanup-receipt.json'), ($taskCleanup | ConvertTo-Json -Depth 8 -Compress), 32768)
    $taskCreation.cleanupPin = $taskCleanupPin
    $script:WorkflowCaseFilePins[[string]$taskContext.executionDomainId].Add($taskCleanupPin)
    $taskProvenance = $script:WorkflowCreationPins[[string]$taskContext.executionDomainId].handle.Text | ConvertFrom-Json -AsHashtable -DateKind String
    $taskRequest = @{ version = 1; operation = 'finalize'; context = $taskContext; caseDirectory = [IO.Path]::GetFullPath($Directory);
      provenance = $taskProvenance; cleanup = $taskCleanup }
    $null = Invoke-OwnedWorkflowBridgeRequest -Request $taskRequest -Name 'finalize-request.json'
    $taskResultPin = [AgentStudioAcceptance.OwnedJsonPin]::Open((Join-Path $Directory 'case-result.json'), 512KB)
    try {
      $taskResult = $taskResultPin.Text | ConvertFrom-Json -AsHashtable -DateKind String
      foreach ($taskField in $taskContext.Keys) { if ($taskResult.context[$taskField] -cne $taskContext[$taskField]) { throw '最终回执上下文不同。' } }
      foreach ($taskField in $taskCleanup.Keys) { if ($taskResult.cleanup[$taskField] -cne $taskCleanup[$taskField]) { throw '最终回执不是实际清理结果。' } }
      if ($taskResult.version -ne 1 -or $taskResult.evaluation.outcome -cne 'passed' -or -not $taskResult.evaluation.cleanupPermitted -or
        $taskResult.evaluation.failures.Count -ne 0) { throw '完整实际执行或清理没有通过回执。' }
      $null = Assert-OwnedWorkflowSource $Preparation
    } finally { $taskResultPin.Dispose() }
  } finally {
    if ($taskContext) {
      $script:WorkflowCleanupPermissions.Remove([string]$taskContext.databaseBranchId)
      $script:WorkflowDirectConnections.Remove([string]$taskContext.databaseBranchId)
      Close-OwnedWorkflowCreationPin -ExecutionDomainId $taskContext.executionDomainId
    }
    foreach ($taskDomainId in @($script:WorkflowDirectoryPins.Keys)) { Close-OwnedWorkflowCreationPin -ExecutionDomainId $taskDomainId }
    $script:WorkflowDirectConnections.Clear()
    $script:WorkflowCleanupPermissions.Clear()
    $script:WorkflowExecutionClock = $null
  }
}

if ((Get-Item -LiteralPath $ContextFile).Length -gt 2048) { throw '准备请求超过共享协议上限。' }
if ($taskContext.sourceCommit -notmatch '^[a-f0-9]{40}$' -or $taskContext.sourceFingerprint -notmatch '^[a-f0-9]{64}$') { throw '准备请求的源码标识无效。' }
if (@(Get-ChildItem -LiteralPath $OutputDirectory -File -Force | Where-Object { $_.Name -ne 'preparation.json' }).Count) { throw '案例目录含旧回执，拒绝重复运行。' }
# No resource creation is allowed until the complete observation and cleanup consumer is connected and reviewed.
throw '完整迁移、执行域停止与严格清理消费者尚未接通；拒绝创建任何验收资源。'
