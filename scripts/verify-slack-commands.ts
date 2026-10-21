import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createDatabase } from '@ai-pixel/db';
import { loadRuntime } from './runtime.js';

// Reads local server evidence only. Commands must be sent from the real Slack UI.
// This script never manufactures an inbox receipt or sends a Slack request.
const mode = process.argv[2], transport = process.argv[3] ?? 'HTTP';
assert(['baseline', 'verify', 'verify-restart', 'verify-recovery'].includes(mode) && ['HTTP', 'SOCKET'].includes(transport), 'Usage: verify-slack-commands.ts baseline|verify|verify-restart|verify-recovery [HTTP|SOCKET]');
const projectId = '56c54d8a-de76-4400-8308-a63b1bd2adaa', organizationId = '11111111-1111-4111-8111-111111111111';
const database = createDatabase(loadRuntime().databaseUrl), output = transport === 'SOCKET' ? '.local/slack-socket-commands-live.json' : '.local/slack-commands-live.json';
async function snapshot() {
  return {
    tasks: await database.sql`select id,status from tasks where organization_id=${organizationId} and project_id=${projectId} order by id`,
    runs: await database.sql`select id,status,version,checkpoint->'turns' as turns from workflow_runs where organization_id=${organizationId} order by id`,
    merges: await database.sql`select id,status,version from integration_merge_requests where organization_id=${organizationId} order by id`,
    operations: await database.sql`select id,status from integration_operations where organization_id=${organizationId} order by id`,
    receipts: await database.sql`select id from integration_inbox where organization_id=${organizationId} and project_id=${projectId} and provider='SLACK' order by id`,
  };
}
try {
  const connections = await database.sql`select id,config from integration_connections where organization_id=${organizationId} and project_id=${projectId} and provider='SLACK' and enabled=true`;
  assert.equal(connections.length, 1); const connection = connections[0];
  assert.equal(connection.config.teamId, 'T0BSCLLFFDJ'); assert.equal(connection.config.channelId, 'C0CAEGXQ5LL');
  assert.equal(connection.config.mode ?? 'HTTP', transport);
  if (mode === 'baseline') {
    try { const old = JSON.parse(readFileSync(output, 'utf8')); assert(old.verified === true, 'An unfinished baseline exists; inspect it instead of overwriting.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
    const original = `${transport === 'SOCKET' ? 'Socket Mode' : 'Slack 명령'} 실제 검증 ${date}-${randomUUID().slice(0, 8)} — 공백  2칸 유지, 자동 실행·수락·merge·운영 배포 금지`;
    const baseline = { projectId, connectionId: connection.id, transport, original, startedAt: new Date().toISOString(), before: await snapshot(), verified: false };
    writeFileSync(output, JSON.stringify(baseline, null, 2));
    console.log(JSON.stringify({ baselineSaved: true, projectId, connectionId: connection.id, statusCommand: '/ai-pixel 상태', taskCommand: `/ai-pixel 업무 ${original}` }));
  } else {
    const baseline = JSON.parse(readFileSync(output, 'utf8')); assert.equal(baseline.projectId, projectId); assert.equal(baseline.connectionId, connection.id);
    // postgres RowList has a different prototype from the persisted JSON array.
    const after = JSON.parse(JSON.stringify(await snapshot())), oldReceipts = new Set(baseline.before.receipts.map((row: { id: string }) => row.id));
    const rows = await database.sql`select id,payload,status,reply_status,reply_ref,result from integration_inbox where organization_id=${organizationId} and project_id=${projectId} and provider='SLACK' order by created_at,id`;
    const received = rows.filter(row => !oldReceipts.has(row.id)), recovery = mode === 'verify-recovery', restart = mode === 'verify-restart' || recovery;
    assert.equal(received.length, recovery ? 4 : restart ? 3 : 2, 'Unexpected live command count; inspect rather than resending');
    assert.deepEqual(received.map(row => row.payload.command.kind).sort(), recovery ? ['STATUS', 'STATUS', 'STATUS', 'TASK'] : restart ? ['STATUS', 'STATUS', 'TASK'] : ['STATUS', 'TASK']);
    for (const row of received) {
      assert.equal(row.status, 'PROCESSED'); assert.equal(row.reply_status, 'SENT'); assert.equal(row.reply_ref.channelId, 'C0CAEGXQ5LL');
      if (transport === 'SOCKET') assert.equal(row.payload.transport, 'SOCKET');
      for (const label of ['업무명', '변경 요약', '검증 결과', '다음 할 일', '상세 화면']) assert(row.result.text.includes(label), `Reply missing ${label}`);
    }
    const taskCommand = received.find(row => row.payload.command.kind === 'TASK'); assert(taskCommand);
    assert.equal(taskCommand.payload.command.original, baseline.original);
    const tasks = await database.sql`select id,source,status,title,command_original_ko,command_hash from tasks where organization_id=${organizationId} and project_id=${projectId} and id=${taskCommand.result.taskId}`;
    assert.equal(tasks.length, 1); const task = tasks[0]; assert.equal(task.source, 'SLACK'); assert.equal(task.status, 'TODO');
    assert.equal(task.command_original_ko, baseline.original); assert.equal(task.command_hash, createHash('sha256').update(baseline.original).digest('hex'));
    assert.equal(after.tasks.length, baseline.before.tasks.length + 1);
    assert.deepEqual(after.tasks.filter((row: { id: string }) => row.id !== task.id), baseline.before.tasks);
    assert.deepEqual(after.runs, baseline.before.runs); assert.deepEqual(after.merges, baseline.before.merges); assert.deepEqual(after.operations, baseline.before.operations);
    const result = { ...baseline, verified: true, restartVerified: restart, recoveryVerified: recovery, verifiedAt: new Date().toISOString(), taskId: task.id, title: task.title, taskStatus: task.status, source: task.source,
      originalPreserved: true, doubleSpacesPreserved: task.command_original_ko.includes('공백  2칸'), modelRunsAdded: 0, mergeChanges: 0, operationChanges: 0,
      commands: received.map(row => ({ id: row.id, kind: row.payload.command.kind, status: row.status, replyStatus: row.reply_status, externalRef: row.reply_ref })),
      detailUrl: `http://127.0.0.1:3000/?project=${projectId}&task=${task.id}#task-inspector` };
    writeFileSync(output, JSON.stringify(result, null, 2));
    const { before: _before, original: _original, ...summary } = result; console.log(JSON.stringify(summary));
  }
} finally { await database.close(); }
