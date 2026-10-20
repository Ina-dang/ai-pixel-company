import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { WorkflowRun, SubscriptionState } from '../packages/agents/src/types.js';

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/playwright');
const { chromium, expect } = await import('@playwright/test');
const proofPath = resolve('.local/how-to-trash-live.json');
const recorded = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) : null;
const historyPath = resolve('.local/how-to-trash-live-attempts.json');
const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) as Record<string, unknown>[] : [];
const prior = recorded?.runId || recorded?.taskId ? recorded : [...history].reverse().find(item => item.runId || item.taskId) ?? recorded;
if (recorded) {
  history.push(recorded); writeFileSync(historyPath, JSON.stringify(history, null, 2));
}
const reuseUnstarted = prior?.status === 'FAIL' && prior?.taskId && !prior?.runId;
const observeExisting = (process.argv.includes('--observe') || process.argv.includes('--reverify')) && prior?.runId;
if (prior?.runId && !observeExisting) throw new Error('Existing run found. Use --observe; never silently create another model run.');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
let csrf = '', runId: string | null = observeExisting ? String(prior.runId) : null;
const errors: string[] = [], seen = new Set<string>();
if (observeExisting) for (const state of prior.officeObserved ?? []) seen.add(String(state));
page.on('pageerror', error => errors.push(error.message));
const proof: Record<string, unknown> = { status: 'STARTED', startedAt: new Date().toISOString(), mode: 'REAL_SUBSCRIPTION_REPOSITORY',
  ...(observeExisting ? { runId, projectId: prior.projectId, taskId: prior.taskId } : {}) };
const record = (change: Record<string, unknown>) => { Object.assign(proof, change); writeFileSync(proofPath, JSON.stringify(proof, null, 2)); console.log(JSON.stringify(change)); };
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await page.request.fetch(`/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: {
    Origin: 'http://127.0.0.1:3000', 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID(),
  }, ...(body ? { data: body } : {}) });
  const result = await response.json();
  assert(response.ok(), `API ${path}: ${response.status()} ${result.error?.code ?? ''}`);
  return result.data;
}
try {
  await page.goto('/');
  await page.getByLabel('Owner 비밀키', { exact: true }).fill(readFileSync(resolve('.local/owner-key'), 'utf8').trim());
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  csrf = (await api<{ csrfToken: string }>('/me')).csrfToken;
  const subscription = await api<SubscriptionState>('/subscription');
  assert(subscription.ready, `Subscription admission blocked: ${subscription.reason}`);
  const project = reuseUnstarted || observeExisting ? { id: String(prior.projectId) } : await api<{ id: string }>('/projects', { name: '실제 업무 · how-to-trash 지역 검색', repositoryUrl: 'https://github.com/Ina-dang/how-to-trash.git', defaultBranch: 'main' });
  const task = reuseUnstarted || observeExisting ? { id: String(prior.taskId) } : await api<{ id: string }>(`/projects/${project.id}/tasks`, {
    title: '지도 없이 지역 목록·검색으로 분리수거 안내 찾기',
    commandOriginalKo: 'how-to-trash의 지원 지역 안내를 실제 wasteGuides 데이터에 맞추고, 지도 키가 없거나 지도가 실패해도 지역 목록과 검색으로 상세 페이지에 들어갈 수 있게 해줘. 지역명 부분 검색과 공백 처리, 결과 없음과 검색 초기화, 모바일·키보드 접근성을 지원해줘. 기존 분리수거 데이터·지도 코드·의존성은 바꾸지 말고 실제 테스트와 빌드로 검증해줘.',
    acceptanceCriteria: [
      { id: 'AC-1', descriptionKo: '기존 데이터 기준 지역 수·목록을 표시하고 잘못된 지원 지역 안내를 수정한다.', method: 'unit-test', required: true },
      { id: 'AC-2', descriptionKo: '공백 제거·부분 검색·검색 초기화·결과 없음과 키보드 사용을 지원한다.', method: 'unit-test', required: true },
      { id: 'AC-3', descriptionKo: '지도 키 없이도 모바일/데스크톱에서 지역 상세로 이동한다.', method: 'manual', required: true },
      { id: 'AC-4', descriptionKo: '기존 데이터·지도·의존성을 보존하고 테스트·lint·타입·빌드를 통과한다.', method: 'unit-test', required: true },
    ], priority: 'MEDIUM',
  });
  record({ projectId: project.id, taskId: task.id, billingMode: subscription.billingMode });
  await page.reload();
  await page.getByLabel('현재 프로젝트', { exact: true }).selectOption(project.id);
  await page.getByRole('button', { name: '업무 상세: 지도 없이 지역 목록·검색으로 분리수거 안내 찾기', exact: true }).click();
  if (!observeExisting) {
    await expect(page.getByRole('button', { name: '실제 저장소 업무 실행', exact: true })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: '실제 저장소 업무 실행', exact: true }).click();
    await expect.poll(async () => (await api<{ items: WorkflowRun[] }>(`/tasks/${task.id}/runs`)).items.length).toBe(1);
  }
  runId = observeExisting ? String(prior.runId) : (await api<{ items: WorkflowRun[] }>(`/tasks/${task.id}/runs`)).items[0].id;
  if (process.argv.includes('--reverify')) {
    const current = await api<WorkflowRun>(`/runs/${runId}`);
    assert.equal(current.status, 'BLOCKED'); assert.equal(current.checkpoint.stopReason, 'DEVELOPER_CONTRACT_INVALID');
    await api(`/runs/${runId}/control`, { action: 'reverify', expectedVersion: current.version,
      ...(process.argv.includes('--approve-5min') ? { verificationWindowMs: 300_000 } : {}) });
  }
  record({ runId, status: 'RUNNING' });
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  let final: WorkflowRun | null = null, previous = '';
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    for (const item of await office.locator('[data-office-agent]').evaluateAll(nodes => nodes.map(node => ({ role: node.getAttribute('data-office-agent'), state: node.getAttribute('data-agent-state'), stage: node.getAttribute('data-run-stage'), runId: node.getAttribute('data-run-id') })))) {
      if (item.runId === runId) seen.add(`${item.role}:${item.state}:${item.stage}`);
    }
    const current = await api<WorkflowRun>(`/runs/${runId}`);
    const marker = `${current.status}:${current.checkpoint.stage}`;
    if (marker !== previous) { record({ marker, officeObserved: [...seen] }); previous = marker; }
    if (['WAITING_APPROVAL', 'FAILED', 'BLOCKED', 'CANCELLED', 'SUCCEEDED'].includes(current.status)) { final = current; break; }
    await sleep(800);
  }
  assert(final, 'Live run observation timed out');
  record({ finalStatus: final.status, stopReason: final.checkpoint.stopReason, rework: final.checkpoint.rework });
  assert.equal(final.status, 'WAITING_APPROVAL');
  assert.equal(final.checkpoint.verification?.test.exitCode, 0);
  assert.equal(final.checkpoint.verification?.build.exitCode, 0);
  assert.equal(final.repositorySource?.repositoryUrl, 'https://github.com/Ina-dang/how-to-trash.git');
  const qa = final.checkpoint.roles.filter(role => role.role === 'QA').at(-1);
  assert.equal(qa?.output.verdict, 'PASS');
  assert.equal(qa.candidateSha, final.checkpoint.verification.sha);
  assert.equal(final.checkpoint.workspace?.sha, qa.candidateSha);
  for (const state of ['PM:RUNNING:PM', 'DEVELOPER:RUNNING:DEVELOPER', 'QA:REVIEWING:QA']) assert(seen.has(state), `Office missing ${state}`);
  await page.reload();
  await page.getByLabel('현재 프로젝트', { exact: true }).selectOption(project.id);
  await page.getByRole('button', { name: '업무 상세: 지도 없이 지역 목록·검색으로 분리수거 안내 찾기', exact: true }).click();
  await expect(page.getByText(runId, { exact: true })).toBeVisible({ timeout: 20000 });
  assert.equal(errors.length, 0);
  mkdirSync(resolve('.local/browser-evidence'), { recursive: true });
  await page.screenshot({ path: resolve('.local/browser-evidence/how-to-trash-workflow.png'), fullPage: true });
  record({ status: 'PASS', candidateSha: qa.candidateSha, source: final.repositorySource, roles: final.checkpoint.roles.map(role => ({ role: role.role, threadId: role.threadId, candidateSha: role.candidateSha })), usage: final.checkpoint.usage, officeObserved: [...seen], pageErrors: errors, completedAt: new Date().toISOString() });
} catch (error) {
  record({ status: 'FAIL', runId, error: error instanceof Error ? error.message : 'Unknown failure', officeObserved: [...seen] });
  process.exitCode = 1;
} finally {
  await context.close(); await browser.close();
}
