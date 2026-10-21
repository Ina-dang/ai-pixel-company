import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDatabase } from '@ai-pixel/db';
import { loadRuntime } from './runtime.js';

const phase = process.argv[2];
assert(['baseline', 'started', 'fault', 'recovered', 'stopped', 'restarted'].includes(phase));
const file = '.local/windows-recovery-live.json', organizationId = '11111111-1111-4111-8111-111111111111';
const database = createDatabase(loadRuntime().databaseUrl);
function powerShell(script: string) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, 'WINDOWS_PROBE_FAILED');
  return JSON.parse(result.stdout);
}
async function snapshot() {
  return JSON.parse(JSON.stringify({
    tasks: await database.sql`select id,status,version from tasks where organization_id=${organizationId} order by id`,
    runs: await database.sql`select id,status,version,checkpoint->'turns' as turns from workflow_runs where organization_id=${organizationId} order by id`,
    merges: await database.sql`select id,status,version from integration_merge_requests where organization_id=${organizationId} order by id`,
    operations: await database.sql`select id,status from integration_operations where organization_id=${organizationId} order by id`,
  }));
}
try {
  if (phase === 'baseline') {
    writeFileSync(file, JSON.stringify({ before: await snapshot(), startedAt: new Date().toISOString(), checks: [], verified: false }));
    console.log(JSON.stringify({ baselineSaved: true }));
  } else {
    const evidence = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(await snapshot(), evidence.before, 'BUSINESS_STATE_CHANGED');
    const state = powerShell(`& '${resolve('scripts/windows-local-api.ps1').replaceAll("'", "''")}' -Action Status`);
    assert.equal(state.recoveryInterval, 'PT1M');
    assert.equal(state.runLevel, 'Limited'); assert.equal(state.logonType, 'Interactive');
    const runtime = state.runtime;
    if (phase === 'stopped') {
      assert.equal(state.taskState, 'Ready'); assert.equal(state.lastTaskResult, 0);
      assert.equal(state.recoveryBlocked, true);
      assert.equal(runtime.completed, true); assert.equal(runtime.state, 'STOPPED');
      const listeners = powerShell('@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in @(3000,3001)}).Count | ConvertTo-Json -Compress');
      assert.equal(listeners, 0);
    } else {
      assert.equal(state.taskState, 'Running'); assert.equal(runtime.state, 'RUNNING');
      const listeners = powerShell('ConvertTo-Json -InputObject @(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in @(3000,3001)} | Select-Object LocalAddress,LocalPort,OwningProcess) -Compress');
      assert.equal(listeners.length, 2);
      for (const [port, pid] of [[3000, runtime.webPid], [3001, runtime.apiPid]]) assert(listeners.some((row: { LocalAddress: string; LocalPort: number; OwningProcess: number }) => row.LocalAddress === '127.0.0.1' && row.LocalPort === port && row.OwningProcess === pid));
      for (const url of ['http://127.0.0.1:3000/', 'http://127.0.0.1:3001/health/live']) assert((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok);
    }
    if (phase === 'fault') {
      assert.equal(evidence.checks.at(-1)?.phase, 'started');
      const supervisorScript = resolve('scripts/windows-local-api.mjs').replaceAll("'", "''");
      const wrapperScript = resolve('scripts/windows-local-api.ps1').replaceAll("'", "''");
      const nodePath = process.execPath.replaceAll("'", "''");
      const fault = powerShell(`$ErrorActionPreference='Stop'; $child=Get-CimInstance Win32_Process -Filter 'ProcessId = ${runtime.supervisorPid}'; if (!$child -or $child.ExecutablePath -ne '${nodePath}' -or !$child.CommandLine.Contains('${supervisorScript}')) {throw 'SUPERVISOR_IDENTITY_MISMATCH'}; $wrapper=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $child.ParentProcessId); if (!$wrapper -or $wrapper.ExecutablePath -ne (Join-Path $PSHOME 'powershell.exe') -or !$wrapper.CommandLine.Contains('${wrapperScript}') -or !$wrapper.CommandLine.Contains('-Action Run')) {throw 'WRAPPER_IDENTITY_MISMATCH'}; $process=Get-Process -Id $wrapper.ProcessId; $format='yyyy-MM-ddTHH:mm:ss.ffffffZ'; if ($process.Path -ne $wrapper.ExecutablePath -or $process.StartTime.ToUniversalTime().ToString($format) -ne $wrapper.CreationDate.ToUniversalTime().ToString($format)) {throw 'WRAPPER_REUSED'}; $process.Kill(); @{wrapperPid=$wrapper.ProcessId; fault='OWNED_WRAPPER_KILLED'} | ConvertTo-Json -Compress`);
      console.log(JSON.stringify(fault));
    }
    if (phase === 'recovered') {
      const previous = evidence.checks.at(-1);
      assert.equal(previous?.phase, 'fault');
      assert(state.recoveryAttempt >= 2 && state.recoveryAttempt <= 4, 'RECOVERY_BUDGET_EXCEEDED');
      for (const key of ['launchId', 'supervisorPid', 'apiPid', 'webPid']) assert.notEqual(runtime[key], previous.runtime[key], `${key} did not change`);
    }
    evidence.checks.push({ phase, checkedAt: new Date().toISOString(), runtime, lastTaskResult: state.lastTaskResult });
    evidence.verified = phase === 'restarted' && ['started', 'fault', 'recovered', 'stopped'].every(value => evidence.checks.some((check: { phase: string }) => check.phase === value));
    writeFileSync(file, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ verified: true, phase, final: evidence.verified, runtime, businessChanges: 0 }));
  }
} finally { await database.close(); }
