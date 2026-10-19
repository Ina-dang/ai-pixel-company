import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { WorkflowRun, SubscriptionState } from '../packages/agents/src/types.js';

// Opt-in only: uses the existing subscription and a real browser/API/SSE path.
// Default tests never call the model. Result acceptance remains with the Owner.
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/playwright');
const { chromium, expect } = await import('@playwright/test');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const pageErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.message));
let csrf = '', runId: string | null = null;
let passed = false;
async function api<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await page.request.fetch(`/api/v1${path}`, { method, headers: {
    Origin: 'http://127.0.0.1:3000', 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID(),
  }, ...(body ? { data: body } : {}) });
  const result = await response.json();
  assert(response.ok(), `Live office API ${path}: HTTP ${response.status()} ${result.error?.code ?? ''}`);
  return result.data;
}
try {
  await page.goto('/');
  await page.getByLabel('Owner 비밀키', { exact: true }).fill(readFileSync(resolve('.local/owner-key'), 'utf8').trim());
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  csrf = (await api<{ csrfToken: string }>('/me')).csrfToken;
  const subscription = await api<SubscriptionState>('/subscription');
  assert(subscription.ready, `Subscription blocked: ${subscription.reason}`);
  const project = await api<{ id: string; name: string }>('/projects', { name: `실시간 사무실 검증 ${randomUUID().slice(0, 8)}`, repositoryUrl: 'https://github.com/Ina-dang/ai-pixel-company.git', defaultBranch: 'main' });
  const task = await api<{ id: string }>(`/projects/${project.id}/tasks`, { title: '픽셀 사무실 실제 PM·개발·QA 연동',
    commandOriginalKo: '덧셈 add와 배열 합계 sum의 오류를 고치고 음수·빈 배열까지 테스트해 주세요. 실제 테스트·빌드 근거를 QA가 검토해 주세요.',
    acceptanceCriteria: [{ id: 'AC-1', descriptionKo: '덧셈·음수·합계·빈 배열이 정확하고 테스트와 빌드가 성공한다.', method: 'unit-test', required: true }], priority: 'MEDIUM' });
  await page.reload();
  await page.getByLabel('현재 프로젝트', { exact: true }).selectOption(project.id);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  await expect(office).toHaveAttribute('data-office-state', 'ready', { timeout: 20000 });
  const run = await api<WorkflowRun>(`/tasks/${task.id}/runs`, { fixture: 'node-functions-v1' });
  runId = run.id;
  console.log(JSON.stringify({ projectId: project.id, projectName: project.name, taskId: task.id, runId, authMode: subscription.authMode }));
  const seen = new Set<string>();
  let final: WorkflowRun | null = null, previous = '';
  const deadline = Date.now() + 900_000;
  let nextRead = 0;
  while (Date.now() < deadline) {
    const visible = await office.locator('[data-office-agent]').evaluateAll(nodes => nodes.map(node => ({ role: node.getAttribute('data-office-agent'), state: node.getAttribute('data-agent-state'), stage: node.getAttribute('data-run-stage'), runId: node.getAttribute('data-run-id') })));
    for (const employee of visible) if (employee.runId === runId) seen.add(`${employee.role}:${employee.state}:${employee.stage}`);
    if (Date.now() >= nextRead) {
      const current = await api<WorkflowRun>(`/runs/${runId}`);
      const marker = `${current.status}:${current.checkpoint.stage}`;
      if (marker !== previous) { console.log(JSON.stringify({ state: marker, officeObserved: [...seen] })); previous = marker; }
      if (['WAITING_APPROVAL', 'SUCCEEDED', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(current.status)) { final = current; break; }
      nextRead = Date.now() + 600;
    }
    await sleep(150);
  }
  assert(final, 'Live office execution timed out');
  assert.equal(final.status, 'WAITING_APPROVAL', `Live run blocked: ${final.checkpoint.stopReason}`);
  for (const key of ['PM:RUNNING:PM', 'DEVELOPER:RUNNING:DEVELOPER', 'QA:REVIEWING:QA']) assert(seen.has(key), `Live browser did not observe ${key}`);
  await expect(office.locator('[data-office-agent="PM"]')).toHaveAttribute('data-agent-state', 'WAITING', { timeout: 10000 });
  assert.equal(final.checkpoint.verification?.test.exitCode, 0); assert.equal(final.checkpoint.verification?.build.exitCode, 0);
  const qa = final.checkpoint.roles.filter(role => role.role === 'QA').at(-1);
  assert.equal(qa?.output.verdict, 'PASS'); assert.equal(qa.candidateSha, final.checkpoint.verification.sha);
  await page.reload();
  await page.getByLabel('현재 프로젝트', { exact: true }).selectOption(project.id);
  await expect(office).toHaveAttribute('data-office-state', 'ready');
  await expect(office.locator('[data-office-agent="PM"]')).toHaveAttribute('data-run-id', runId);
  await expect(office.locator('[data-office-agent="PM"]')).toHaveAttribute('data-agent-state', 'WAITING');
  mkdirSync(resolve('test-results'), { recursive: true });
  await office.screenshot({ path: resolve('test-results/office-live-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await office.getByRole('button', { name: 'QA 직원 상세', exact: true }).click();
  await expect(office.getByRole('heading', { name: 'QA 직원 상세', exact: true })).toBeVisible();
  await expect(office).toContainText(qa.candidateSha);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Mobile horizontal overflow');
  await office.screenshot({ path: resolve('test-results/office-live-mobile.png') });
  assert.deepEqual(pageErrors, []);
  passed = true;
  console.log(JSON.stringify({ verified: true, runId, candidateSha: qa.candidateSha, liveOfficeStates: [...seen], test: 0, build: 0, qa: 'PASS', reload: true, mobile: 390, pageErrors: 0, ownerAcceptance: 'PENDING' }));
} catch (error) {
  const owner = readFileSync(resolve('.local/owner-key'), 'utf8').trim();
  const message = (error instanceof Error ? error.message : String(error)).replaceAll(owner, '[REDACTED]')
    .replace(/pixel_(session|csrf)=[^;\s]+/g, 'pixel_$1=[REDACTED]')
    .replace(/(x-csrf-token|cookie):[^\r\n]+/gi, '$1: [REDACTED]');
  console.log(JSON.stringify({ verified: false, runId, error: message.slice(0, 4000), observedPageErrors: pageErrors }));
  process.exitCode = 1;
} finally {
  if (!passed && runId) {
    try {
      const current = await api<WorkflowRun>(`/runs/${runId}`);
      if (['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED'].includes(current.status)) await api(`/runs/${runId}/control`, { action: 'cancel', expectedVersion: current.version });
    } catch { /* Worker still enforces its independent time/turn/quota limits. */ }
  }
  if (csrf) await api('/auth/session', {}, 'DELETE').catch(() => undefined);
  await context.close(); await browser.close();
}
