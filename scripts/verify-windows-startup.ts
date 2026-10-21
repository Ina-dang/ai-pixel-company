import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createDatabase } from '@ai-pixel/db';
import { loadRuntime } from './runtime.js';

const mode = process.argv[2], expected = Number(process.argv[3]), finalKind = process.argv[4] ?? 'STATUS';
assert(mode === 'baseline' || (mode === 'verify' && Number.isInteger(expected) && expected >= 1 && expected <= 3));
assert(['STATUS', 'HELP'].includes(finalKind));
const database = createDatabase(loadRuntime().databaseUrl), output = '.local/windows-api-live.json';
const organizationId = '11111111-1111-4111-8111-111111111111', connectionId = 'bd05d0e7-88c7-4a5b-b2f9-61bd68c1098f';
async function snapshot() {
  return JSON.parse(JSON.stringify({
    tasks: await database.sql`select id,status,version from tasks where organization_id=${organizationId} order by id`,
    runs: await database.sql`select id,status,version,checkpoint->'turns' as turns from workflow_runs where organization_id=${organizationId} order by id`,
    merges: await database.sql`select id,status,version from integration_merge_requests where organization_id=${organizationId} order by id`,
    operations: await database.sql`select id,status from integration_operations where organization_id=${organizationId} order by id`,
    receipts: await database.sql`select id from integration_inbox where connection_id=${connectionId} order by id`,
  }));
}
try {
  if (mode === 'baseline') {
    try { const old = JSON.parse(readFileSync(output, 'utf8')); assert(old.verified === true, 'Unfinished baseline exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    writeFileSync(output, JSON.stringify({ before: await snapshot(), startedAt: new Date().toISOString(), verified: false }));
    console.log(JSON.stringify({ baselineSaved: true, statusCommand: '/ai-pixel 상태', expectedFinalCommands: 3 }));
  } else {
    const baseline = JSON.parse(readFileSync(output, 'utf8')), after = await snapshot();
    for (const key of ['tasks', 'runs', 'merges', 'operations'] as const) assert.deepEqual(after[key], baseline.before[key], `${key} changed`);
    const old = new Set(baseline.before.receipts.map((row: { id: string }) => row.id));
    const rows = (await database.sql`select id,payload,status,reply_status,reply_ref from integration_inbox where connection_id=${connectionId} order by created_at,id`).filter(row => !old.has(row.id));
    assert.equal(rows.length, expected, 'Inspect instead of blindly resending a command');
    for (const [index, row] of rows.entries()) {
      assert.equal(row.payload.transport, 'SOCKET'); assert.equal(row.payload.command.kind, index === 2 ? finalKind : 'STATUS');
      assert.equal(row.status, 'PROCESSED'); assert.equal(row.reply_status, 'SENT');
    }
    const task = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/windows-local-api.ps1', '-Action', 'Status'], { encoding: 'utf8', windowsHide: true });
    assert.equal(task.status, 0); const taskStatus = JSON.parse(task.stdout);
    assert.equal(taskStatus.installed, true); assert.equal(taskStatus.taskState, 'Running'); assert.equal(taskStatus.runLevel, 'Limited');
    assert.equal(taskStatus.logonType, 'Interactive'); assert.equal(taskStatus.logonTrigger, 'MSFT_TaskLogonTrigger'); assert.equal(taskStatus.runtime.state, 'RUNNING');
    const port = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-NetTCPConnection -LocalPort 3001 -State Listen).OwningProcess'], { encoding: 'utf8', windowsHide: true });
    assert.equal(Number(port.stdout.trim()), taskStatus.runtime.apiPid);
    assert((await fetch('http://127.0.0.1:3001/health/live')).ok);
    const check = { commandsVerified: expected, commandKinds: rows.map(row => row.payload.command.kind), taskStatus, checkedAt: new Date().toISOString() };
    const result = { ...baseline, verified: expected === 3, checks: [...(baseline.checks ?? []), check] };
    writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ verified: true, final: result.verified, taskName: taskStatus.taskName, supervisorPid: taskStatus.runtime.supervisorPid,
      apiPid: taskStatus.runtime.apiPid, attempt: taskStatus.runtime.attempt, commands: rows.map(row => ({ id: row.id, kind: row.payload.command.kind, reply: row.reply_ref })),
      taskChanges: 0, modelRunsAdded: 0, mergeChanges: 0, operationChanges: 0 }));
  }
} finally { await database.close(); }
