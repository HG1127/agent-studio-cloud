#Requires -Version 7.5
Set-StrictMode -Version Latest
$script:WorkflowOwnedCreations = @{}
$script:WorkflowDirectConnections = @{}
$script:WorkflowCleanupPermissions = @{}
$script:WorkflowExecutionClock = $null
$script:WorkflowApiRoot = 'https://console.neon.tech/api/v2'
$script:WorkflowProjectId = 'cold-recipe-55563307'

function Invoke-OwnedWorkflowNeonApi {
  param([ValidateSet('GET','POST','DELETE')][string]$Method, [string]$RelativePath, $Body, [switch]$AllowAbsent)
  if ($RelativePath -notmatch '^/(projects/cold-recipe-55563307(?:/[^\s?#]+)*(?:\?[^\s#]+)?|organizations/[a-z0-9-]{1,60})$') { throw '拒绝非本项目控制平面路径。' }
  if ($Method -eq 'POST' -and $RelativePath -cne '/projects/cold-recipe-55563307/branches') {
    if ($RelativePath -notmatch '^/projects/cold-recipe-55563307/branches/(br-[a-z0-9-]+)/databases$') { throw '控制平面写范围未授权。' }
    $taskOwnedId = $Matches[1]
    if (-not $script:WorkflowOwnedCreations.ContainsKey($taskOwnedId) -or $Body.database.name -cne 'ci_test') { throw '数据库创建不属于本次自有临时分支。' }
  }
  if ($Method -eq 'DELETE') {
    if ($RelativePath -notmatch '^/projects/cold-recipe-55563307/branches/(br-[a-z0-9-]+)$' -or $null -ne $Body) { throw '删除范围不是本次自建分支。' }
    Assert-OwnedWorkflowCleanupPermission -BranchId $Matches[1]
  }
  $taskKey = [Environment]::GetEnvironmentVariable('NEON_API_KEY', 'User')
  $taskProject = [Environment]::GetEnvironmentVariable('NEON_PROJECT_ID', 'User')
  if ([string]::IsNullOrWhiteSpace($taskKey) -or $taskProject -cne $script:WorkflowProjectId) { throw '本用户专用控制平面配置未确认。' }
  try {
    $taskArguments = @{ Uri = $script:WorkflowApiRoot + $RelativePath; Method = $Method;
      Headers = @{ Authorization = 'Bearer ' + $taskKey }; TimeoutSec = 30; MaximumRetryCount = 0; MaximumRedirection = 0;
      SkipHttpErrorCheck = $true; ErrorAction = 'Stop' }
    if ($null -ne $Body) { $taskArguments.Body = $Body | ConvertTo-Json -Depth 12 -Compress; $taskArguments.ContentType = 'application/json' }
    $taskResponse = $null
    for ($taskAttempt = 0; $taskAttempt -lt 3; $taskAttempt++) {
      if ($script:WorkflowExecutionClock) {
        $taskSeconds = [Math]::Floor((240000 - $script:WorkflowExecutionClock.ElapsedMilliseconds) / 1000)
        if ($taskSeconds -lt 1) { throw '原案例截止时间已到，保留资源。' }
        $taskArguments.TimeoutSec = [int][Math]::Min(30, $taskSeconds)
      }
      if ($Method -eq 'DELETE') { Assert-OwnedWorkflowCleanupPermission -BranchId ($RelativePath.Split('/')[-1]) }
      $taskResponse = Invoke-WebRequest @taskArguments
      if ([int]$taskResponse.StatusCode -notin @(423,503) -or $taskAttempt -eq 2) { break }
      # Only an explicit response with these officially retryable statuses permits reusing the identical request.
      Start-Sleep -Milliseconds 250
    }
    if ($AllowAbsent -and $Method -eq 'GET' -and [int]$taskResponse.StatusCode -eq 404) { return $null }
    if ([int]$taskResponse.StatusCode -notin @(200,201,204) -or [Text.Encoding]::UTF8.GetByteCount([string]$taskResponse.Content) -gt 1MB) { throw '控制平面请求未确认。' }
    if ($Method -eq 'DELETE') {
      $taskDeletedId = $RelativePath.Split('/')[-1]
      $script:WorkflowOwnedCreations[$taskDeletedId].deleteResponseStatus = [int]$taskResponse.StatusCode
    }
    if ([int]$taskResponse.StatusCode -eq 204) { return @{} }
    return $taskResponse.Content | ConvertFrom-Json -AsHashtable -DateKind String
  } catch { throw '官方控制平面请求未确认；不重试写操作，不输出响应或凭据。' }
  finally { $taskKey = $null; $taskArguments = $null; $taskResponse = $null }
}

function Get-OwnedWorkflowNeonBranches {
  $taskBranches = [Collections.Generic.List[object]]::new()
  $taskCursor = $null
  $taskSeen = [Collections.Generic.HashSet[string]]::new()
  $taskIds = [Collections.Generic.HashSet[string]]::new()
  for ($taskPage = 0; $taskPage -lt 100; $taskPage++) {
    $taskPath = '/projects/' + $script:WorkflowProjectId + '/branches?limit=100&sort_by=created_at&sort_order=asc'
    if ($null -ne $taskCursor) { $taskPath += '&cursor=' + [Uri]::EscapeDataString($taskCursor) }
    $taskResponse = Invoke-OwnedWorkflowNeonApi GET $taskPath $null
    if ($taskResponse -isnot [Collections.IDictionary] -or $taskResponse.branches -isnot [Array] -or
      $taskResponse.branches.Count -gt 100 -or $taskResponse.pagination -isnot [Collections.IDictionary]) { throw '临时分支分页未确认。' }
    foreach ($taskBranch in $taskResponse.branches) {
      if ($taskBranch.project_id -cne $script:WorkflowProjectId -or $taskBranch.id -notmatch '^br-[a-z0-9-]+$' -or -not $taskIds.Add([string]$taskBranch.id)) { throw '分支归属或分页唯一性未确认。' }
      $taskBranches.Add($taskBranch)
    }
    $taskPagination = $taskResponse.pagination
    foreach ($taskKey in $taskPagination.Keys) { if ($taskKey -cnotin @('next','sort_by','sort_order')) { throw '分支分页包含未知字段。' } }
    if ($taskPagination.ContainsKey('sort_by') -and $taskPagination.sort_by -cne 'created_at' -or
      $taskPagination.ContainsKey('sort_order') -and $taskPagination.sort_order -cne 'asc') { throw '分支分页排序状态未知。' }
    # The official CursorPagination response omits next on the final page; cursor is a request parameter only.
    if (-not $taskPagination.ContainsKey('next')) { return $taskBranches.ToArray() }
    if ($taskPagination.next -isnot [string] -or [string]::IsNullOrWhiteSpace($taskPagination.next)) { throw '分支分页游标未确认。' }
    $taskCursor = $taskPagination.next
    if ($taskResponse.branches.Count -eq 0 -or $taskCursor.Length -gt 4096 -or $taskCursor -match '[\x00-\x20\x7f]' -or -not $taskSeen.Add($taskCursor)) { throw '分支分页游标未确认。' }
  }
  throw '分支分页超出有界观察范围。'
}

function New-OwnedWorkflowNeonBranch {
  param([Parameter(Mandatory)]$Context)
  $taskDomain = [Guid]::Parse([string]$Context.executionDomainId).ToString('D')
  $taskName = 'mvp-wf-' + $taskDomain
  $taskProjectResponse = Invoke-OwnedWorkflowNeonApi GET ('/projects/' + $script:WorkflowProjectId) $null
  $taskProject = $taskProjectResponse.project
  if ($taskProject.id -cne $script:WorkflowProjectId -or $taskProject.name -cne 'agent-studio') { throw '验收项目身份不一致。' }
  if (-not $taskProject.ContainsKey('org_id') -or $taskProject.org_id -notmatch '^[a-z0-9-]{1,60}$') { throw '项目组织与免费计划未确认。' }
  $taskOrg = Invoke-OwnedWorkflowNeonApi GET ('/organizations/' + $taskProject.org_id) $null
  if ($taskOrg.id -cne $taskProject.org_id -or $taskOrg.plan -cne 'free') { throw '当前项目所属免费组织未确认，拒绝付费资源。' }
  $taskQuota = $taskProject.settings.quota
  if ($null -eq $taskQuota -or $taskQuota -isnot [Collections.IDictionary]) { throw '实时免费额度未知，拒绝创建资源。' }
  foreach ($taskMetric in @('compute_time_seconds','data_transfer_bytes','written_data_bytes')) {
    if (-not $taskQuota.ContainsKey($taskMetric) -or -not $taskProject.ContainsKey($taskMetric)) { throw '实时验收额度未确认。' }
    $taskLimit = [double]$taskQuota[$taskMetric]
    $taskUsed = [double]$taskProject[$taskMetric]
    $taskReserve = if ($taskMetric -eq 'compute_time_seconds') { 900 } else { 5MB }
    if ([double]::IsNaN($taskLimit) -or [double]::IsInfinity($taskLimit) -or [double]::IsNaN($taskUsed) -or [double]::IsInfinity($taskUsed) -or $taskUsed -lt 0 -or $taskLimit -le 0 -or $taskLimit - $taskUsed -lt $taskReserve) {
      throw '本次验收额度不足或无有界免费证明。'
    }
  }
  $taskBranches = @(Get-OwnedWorkflowNeonBranches)
  $taskDefaults = @($taskBranches | Where-Object { $_.default -eq $true })
  if ($taskBranches.Count -ge 10 -or $taskDefaults.Count -ne 1 -or @($taskBranches | Where-Object { $_.name -ceq $taskName }).Count) { throw '临时分支容量、默认来源或唯一性未确认。' }
  $taskRequestId = [Guid]::NewGuid().ToString('N')
  $taskResponse = Invoke-OwnedWorkflowNeonApi POST ('/projects/' + $script:WorkflowProjectId + '/branches') @{
    branch = @{ name = $taskName; parent_id = $taskDefaults[0].id; protected = $false }
    endpoints = @(@{ type = 'read_write'; autoscaling_limit_min_cu = 0.25; autoscaling_limit_max_cu = 0.25; suspend_timeout_seconds = 300 })
    annotation_value = @{ acceptance_request = $taskRequestId; execution_domain = $taskDomain }
  }
  $taskBranch = $taskResponse.branch
  if ($taskBranch.id -notmatch '^br-[a-z0-9-]+$' -or $taskBranch.project_id -cne $script:WorkflowProjectId -or $taskBranch.name -cne $taskName -or $taskBranch.default -ne $false -or $taskBranch.protected -ne $false -or $taskBranch.parent_id -cne $taskDefaults[0].id) {
    throw '创建响应归属未知，保留资源并人工核对，不按名字删除。'
  }
  if ($script:WorkflowOwnedCreations.ContainsKey($taskBranch.id)) { throw '创建事件重复，保留资源。' }
  $script:WorkflowOwnedCreations[$taskBranch.id] = @{ branch = $taskBranch; requestId = $taskRequestId; context = $Context; endpoints = $taskResponse.endpoints }
  return $taskBranch.id
}

function Confirm-OwnedWorkflowNeonBranch {
  param([Parameter(Mandatory)][string]$BranchId)
  if (-not $script:WorkflowOwnedCreations.ContainsKey($BranchId)) { throw '没有本控制器实际创建事件，拒绝复用已有分支。' }
  $taskCreation = $script:WorkflowOwnedCreations[$BranchId]
  $taskCurrent = (Invoke-OwnedWorkflowNeonApi GET ('/projects/' + $script:WorkflowProjectId + '/branches/' + $BranchId) $null).branch
  if ($taskCurrent.id -cne $BranchId -or $taskCurrent.project_id -cne $script:WorkflowProjectId -or $taskCurrent.name -cne $taskCreation.branch.name -or $taskCurrent.created_at -cne $taskCreation.branch.created_at -or $taskCurrent.parent_id -cne $taskCreation.branch.parent_id -or $taskCurrent.default -ne $false -or $taskCurrent.protected -ne $false) { throw '本次创建事件与官方现状不一致。' }
  return $taskCreation
}

function Remove-OwnedWorkflowNeonBranch {
  param([Parameter(Mandatory)][string]$BranchId)
  $taskCreation = Confirm-OwnedWorkflowNeonBranch $BranchId
  $taskProvenance = Get-OwnedWorkflowBranchProvenance $BranchId
  if (@(Get-OwnedWorkflowNeonBranches | Where-Object { $_.ContainsKey('parent_id') -and $_.parent_id -ceq $BranchId }).Count) { throw '本次临时分支已被其他资源引用，保留资源。' }
  Assert-OwnedWorkflowCleanupPermission $BranchId
  $taskDeleted = Invoke-OwnedWorkflowNeonApi DELETE ('/projects/' + $script:WorkflowProjectId + '/branches/' + $BranchId) $null
  if (-not $taskCreation.ContainsKey('deleteResponseStatus') -or $taskCreation.deleteResponseStatus -notin @(200,204)) { throw '删除请求没有官方成功回执。' }
  if ($taskCreation.deleteResponseStatus -eq 200 -and ($taskDeleted.branch.id -cne $BranchId -or $taskDeleted.branch.project_id -cne $script:WorkflowProjectId -or
    $taskDeleted.branch.created_at -cne $taskCreation.branch.created_at -or $taskDeleted.branch.name -cne $taskCreation.branch.name)) { throw '删除响应不是本次自建分支；保留未知清理状态。' }
  for ($taskAttempt = 0; $taskAttempt -lt 10; $taskAttempt++) {
    $taskBranch = Invoke-OwnedWorkflowNeonApi GET ('/projects/' + $script:WorkflowProjectId + '/branches/' + $BranchId) $null -AllowAbsent
    $taskEndpoint = Invoke-OwnedWorkflowNeonApi GET ('/projects/' + $script:WorkflowProjectId + '/endpoints/' + $taskProvenance.endpointId) $null -AllowAbsent
    if ($null -eq $taskBranch -and $null -eq $taskEndpoint) {
      $taskCreation.absenceVerified = $true
      $script:WorkflowDirectConnections.Remove($BranchId)
      $script:WorkflowCleanupPermissions.Remove($BranchId)
      return @{ status = 'deleted-and-verified'; databaseBranchId = $BranchId; ownershipVerified = $true;
        lifecycleAuthorizationVerified = $true; deletionRequestSucceeded = $true; absenceVerified = $true }
    }
    if ($taskAttempt -lt 9) { Start-Sleep -Milliseconds 250 }
  }
  throw '官方分支或端点缺席未确认，不输出完成清理回执。'
}

function Assert-OwnedWorkflowCleanupPermission {
  param([Parameter(Mandatory)][string]$BranchId)
  if (-not $script:WorkflowOwnedCreations.ContainsKey($BranchId) -or -not $script:WorkflowCleanupPermissions.ContainsKey($BranchId)) { throw '没有父控制器实际停止证明，拒绝删除。' }
  $taskCreation = $script:WorkflowOwnedCreations[$BranchId]
  $taskPermission = $script:WorkflowCleanupPermissions[$BranchId]
  if ($taskPermission.creationRequestId -cne $taskCreation.requestId -or $taskPermission.executionDomainId -cne $taskCreation.context.executionDomainId -or
    $taskPermission.observedPin.IsClosed -or -not $taskPermission.observedPin.OriginalBytesUnchanged() -or
    $taskPermission.directoryPins.IsClosed -or $taskPermission.runs.Count -lt 4) { throw '本次父持有的停止证明已经失效。' }
  foreach ($taskRun in $taskPermission.runs) {
    if (-not $taskRun.natural -or -not $taskRun.inventoryComplete -or -not $taskRun.outputEof -or $taskRun.exitCode -ne 0 -or $taskRun.remainingProcesses -ne 0) { throw '本次仍有未确认执行域，拒绝删除。' }
  }
  $taskNow = [DateTimeOffset]::UtcNow
  if ($taskPermission.sqlCheckedAt -gt $taskNow -or ($taskNow-$taskPermission.sqlCheckedAt).TotalSeconds -gt 30) { throw '实际SQL停止观察已过期，拒绝删除。' }
}

function New-OwnedWorkflowEmptyDatabase {
  param([Parameter(Mandatory)][string]$BranchId)
  $taskCreation = Confirm-OwnedWorkflowNeonBranch $BranchId
  if ($taskCreation.ContainsKey('database')) { throw '本次空库已经创建，拒绝重复POST。' }
  $taskPrefix = '/projects/' + $script:WorkflowProjectId + '/branches/' + $BranchId
  $taskBefore = Invoke-OwnedWorkflowNeonApi GET ($taskPrefix + '/databases') $null
  if (-not $taskBefore.ContainsKey('databases')) { throw '空库创建前状态未确认。' }
  if (@($taskBefore.databases | Where-Object { $_.name -ceq 'ci_test' }).Count) { throw '分支已有继承或占用的ci_test，拒绝复用。' }
  $taskRoles = Invoke-OwnedWorkflowNeonApi GET ($taskPrefix + '/roles') $null
  $taskOwner = @($taskRoles.roles | Where-Object { $_.name -ceq 'neondb_owner' -and $_.branch_id -ceq $BranchId })
  if ($taskOwner.Count -ne 1) { throw '本次空库所属角色未确认。' }
  $taskResponse = Invoke-OwnedWorkflowNeonApi POST ($taskPrefix + '/databases') @{ database = @{ name = 'ci_test'; owner_name = 'neondb_owner' } }
  $taskDatabase = $taskResponse.database
  if ($taskDatabase.id -isnot [long] -and $taskDatabase.id -isnot [int]) { throw '数据库创建ID不是原始整数，保留资源。' }
  if ($taskDatabase.id -lt -9007199254740991 -or $taskDatabase.id -gt 9007199254740991) { throw '数据库创建ID超出安全整数范围，保留资源。' }
  if ($taskDatabase.branch_id -cne $BranchId -or $taskDatabase.name -cne 'ci_test' -or $taskDatabase.owner_name -cne 'neondb_owner' -or -not $taskDatabase.ContainsKey('id') -or -not $taskDatabase.ContainsKey('created_at')) { throw '空库创建响应未确认，保留资源。' }
  $taskCreation.database = @{ id = $taskDatabase.id; branch_id = $BranchId; name = 'ci_test'; owner_name = 'neondb_owner'; created_at = $taskDatabase.created_at }
  $taskAfter = Invoke-OwnedWorkflowNeonApi GET ($taskPrefix + '/databases') $null
  $taskMatched = @($taskAfter.databases | Where-Object { ($_.id -is [long] -or $_.id -is [int]) -and $_.id -eq $taskDatabase.id -and $_.name -ceq 'ci_test' -and $_.branch_id -ceq $BranchId -and $_.created_at -ceq $taskDatabase.created_at -and $_.owner_name -ceq $taskDatabase.owner_name })
  if ($taskMatched.Count -ne 1) { throw '新建空库的官方读取回执未确认，保留资源。' }
  return $taskCreation.database
}

function Get-OwnedWorkflowBranchProvenance {
  param([Parameter(Mandatory)][string]$BranchId)
  $taskCreation = Confirm-OwnedWorkflowNeonBranch $BranchId
  if (-not $taskCreation.ContainsKey('database')) { throw '没有本次新建ci_test事件，禁止生成归属摘要。' }
  $taskEndpoints = @($taskCreation.endpoints)
  if ($taskEndpoints.Count -ne 1 -or $taskEndpoints[0].id -notmatch '^ep-[a-z0-9-]+$') { throw '本次唯一直接计算端点未确认。' }
  $taskEndpointId = [string]$taskEndpoints[0].id
  $taskEndpoint = (Invoke-OwnedWorkflowNeonApi GET ('/projects/' + $script:WorkflowProjectId + '/endpoints/' + $taskEndpointId) $null).endpoint
  if ($taskEndpoint.id -cne $taskEndpointId -or $taskEndpoint.branch_id -cne $BranchId -or $taskEndpoint.project_id -cne $script:WorkflowProjectId -or $taskEndpoint.type -cne 'read_write' -or $taskEndpoint.host -cne $taskEndpoints[0].host -or $taskEndpoint.created_at -cne $taskEndpoints[0].created_at -or $taskEndpoint.host -notmatch '^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$' -or $taskEndpoint.host.Split('.')[0] -cne $taskEndpointId -or $taskEndpoint.host -match 'pooler|pgbouncer') { throw '官方端点与自创建分支不一致。' }
  $taskDatabases = Invoke-OwnedWorkflowNeonApi GET ('/projects/' + $script:WorkflowProjectId + '/branches/' + $BranchId + '/databases') $null
  if ($taskDatabases.databases -isnot [Array] -or @($taskDatabases.databases | Where-Object { $_.name -ceq 'ci_test' }).Count -ne 1 -or
    @($taskDatabases.databases | Where-Object { ($_.id -is [long] -or $_.id -is [int]) -and $_.id -eq $taskCreation.database.id -and $_.branch_id -ceq $BranchId -and
      $_.name -ceq 'ci_test' -and $_.created_at -ceq $taskCreation.database.created_at -and $_.owner_name -ceq $taskCreation.database.owner_name }).Count -ne 1) { throw '本次POST数据库与官方现状不一致。' }
  return @{ version = 1; projectId = $script:WorkflowProjectId; databaseBranchId = $BranchId; branchName = $taskCreation.branch.name;
    executionDomainId = $taskCreation.context.executionDomainId; batchId = $taskCreation.context.batchId;
    sourceCommit = $taskCreation.context.sourceCommit; sourceFingerprint = $taskCreation.context.sourceFingerprint;
    createdAt = $taskCreation.branch.created_at; endpointId = $taskEndpointId; endpointHost = $taskEndpoint.host;
    databaseName = 'ci_test'; creationRequestId = $taskCreation.requestId;
    parentBranchId = $taskCreation.branch.parent_id; databaseId = $taskCreation.database.id;
    databaseCreatedAt = $taskCreation.database.created_at; databaseOwner = $taskCreation.database.owner_name }
}

function Get-OwnedWorkflowDirectConnection {
  param([Parameter(Mandatory)][string]$BranchId)
  $taskProvenance = Get-OwnedWorkflowBranchProvenance $BranchId
  $taskPath = '/projects/' + $script:WorkflowProjectId + '/connection_uri?branch_id=' + [Uri]::EscapeDataString($BranchId)
  $taskPath += '&endpoint_id=' + [Uri]::EscapeDataString($taskProvenance.endpointId) + '&database_name=ci_test&role_name=neondb_owner&pooled=false'
  $taskResponse = Invoke-OwnedWorkflowNeonApi GET $taskPath $null
  $taskUri = $null
  if ($taskResponse.uri -isnot [string] -or $taskResponse.uri -cne $taskResponse.uri.Trim() -or [Text.Encoding]::UTF8.GetByteCount($taskResponse.uri) -gt 16384 -or
    $taskResponse.uri -match '[\x00-\x20\x7f]' -or -not [Uri]::TryCreate($taskResponse.uri, [UriKind]::Absolute, [ref]$taskUri)) { throw '本次官方专用连接未确认。' }
  if ($taskUri.Scheme -cnotin @('postgres','postgresql') -or $taskUri.Host -cne $taskProvenance.endpointHost -or $taskUri.AbsolutePath -cne '/ci_test' -or
    $taskUri.Port -notin @(-1,5432) -or $taskUri.Fragment -or $taskUri.UserInfo.Split(':').Count -ne 2 -or
    [Uri]::UnescapeDataString($taskUri.UserInfo.Split(':')[0]) -cne 'neondb_owner' -or [string]::IsNullOrEmpty($taskUri.UserInfo.Split(':')[1])) { throw '拒绝非本次直接ci_test连接。' }
  $taskOptions = @{}
  foreach ($taskOption in $taskUri.Query.TrimStart('?').Split('&')) {
    $taskParts = $taskOption.Split('=')
    if ($taskParts.Count -ne 2 -or $taskParts[0] -cnotin @('sslmode','channel_binding') -or $taskParts[1] -cne 'require' -or $taskOptions.ContainsKey($taskParts[0])) { throw '专用连接参数未确认。' }
    $taskOptions[$taskParts[0]] = $taskParts[1]
  }
  if (-not $taskOptions.ContainsKey('sslmode')) { throw '专用迁移连接没有强制TLS。' }
  $taskCurrent = Get-OwnedWorkflowBranchProvenance $BranchId
  foreach ($taskField in $taskProvenance.Keys) { if ($taskCurrent[$taskField] -cne $taskProvenance[$taskField]) { throw '官方连接获取期间创建身份发生变化。' } }
  $script:WorkflowDirectConnections[$BranchId] = $taskResponse.uri
  return $taskResponse.uri
}
