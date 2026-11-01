function New-LocalStartupSettings {
  New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
}

function Get-LocalStartupAction([string]$ScriptPath, [string]$NodePath, [switch]$Legacy) {
  $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if ($Legacy) {
    return @{Execute=$powerShell;Arguments="-NoProfile -NonInteractive -WindowStyle Hidden -File `"$ScriptPath`" -Action Run -NodePath `"$NodePath`""}
  }
  $launcher = [IO.Path]::ChangeExtension($ScriptPath, '.vbs')
  return @{Execute=(Join-Path $env:SystemRoot 'System32\wscript.exe');Arguments="//B //Nologo `"$launcher`" `"$NodePath`""}
}

function Test-LocalStartupAction($Action, [string]$ScriptPath) {
  # Accept only the exact old/new owned action, allowing an existing install to
  # migrate. Never treat a merely matching command prefix as our scheduled job.
  $match = [regex]::Match($Action.Arguments, '"([^"\r\n%]+\\node\.exe)"$')
  if (!$match.Success) { return $false }
  foreach ($legacy in @($false, $true)) {
    $expected = Get-LocalStartupAction $ScriptPath $match.Groups[1].Value -Legacy:$legacy
    if ($Action.Execute -eq $expected.Execute -and $Action.Arguments -ceq $expected.Arguments) { return $true }
  }
  return $false
}

function Get-LocalStartupDecision($Recovery, [string]$SessionKey) {
  if (!$Recovery) { return @{launch=$true;attempt=1;reason='NEW_SESSION'} }
  if ($Recovery.version -ne 1 -or $Recovery.sessionKey -isnot [string] -or !$Recovery.sessionKey -or $Recovery.attempt -isnot [int] -or $Recovery.attempt -lt 0 -or $Recovery.attempt -gt 4 -or $Recovery.blocked -isnot [bool]) { throw 'RECOVERY_STATE_INVALID' }
  if ($Recovery.sessionKey -ne $SessionKey) { return @{launch=$true;attempt=1;reason='NEW_SESSION'} }
  if ($Recovery.blocked) { return @{launch=$false;attempt=$Recovery.attempt;reason='STOPPED_OR_COMPLETED'} }
  if ($Recovery.attempt -ge 4) { return @{launch=$false;attempt=4;reason='RECOVERY_LIMIT'} }
  return @{launch=$true;attempt=($Recovery.attempt + 1);reason='RECOVERY'}
}
