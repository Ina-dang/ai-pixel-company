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
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value

function Read-Status {
  if (Test-Path -LiteralPath $statusPath) { Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json }
}
function Owned-Task {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    $principalId = $task.Principal.UserId
    if (!$principalId.StartsWith('S-1-')) { $principalId = ([Security.Principal.NTAccount]::new($principalId)).Translate([Security.Principal.SecurityIdentifier]).Value }
    $expectedArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$PSCommandPath`" -Action Run -NodePath `""
    if ($task.Description -ne $description -or $principalId -ne $currentUser -or $task.Principal.RunLevel -ne 'Limited' -or $task.Principal.LogonType -ne 'Interactive' -or $task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ne (Join-Path $PSHOME 'powershell.exe') -or !$task.Actions[0].Arguments.StartsWith($expectedArguments)) { throw 'TASK_IDENTITY_MISMATCH' }
  }
  return $task
}
function Stop-OwnedTask {
  $task = Owned-Task
  if (!$task -or $task.State -ne 'Running') { return }
  $status = Read-Status
  if ($status.launchId) {
    @{launchId = $status.launchId} | ConvertTo-Json -Compress | Set-Content -LiteralPath $stopPath -Encoding UTF8
    $deadline = (Get-Date).AddSeconds(45)
    do {
      Start-Sleep -Milliseconds 500
      $task = Owned-Task
      if ($task.State -ne 'Running') { return }
    } while ((Get-Date) -lt $deadline)
  }
  # This only terminates the verified task job, never an arbitrary process/port.
  Stop-ScheduledTask -TaskName $taskName
}

switch ($Action) {
  'Run' {
    if (!$NodePath -or !(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'NODE_PATH_INVALID' }
    Set-Location -LiteralPath $projectRoot
    & $NodePath (Join-Path $PSScriptRoot 'windows-local-api.mjs')
    exit $LASTEXITCODE
  }
  'Install' {
    if (!$NodePath) { $NodePath = (Get-Command node.exe).Source }
    $NodePath = [IO.Path]::GetFullPath($NodePath)
    if (!(Test-Path -LiteralPath $NodePath -PathType Leaf) -or $NodePath.Contains('"')) { throw 'NODE_PATH_INVALID' }
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot '.local\runtime.json'))) { throw 'LOCAL_CONFIG_MISSING' }
    $existing = Owned-Task
    if ($existing -and $existing.State -eq 'Running') { throw 'STOP_BEFORE_REINSTALL' }
    $powerShell = Join-Path $PSHOME 'powershell.exe'
    $arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$PSCommandPath`" -Action Run -NodePath `"$NodePath`""
    $taskAction = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $projectRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $trigger.Delay = 'PT20S'
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description $description -Force | Out-Null
  }
  'Start' { if (!(Owned-Task)) { throw 'TASK_NOT_INSTALLED' }; Start-ScheduledTask -TaskName $taskName }
  'Stop' { Stop-OwnedTask }
  'Restart' { if (!(Owned-Task)) { throw 'TASK_NOT_INSTALLED' }; Stop-OwnedTask; Start-ScheduledTask -TaskName $taskName }
  'Uninstall' { if (Owned-Task) { Stop-OwnedTask; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false } }
}
if ($Action -ne 'Run') {
  $task = Owned-Task
  $info = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName } else { $null }
  @{ taskName = $taskName; installed = [bool]$task; taskState = if ($task) { [string]$task.State } else { 'Absent' }; lastTaskResult = if ($info) { $info.LastTaskResult } else { $null }; logonTrigger = if ($task) { $task.Triggers[0].CimClass.CimClassName }; runLevel = if ($task) { [string]$task.Principal.RunLevel }; logonType = if ($task) { [string]$task.Principal.LogonType }; runtime = Read-Status } | ConvertTo-Json -Depth 4 -Compress
}
