param(
  [ValidateSet('Install', 'Run', 'Start', 'Stop', 'Restart', 'Status', 'Uninstall')]
  [string]$Action = 'Status',
  [string]$NodePath = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskHash = [Security.Cryptography.SHA256]::Create()
$rootHash = ([BitConverter]::ToString($taskHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant())))).Replace('-', '').Substring(0, 8)
$taskName = "AI Pixel Company Local API-$rootHash"
$description = "AI Pixel Company local API | $projectRoot"
$statusPath = Join-Path $projectRoot '.local\windows-api\status.json'
$stopPath = Join-Path $projectRoot '.local\windows-api\stop.json'
$recoveryPath = Join-Path $projectRoot '.local\windows-api\recovery.json'
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
. (Join-Path $PSScriptRoot 'windows-startup-policy.ps1')

function Read-Status {
  try { if (Test-Path -LiteralPath $statusPath) { Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } } catch { return $null }
}
function Write-BootstrapEvent($EventData) {
  $folder = Join-Path $projectRoot '.local\windows-api'
  $log = Join-Path $folder 'bootstrap.log'
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -ge 2MB) { Move-Item -LiteralPath $log -Destination "$log.1" -Force }
  # Only allowlisted process/state/code fields are supplied. No command lines,
  # environment, exception messages, credentials, or Slack contents are logged.
  $EventData.utc = (Get-Date).ToUniversalTime().ToString('o')
  $EventData.wrapperPid = $PID
  $EventData | ConvertTo-Json -Compress | Add-Content -LiteralPath $log -Encoding UTF8
}
function Session-Key {
  $logon = (& "$env:SystemRoot\System32\whoami.exe" /logonid | Out-String)
  $match = [regex]::Match($logon, 'S-1-5-5-\d+-\d+')
  if (!$match.Success) { throw 'LOGON_ID_UNAVAILABLE' }
  return (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o') + '|' + $match.Value
}
function Read-Recovery {
  if (Test-Path -LiteralPath $recoveryPath) {
    try {
      $value = Get-Content -LiteralPath $recoveryPath -Raw | ConvertFrom-Json
      if (!$value) { throw 'RECOVERY_STATE_INVALID' }
      return $value
    } catch { throw 'RECOVERY_STATE_INVALID' }
  }
}
function Write-Recovery($Recovery) {
  New-Item -ItemType Directory -Path (Split-Path $recoveryPath) -Force | Out-Null
  $temporary = "$recoveryPath.$PID.tmp"
  $Recovery | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $recoveryPath -Force
}
function Start-LocalTask {
  $task = Owned-Task
  if (!$task) { throw 'TASK_NOT_INSTALLED' }
  if ($task.State -eq 'Running') { return }
  Write-Recovery @{version=1;sessionKey=(Session-Key);attempt=0;blocked=$false}
  Start-ScheduledTask -TaskName $taskName
}
function Owned-Task {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    $principalId = $task.Principal.UserId
    if (!$principalId.StartsWith('S-1-')) { $principalId = ([Security.Principal.NTAccount]::new($principalId)).Translate([Security.Principal.SecurityIdentifier]).Value }
    if ($task.Description -ne $description -or $principalId -ne $currentUser -or $task.Principal.RunLevel -ne 'Limited' -or $task.Principal.LogonType -ne 'Interactive' -or $task.Actions.Count -ne 1 -or !(Test-LocalStartupAction $task.Actions[0] $PSCommandPath)) { throw 'TASK_IDENTITY_MISMATCH' }
  }
  return $task
}
function Stop-OwnedTask {
  $task = Owned-Task
  if (!$task) { return }
  # Persist an explicit stop even while the wrapper is absent, so the periodic
  # safety trigger cannot undo it. A different Windows logon gets a new budget.
  Write-Recovery @{version=1;sessionKey=(Session-Key);attempt=4;blocked=$true}
  $status = Read-Status
  if ($task.State -ne 'Running' -and $status.state -in @('STOPPED', 'ERROR')) { return }
  if ($status.launchId) {
    @{launchId = $status.launchId} | ConvertTo-Json -Compress | Set-Content -LiteralPath $stopPath -Encoding UTF8
    $deadline = (Get-Date).AddSeconds(45)
    do {
      Start-Sleep -Milliseconds 500
      $task = Owned-Task
      $runtime = Read-Status
      if ($task.State -ne 'Running' -and $runtime.launchId -eq $status.launchId -and $runtime.state -in @('STOPPED', 'ERROR')) { return }
    } while ((Get-Date) -lt $deadline)
  }
  # This only terminates the verified task job, never an arbitrary process/port.
  if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName }
}

switch ($Action) {
  'Run' {
    if (!$NodePath -or !(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'NODE_PATH_INVALID' }
    Set-Location -LiteralPath $projectRoot
    $sessionKey = Session-Key
    $decision = Get-LocalStartupDecision (Read-Recovery) $sessionKey
    if (!$decision.launch) { exit 0 }
    $recovery = @{version=1;sessionKey=$sessionKey;attempt=$decision.attempt;blocked=$false}
    Write-Recovery $recovery
    $previous = Read-Status
    $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
    Write-BootstrapEvent @{event='START'; attempt=$decision.attempt; previousSupervisorPid=$previous.supervisorPid; previousLaunchId=$previous.launchId; previousState=$previous.state; previousCompleted=($previous.completed -eq $true); taskResult=$taskInfo.LastTaskResult; bootUtc=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')}
    # CreateProcess without ShellExecute or a console; stdin is a private parent
    # lifetime pipe. Even abrupt wrapper termination closes it for the child.
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $NodePath
    $start.Arguments = '"' + (Join-Path $PSScriptRoot 'windows-local-api.mjs') + '" --parent-pipe'
    $start.WorkingDirectory = $projectRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $child = [Diagnostics.Process]::Start($start)
    $child.WaitForExit()
    $runtime = Read-Status
    if ($runtime -and $runtime.supervisorPid -eq $child.Id -and $runtime.completed -eq $true) {
      # Completed service retry budgets are terminal; a crash has no marker.
      $recovery.blocked = $true
      Write-Recovery $recovery
    }
    $exitCode = $child.ExitCode
    Write-BootstrapEvent @{event='EXIT'; attempt=$decision.attempt; supervisorPid=$child.Id; exitCode=$exitCode; state=$runtime.state; completed=($runtime.completed -eq $true); blocked=$recovery.blocked}
    $child.Dispose()
    exit $exitCode
  }
  'Install' {
    if (!$NodePath) { $NodePath = (Get-Command node.exe).Source }
    $NodePath = [IO.Path]::GetFullPath($NodePath)
    if (!(Test-Path -LiteralPath $NodePath -PathType Leaf) -or $NodePath -match '["%\r\n]' -or [IO.Path]::GetFileName($NodePath) -ine 'node.exe') { throw 'NODE_PATH_INVALID' }
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot '.local\runtime.json'))) { throw 'LOCAL_CONFIG_MISSING' }
    $existing = Owned-Task
    if ($existing -and $existing.State -eq 'Running') { throw 'STOP_BEFORE_REINSTALL' }
    $launch = Get-LocalStartupAction $PSCommandPath $NodePath
    if (!(Test-Path -LiteralPath $launch.Execute -PathType Leaf) -or !(Test-Path -LiteralPath ([IO.Path]::ChangeExtension($PSCommandPath, '.vbs')) -PathType Leaf)) { throw 'HIDDEN_LAUNCHER_MISSING' }
    $taskAction = New-ScheduledTaskAction -Execute $launch.Execute -Argument $launch.Arguments -WorkingDirectory $projectRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $trigger.Delay = 'PT20S'
    $recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval ([TimeSpan]::FromMinutes(1))
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    $settings = New-LocalStartupSettings
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger @($trigger, $recoveryTrigger) -Principal $principal -Settings $settings -Description $description -Force | Out-Null
  }
  'Start' { Start-LocalTask }
  'Stop' { Stop-OwnedTask }
  'Restart' { if (!(Owned-Task)) { throw 'TASK_NOT_INSTALLED' }; Stop-OwnedTask; Start-LocalTask }
  'Uninstall' { if (Owned-Task) { Stop-OwnedTask; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false } }
}
if ($Action -ne 'Run') {
  $task = Owned-Task
  $info = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName } else { $null }
  $recovery = Read-Recovery
  @{ taskName = $taskName; installed = [bool]$task; taskState = if ($task) { [string]$task.State } else { 'Absent' }; lastTaskResult = if ($info) { $info.LastTaskResult } else { $null }; recoveryInterval = if ($task) { $task.Triggers[1].Repetition.Interval }; recoveryAttempt = $recovery.attempt; recoveryBlocked = $recovery.blocked; logonTrigger = if ($task) { $task.Triggers[0].CimClass.CimClassName }; runLevel = if ($task) { [string]$task.Principal.RunLevel }; logonType = if ($task) { [string]$task.Principal.LogonType }; runtime = Read-Status } | ConvertTo-Json -Depth 4 -Compress
}
