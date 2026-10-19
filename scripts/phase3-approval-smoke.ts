import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Live read-only remote preflight. Creates a local approval request; NEVER approves or executes a merge.
const projectId = process.argv[2], runId = process.argv[3];
assert(projectId && runId && /^[a-f0-9-]{36}$/.test(projectId) && /^[a-f0-9-]{36}$/.test(runId));
const origin = 'http://127.0.0.1:3000';
const login = await fetch(`${origin}/api/v1/auth/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: readFileSync('.local/owner-key', 'utf8').trim() }) });
assert(login.ok); const session = (await login.json()).data, cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
async function api(path: string, body?: unknown) {
  assert(!/\/(approve|execute|revoke)$/.test(path), 'This live verifier cannot authorize or execute merge');
  const response = await fetch(`${origin}/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert(response.ok, `${response.status}: ${result.error?.code ?? 'unknown'}`); return result.data;
}
const before = await api(`/projects/${projectId}/snapshot`);
const agent = before.agents.find((value: { runId: string }) => value.runId === runId); assert(agent);
const runs = await api(`/tasks/${agent.taskId}/runs`), run = runs.items.find((value: { id: string }) => value.id === runId); assert(run);
const connections = await api(`/projects/${projectId}/integrations`);
const github = connections.connections.find((value: { provider: string }) => value.provider === 'GITHUB');
assert.equal(github.publicConfig.repository, 'Ina-dang/ai-pixel-company-integration-tests'); assert.equal(github.publicConfig.baseBranch, 'fixture-base');
const operation = await api(`/projects/${projectId}/integrations/operations`, { kind: 'MERGE_REQUEST', runId, expectedRunVersion: run.version });
let state: typeof connections = connections, result: { id: string; status: string; externalRef: { requestId: string }; errorCode: string } | undefined;
for (let attempt = 0; attempt < 40; attempt++) {
  state = await api(`/projects/${projectId}/integrations`); result = state.operations.find((value: { id: string }) => value.id === operation.id);
  if (result && !['PENDING','RUNNING','DEFERRED'].includes(result.status)) break;
  await sleep(1000);
}
assert.equal(result?.status, 'SUCCEEDED', `Approval scope preparation failed: ${result?.errorCode}`);
const request = state.mergeRequests.find((value: { id: string }) => value.id === result?.externalRef.requestId); assert(request);
assert.equal(request.status, 'REQUESTED'); assert.equal(request.approvedBy, null);
const validation = await api(`/projects/${projectId}/integrations/merges/${request.id}/validate`, { expectedVersion: request.version, scopeHash: request.scopeHash });
assert.equal(validation.remoteMergeExecuted, false);
const after = await api(`/projects/${projectId}/snapshot`); assert(BigInt(after.cursor) >= BigInt(before.cursor));
const unchangedRun = (await api(`/tasks/${agent.taskId}/runs`)).items.find((value: { id: string }) => value.id === runId);
assert.equal(unchangedRun.status, run.status); assert.equal(unchangedRun.version, run.version);

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.local/playwright');
const { chromium, expect } = await import('@playwright/test');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage(), errors: string[] = [], forbidden: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', value => { if (/\/(approve|execute|revoke)$/.test(new URL(value.url()).pathname)) forbidden.push(value.url()); });
  await page.goto('/'); await page.getByLabel('Owner 비밀키', { exact: true }).fill(readFileSync('.local/owner-key','utf8').trim()); await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByLabel('현재 프로젝트', { exact: true }).selectOption(projectId);
  const area = page.getByRole('region', { name: '업무와 협업 관리', exact: true }); await area.getByRole('tab', { name: '연동 현황', exact: true }).click();
  const card = area.locator(`[data-merge-request="${request.id}"]`);
  await expect(card).toBeVisible(); await expect(card.getByRole('button', { name: '이 범위의 merge 승인', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'merge 범위 재검증', exact: true }).click();
  await expect(card.getByRole('button', { name: 'merge 범위 재검증', exact: true })).toBeEnabled({ timeout: 30000 });
  if (!validation.ready) await expect(card.getByRole('status')).toContainText('로컬 결과 수락이 필요합니다.');
  if (!validation.ready) { await expect(card.getByRole('checkbox')).toBeDisabled(); await expect(card.getByRole('button', { name: '이 범위의 merge 승인', exact: true })).toBeDisabled(); }
  mkdirSync('test-results', { recursive: true }); await card.screenshot({ path: 'test-results/phase3-merge-preview-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await card.screenshot({ path: 'test-results/phase3-merge-preview-mobile.png' });
  assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
  console.log(JSON.stringify({ projectId, runId, requestId: request.id, scopeHash: request.scopeHash, headSha: request.scope.headSha, baseSha: request.scope.baseSha,
    ready: validation.ready, blockers: validation.blockers, remoteMergeExecuted: false, runStatusUnchanged: run.status, pageErrors: errors.length, approvalOrExecutionRequests: forbidden.length,
    screenshots: ['test-results/phase3-merge-preview-desktop.png','test-results/phase3-merge-preview-mobile.png'] }));
  await context.close();
} finally { await browser.close(); }
