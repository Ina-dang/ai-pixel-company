import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import type { SubscriptionState, WorkflowRun } from '../packages/agents/src/types.js';

// Explicit opt-in command: this consumes the existing shared Codex allowance.
// It never supplies an API key, buys credits or accepts the resulting artifact.
const base = 'http://127.0.0.1:3001/api/v1';
let cookie = '', csrf = '';
async function request<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: {
    cookie, origin: 'http://127.0.0.1:3000', 'content-type': 'application/json',
    'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID(),
  }, body: body ? JSON.stringify(body) : undefined });
  if (path === '/auth/session') cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const result = await response.json();
  if (!response.ok) throw new Error(`Smoke API rejected ${path}: HTTP ${response.status}, ${result.error?.code ?? 'UNKNOWN'}`);
  return result.data;
}
const session = await request<{ csrfToken: string }>('/auth/session', { secret: readFileSync(resolve('.local/owner-key'), 'utf8').trim() });
csrf = session.csrfToken;
const subscription = await request<SubscriptionState>('/subscription');
assert(subscription.ready, `Subscription not ready: ${subscription.reason}`);
console.log(JSON.stringify({ subscription: { authMode: subscription.authMode, billingMode: subscription.billingMode, windows: subscription.windows } }));
const original = '덧셈 add(a,b)와 배열 합계 sum(values)의 오류를 수정해 주세요. 음수·빈 배열도 정확해야 하며 기존 내보내기와 테스트를 보존해 주세요.';
let created: WorkflowRun;
const resumeId = process.argv[2] === '--resume' ? process.argv[3] : undefined;
if (resumeId) {
  assert(/^[a-f0-9-]{36}$/i.test(resumeId), 'Invalid fixture run ID');
  const existing = await request<WorkflowRun>(`/runs/${resumeId}`);
  assert.equal(existing.commandOriginalKo, original, 'Only this smoke fixture can be resumed');
  created = await request<WorkflowRun>(`/runs/${resumeId}/control`, { action: 'resume', expectedVersion: existing.version });
} else {
  const project = await request<{ id: string }>('/projects', { name: `구독 직원 검증 ${randomUUID().slice(0, 8)}`, repositoryUrl: 'https://github.com/Ina-dang/ai-pixel-company.git', defaultBranch: 'main' });
  const task = await request<{ id: string }>(`/projects/${project.id}/tasks`, { title: 'Codex 구독 PM·Developer·QA 실제 검증', commandOriginalKo: original,
    acceptanceCriteria: [{ id: 'AC-1', descriptionKo: '덧셈, 음수, 합계, 빈 배열 테스트 및 빌드가 성공한다.', method: 'unit-test', required: true }], priority: 'MEDIUM' });
  created = await request<WorkflowRun>(`/tasks/${task.id}/runs`, { fixture: 'node-functions-v1' });
}
console.log(JSON.stringify({ projectId: created.projectId, taskId: created.taskId, runId: created.id }));
let previous = '';
let final: WorkflowRun | null = null;
try {
  for (let count = 0; count < 900; count++) {
    const run = await request<WorkflowRun>(`/runs/${created.id}`);
    const marker = `${run.status}:${run.checkpoint.stage}:${run.checkpoint.roles.length}`;
    if (marker !== previous) { console.log(JSON.stringify({ status: run.status, stage: run.checkpoint.stage, completedRoles: run.checkpoint.roles.map(role => role.role), reason: run.checkpoint.stopReason })); previous = marker; }
    if (['WAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(run.status)) { final = run; break; }
    await sleep(1000);
  }
  assert(final, 'Workflow timed out');
  assert.equal(final.status, 'WAITING_APPROVAL', `Stopped: ${final.checkpoint.stopReason}`);
  assert.equal(final.commandOriginalKo, original);
  const cp = final.checkpoint;
  for (const role of ['PM', 'DEVELOPER', 'QA']) assert(cp.roles.some(item => item.role === role && item.threadId), `${role} actual thread missing`);
  assert(cp.workspace?.diff && cp.workspace.files.some(file => file.path === 'src/math.mjs'));
  assert.equal(cp.verification?.test.exitCode, 0); assert.equal(cp.verification?.build.exitCode, 0);
  assert.equal(cp.verification?.sha, cp.workspace.sha);
  const qa = cp.roles.filter(item => item.role === 'QA').at(-1);
  assert.equal(qa?.output.verdict, 'PASS'); assert.equal(qa.candidateSha, cp.workspace.sha);
  assert(cp.usage.inputTokens > 0 && cp.usage.outputTokens > 0);
  console.log(JSON.stringify({ verified: true, runId: final.id, candidateSha: cp.workspace.sha, changedFiles: cp.roles.filter(item => item.role === 'DEVELOPER').flatMap(item => item.output.files.map(file => file.path)),
    testExitCode: cp.verification.test.exitCode, buildExitCode: cp.verification.build.exitCode, qa: qa.output.verdict,
    rework: cp.rework, turns: cp.turns, usage: cp.usage, ownerAcceptance: 'PENDING', billingMode: 'CHATGPT_SUBSCRIPTION' }));
} finally {
  await request('/auth/session', {}, 'DELETE').catch(() => undefined);
}
