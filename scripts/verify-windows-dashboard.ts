import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createDatabase } from '@ai-pixel/db';
import { loadRuntime } from './runtime.js';

const phase = process.argv[2];
assert(['baseline', 'started', 'web-recovered', 'restarted'].includes(phase));
const database = createDatabase(loadRuntime().databaseUrl), output = '.local/windows-dashboard-live.json';
const organizationId = '11111111-1111-4111-8111-111111111111';
async function snapshot() {
  return JSON.parse(JSON.stringify({
    tasks: await database.sql`select id,status,version from tasks where organization_id=${organizationId} order by id`,
    runs: await database.sql`select id,status,version,checkpoint->'turns' as turns from workflow_runs where organization_id=${organizationId} order by id`,
    merges: await database.sql`select id,status,version from integration_merge_requests where organization_id=${organizationId} order by id`,
    operations: await database.sql`select id,status from integration_operations where organization_id=${organizationId} order by id`,
    receipts: await database.sql`select id,status,reply_status from integration_inbox where organization_id=${organizationId} order by id`,
  }));
}
try {
  if (phase === 'baseline') {
    try { assert.equal(JSON.parse(readFileSync(output, 'utf8')).verified, true, 'Unfinished baseline exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    writeFileSync(output, JSON.stringify({ before: await snapshot(), startedAt: new Date().toISOString(), verified: false, checks: [] }));
    console.log(JSON.stringify({ baselineSaved: true, noSlackCommandRequired: true }));
  } else {
    const baseline = JSON.parse(readFileSync(output, 'utf8'));
    assert.deepEqual(await snapshot(), baseline.before, 'Business state changed');
    const task = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/windows-local-api.ps1', '-Action', 'Status'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    assert.equal(task.status, 0); const status = JSON.parse(task.stdout), runtime = status.runtime;
    assert.equal(status.taskState, 'Running'); assert.equal(status.runLevel, 'Limited'); assert.equal(status.logonType, 'Interactive'); assert.equal(status.logonTrigger, 'MSFT_TaskLogonTrigger');
    assert.equal(runtime.state, 'RUNNING'); assert.equal(runtime.services.api.state, 'RUNNING'); assert.equal(runtime.services.web.state, 'RUNNING');
    const probe = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-NetTCPConnection -State Listen -LocalPort 3000,3001 | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    assert.equal(probe.status, 0); const ports = JSON.parse(probe.stdout);
    for (const [port, pid] of [[3000, runtime.webPid], [3001, runtime.apiPid]]) {
      assert.equal(ports.filter((row: { LocalPort: number }) => row.LocalPort === port).length, 1);
      const row = ports.find((row: { LocalPort: number }) => row.LocalPort === port); assert.equal(row.LocalAddress, '127.0.0.1'); assert.equal(row.OwningProcess, pid);
    }
    assert((await fetch('http://127.0.0.1:3001/health/live')).ok); assert((await fetch('http://127.0.0.1:3000/')).ok);
    const previous = baseline.checks.at(-1);
    if (phase === 'web-recovered') {
      assert.equal(previous.phase, 'started'); assert.equal(runtime.supervisorPid, previous.runtime.supervisorPid);
      assert.equal(runtime.apiPid, previous.runtime.apiPid); assert.notEqual(runtime.webPid, previous.runtime.webPid); assert.equal(runtime.services.web.attempt, 1);
    } else if (phase === 'restarted') {
      assert.equal(previous.phase, 'web-recovered');
      for (const key of ['supervisorPid', 'apiPid', 'webPid']) assert.notEqual(runtime[key], previous.runtime[key]);
      assert.equal(runtime.services.api.attempt, 0); assert.equal(runtime.services.web.attempt, 0);
    } else assert.equal(baseline.checks.length, 0);
    const result = { ...baseline, verified: phase === 'restarted', checks: [...baseline.checks, { phase, runtime, checkedAt: new Date().toISOString() }] };
    writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ phase, verified: true, final: result.verified, apiPid: runtime.apiPid, webPid: runtime.webPid, supervisorPid: runtime.supervisorPid,
      apiAttempt: runtime.services.api.attempt, webAttempt: runtime.services.web.attempt, businessChanges: 0 }));
  }
} finally { await database.close(); }
