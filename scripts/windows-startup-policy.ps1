function New-LocalStartupSettings {
  New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
}

function Get-LocalStartupDecision($Recovery, [string]$SessionKey) {
  if (!$Recovery) { return @{launch=$true;attempt=1;reason='NEW_SESSION'} }
  if ($Recovery.version -ne 1 -or $Recovery.sessionKey -isnot [string] -or !$Recovery.sessionKey -or $Recovery.attempt -isnot [int] -or $Recovery.attempt -lt 0 -or $Recovery.attempt -gt 4 -or $Recovery.blocked -isnot [bool]) { throw 'RECOVERY_STATE_INVALID' }
  if ($Recovery.sessionKey -ne $SessionKey) { return @{launch=$true;attempt=1;reason='NEW_SESSION'} }
  if ($Recovery.blocked) { return @{launch=$false;attempt=$Recovery.attempt;reason='STOPPED_OR_COMPLETED'} }
  if ($Recovery.attempt -ge 4) { return @{launch=$false;attempt=4;reason='RECOVERY_LIMIT'} }
  return @{launch=$true;attempt=($Recovery.attempt + 1);reason='RECOVERY'}
}
