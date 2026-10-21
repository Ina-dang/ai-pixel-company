import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

function policy(expression: string) {
  const script = resolve('scripts/windows-startup-policy.ps1').replaceAll("'", "''");
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; . '${script}'; & { ${expression} } | ConvertTo-Json -Compress`],
  { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

test.skipIf(process.platform !== 'win32')('scheduler avoids native failure retries and overlapping runs without requiring battery power', () => {
  const settings = policy('New-LocalStartupSettings | Select-Object RestartCount,RestartInterval,MultipleInstances,ExecutionTimeLimit,AllowDemandStart,DisallowStartIfOnBatteries,StopIfGoingOnBatteries');
  expect(settings).toMatchObject({ RestartCount: 0, RestartInterval: null, MultipleInstances: 2, ExecutionTimeLimit: 'PT0S', AllowDemandStart: true,
    DisallowStartIfOnBatteries: false, StopIfGoingOnBatteries: false });
});

test.skipIf(process.platform !== 'win32')('durable budget caps supervisor recovery, respects stop/exhaustion and resets only for a new logon', () => {
  const decisions = policy(`@(
    (Get-LocalStartupDecision $null 'logon-a'),
    (Get-LocalStartupDecision ([pscustomobject]@{version=1;sessionKey='logon-a';attempt=1;blocked=$false}) 'logon-a'),
    (Get-LocalStartupDecision ([pscustomobject]@{version=1;sessionKey='logon-a';attempt=3;blocked=$false}) 'logon-a'),
    (Get-LocalStartupDecision ([pscustomobject]@{version=1;sessionKey='logon-a';attempt=4;blocked=$false}) 'logon-a'),
    (Get-LocalStartupDecision ([pscustomobject]@{version=1;sessionKey='logon-a';attempt=2;blocked=$true}) 'logon-a'),
    (Get-LocalStartupDecision ([pscustomobject]@{version=1;sessionKey='logon-a';attempt=4;blocked=$true}) 'logon-b')
  )`);
  expect(decisions.map((value: { launch: boolean; attempt: number }) => [value.launch, value.attempt])).toEqual([[true, 1], [true, 2], [true, 4], [false, 4], [false, 2], [true, 1]]);
});

test.skipIf(process.platform !== 'win32')('corrupt same-session retry budgets fail closed', () => {
  expect(policy("try { Get-LocalStartupDecision ([pscustomobject]@{version=1;sessionKey='a';attempt=99;blocked=$false}) 'a'; throw 'NOT_BLOCKED' } catch { $_.Exception.Message }"))
    .toBe('RECOVERY_STATE_INVALID');
});
