import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

test.skipIf(process.platform !== 'win32')('exact legacy and consoleless actions migrate safely across PowerShell hosts', () => {
  const result = policy(`
    $script='C:\\workspace with spaces\\scripts\\windows-local-api.ps1'
    $node='C:\\node runtime\\node.exe'
    $legacy=Get-LocalStartupAction $script $node -Legacy
    $hidden=Get-LocalStartupAction $script $node
    $extra=@{Execute=$hidden.Execute;Arguments=$hidden.Arguments+' -other'}
    $foreign=@{Execute=$hidden.Execute;Arguments=$hidden.Arguments.Replace('workspace with spaces','other')}
    @{hidden=$hidden; legacyAccepted=(Test-LocalStartupAction $legacy $script);hiddenAccepted=(Test-LocalStartupAction $hidden $script);extraAccepted=(Test-LocalStartupAction $extra $script);foreignAccepted=(Test-LocalStartupAction $foreign $script)}
  `);
  expect(result).toMatchObject({ legacyAccepted: true, hiddenAccepted: true, extraAccepted: false, foreignAccepted: false });
  expect(result.hidden.Execute.toLowerCase()).toBe(resolve(policy('$env:SystemRoot'), 'System32/wscript.exe').toLowerCase());
  expect(result.hidden.Arguments).toBe('//B //Nologo "C:\\workspace with spaces\\scripts\\windows-local-api.vbs" "C:\\node runtime\\node.exe"');
});

test.skipIf(process.platform !== 'win32')('GUI launcher waits for its owned PowerShell, preserves spaced paths and exit status', () => {
  const folder = mkdtempSync(resolve(tmpdir(), 'pixel launcher '));
  try {
    const launcher = resolve(folder, 'windows-local-api.vbs'), marker = resolve(folder, 'done.json');
    copyFileSync(resolve('scripts/windows-local-api.vbs'), launcher);
    writeFileSync(resolve(folder, 'windows-local-api.ps1'), `param([string]$Action,[string]$NodePath)\nStart-Sleep -Milliseconds 600\n@{action=$Action;node=$NodePath} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'done.json')\nexit 7\n`);
    const host = resolve(policy('$env:SystemRoot'), 'System32/wscript.exe');
    const started = Date.now();
    const result = spawnSync(host, ['//B', '//Nologo', launcher, process.execPath], { windowsHide: true, timeout: 15000 });
    expect(result.status, result.error?.message).toBe(7);
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);
    expect(JSON.parse(readFileSync(marker, 'utf8').replace(/^\uFEFF/, ''))).toEqual({ action: 'Run', node: process.execPath });
    expect(spawnSync(host, ['//B', '//Nologo', launcher], { windowsHide: true, timeout: 15000 }).status).toBe(2);
    expect(spawnSync(host, ['//B', '//Nologo', launcher, '%INVALID%/node.exe'], { windowsHide: true, timeout: 15000 }).status).toBe(2);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
