import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { slackConfig } from '@ai-pixel/integrations';

// One explicitly requested report through the durable server outbox. No model,
// task creation, acceptance, GitHub operation, merge or deployment is requested.
const [projectId, runId, flag] = process.argv.slice(2);
assert(projectId && runId && flag === '--send', 'Usage: verify-slack-report.ts <projectId> <verifiedRunId> --send');
const settings = JSON.parse(readFileSync('.local/integrations.json', 'utf8'));
const configured = settings.connections.find((entry: { projectId: string; provider: string }) => entry.projectId === projectId && entry.provider === 'SLACK');
assert(configured, 'Existing local Slack connection required');
const config = slackConfig(configured.config);
assert.equal(config.teamId, 'T0BSCLLFFDJ'); assert.equal(config.channelId, 'C0CAEGXQ5LL');
const origin = 'http://127.0.0.1:3000';
const login = await fetch(`${origin}/api/v1/auth/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: readFileSync('.local/owner-key', 'utf8').trim() }) });
assert(login.ok, `Login HTTP ${login.status}`);
const session = await login.json(), cookies = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
async function api(path: string, body?: unknown) {
  const response = await fetch(`${origin}/api/v1${path}`, { method: body ? 'POST' : 'GET',
    headers: { Origin: origin, Cookie: cookies, 'X-CSRF-Token': session.data.csrfToken, 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert(response.ok, `API HTTP ${response.status}: ${result.error?.code ?? 'unavailable'}`); return result.data;
}
const before = await api(`/runs/${runId}`);
assert.equal(before.projectId, projectId); assert(['WAITING_APPROVAL', 'SUCCEEDED'].includes(before.status), 'Verified review or accepted run required');
const existing = await api(`/projects/${projectId}/integrations`);
assert(!existing.operations.some((entry: { runId: string; kind: string }) => entry.runId === runId && entry.kind === 'SLACK_REPORT'), 'Report already recorded. Inspect it; never blindly resend.');
let operation = await api(`/projects/${projectId}/integrations/operations`, { kind: 'SLACK_REPORT', runId, expectedRunVersion: before.version });
const save = () => writeFileSync('.local/slack-report-live.json', JSON.stringify({ projectId, runId, taskId: before.taskId, operationId: operation.id, status: operation.status, externalRef: operation.externalRef, errorCode: operation.errorCode, checkedAt: new Date().toISOString() }, null, 2));
save();
const deadline = Date.now() + 30_000;
while (['PENDING', 'RUNNING', 'DEFERRED'].includes(operation.status) && Date.now() < deadline) {
  await sleep(500); const state = await api(`/projects/${projectId}/integrations`);
  operation = state.operations.find((entry: { id: string }) => entry.id === operation.id); assert(operation, 'Operation missing'); save();
}
assert.equal(operation.status, 'SUCCEEDED', `Stop without resending: ${operation.status} ${operation.errorCode ?? ''}`);
assert.equal(operation.externalRef.channelId, config.channelId);
const after = await api(`/runs/${runId}`);
assert.equal(after.status, before.status); assert.equal(after.version, before.version);
assert.equal(after.checkpoint.turns, before.checkpoint.turns); assert.equal(after.checkpoint.workspace.sha, before.checkpoint.workspace.sha);
console.log(JSON.stringify({ verified: true, operationId: operation.id, externalRef: operation.externalRef, runStatus: after.status, runVersion: after.version, employeeTurnsUnchanged: true, detailUrl: `${origin}/?project=${projectId}&task=${before.taskId}#task-inspector` }));
