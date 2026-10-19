import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { RoleEvidence, SubscriptionState, WorkflowRun } from '../../apps/web/app/ui/api';

const taskId = '22222222-3333-4444-8555-666666666666';
const projectId = '33333333-4444-4555-8666-777777777777';
const runId = '44444444-5555-4666-8777-888888888888';
const now = '2026-10-19T00:00:00.000Z';
const sha = 'a'.repeat(40);
const task = { id: taskId, projectId, title: '격리 함수 검증', commandOriginalKo: '덧셈 함수를 구현하고 테스트해 주세요.',
  status: 'TODO', statusLabelKo: '대기', priority: 'MEDIUM', version: 1, createdAt: now, updatedAt: now,
  acceptanceCriteria: [{ id: 'AC-1', descriptionKo: '덧셈 테스트를 통과한다', method: 'test', required: true }] };

function run(status: WorkflowRun['status']): WorkflowRun {
  return { id: runId, taskId, status, version: 2, createdAt: now, updatedAt: now,
    checkpoint: { stage: 'PM', rework: 0, turns: 0, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      stopReason: null, activeTurnId: null, activeThreadId: null, roles: [], workspace: null, verification: null } };
}

function role(roleName: RoleEvidence['role']): RoleEvidence {
  return { role: roleName, threadId: `thread-${roleName}`, turnId: `turn-${roleName}`, candidateSha: sha, completedAt: now,
    usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 30 }, output: { summaryKo: `${roleName} 실제 결과 기록`,
      specEn: 'Implement the add function and pass AC-1.', acceptanceCriteria: [{ id: 'AC-1', description: 'Addition passes' }],
      files: roleName === 'DEVELOPER' ? [{ path: 'src/index.js', content: 'export const add = (a, b) => a + b;' }] : [],
      verdict: roleName === 'QA' ? 'PASS' : 'NA', candidateSha: sha, issues: [] } };
}

async function mockWorkflow(page: Page, initial: WorkflowRun | null, ready = true) {
  const state = { current: initial, subscription: { ready, reason: ready ? null : 'QUOTA_EXHAUSTED', authMode: 'chatgpt',
    billingMode: 'CHATGPT_SUBSCRIPTION', windows: [{ usedPercent: ready ? 20 : 100, resetsAt: 1792458000, windowDurationMins: 300 }], checkedAt: now } as SubscriptionState,
    requests: [] as { path: string; body: Record<string, unknown>; csrf: string | undefined; key: string | undefined }[], failNext: false };
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const fulfill = (data: unknown, pagination?: unknown) => route.fulfill({ json: { data, ...(pagination ? { pagination } : {}) } });
    if (path === '/subscription') return fulfill(state.subscription);
    if (path === '/projects') return fulfill([{ id: projectId, name: '브라우저 실행 검증', repositoryUrl: 'https://github.com/Ina-dang/ai-pixel-company.git', defaultBranch: 'main', version: 1 }], { nextCursor: null });
    if (path === `/projects/${projectId}/snapshot`) return fulfill({ projectId, cursor: '0', tasks: [task], agents: [], approvals: [] });
    if (path === `/tasks/${taskId}`) return fulfill({ ...task, events: [] });
    if (path === '/events/stream') return route.fulfill({ contentType: 'text/event-stream', body: ': test fixture\n\n' });
    if (request.method() === 'GET' && path === `/tasks/${taskId}/runs`) return fulfill({ items: state.current ? [state.current] : [] });
    if (request.method() === 'POST' && (path.includes('/runs') || path.startsWith('/runs/'))) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.requests.push({ path, body, csrf: request.headers()['x-csrf-token'], key: request.headers()['idempotency-key'] });
      if (state.failNext) { state.failNext = false; return route.fulfill({ status: 409, json: { error: { messageKo: '실행 버전이 변경되었습니다.' } } }); }
      if (path.endsWith('/accept')) state.current = { ...state.current ?? run('WAITING_APPROVAL'), status: 'SUCCEEDED', version: 3 };
      else if (path.endsWith('/control')) state.current = { ...state.current ?? run('QUEUED'), status: body.action === 'cancel' ? 'CANCELLED' : body.action === 'pause' ? 'PAUSED' : 'QUEUED', version: (state.current?.version ?? 1) + 1 };
      else state.current = run('QUEUED');
      return fulfill(state.current);
    }
    return route.continue();
  });
  return state;
}

async function loginAndSelect(page: Page) {
  await page.goto('/');
  const key = process.env.E2E_OWNER_SECRET ?? readFileSync(resolve('.local/owner-key'), 'utf8').trim();
  await page.getByLabel('Owner 비밀키', { exact: true }).fill(key);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('button', { name: `업무 상세: ${task.title}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI 직원 실행', exact: true })).toBeVisible();
}

test('quota blocks launches and requires explicit resume after reset', async ({ page }) => {
  const blocked = run('BLOCKED'); blocked.checkpoint.stopReason = 'QUOTA_EXHAUSTED';
  const state = await mockWorkflow(page, blocked, false);
  await loginAndSelect(page);
  await expect(page.getByRole('button', { name: '실행 재개', exact: true })).toBeDisabled();
  await expect(page.getByText('중단 사유: QUOTA_EXHAUSTED', { exact: false }).first()).toBeVisible();
  state.subscription = { ...state.subscription, ready: true, reason: null, windows: [{ usedPercent: 10, resetsAt: null, windowDurationMins: 300 }] };
  await page.getByRole('button', { name: '한도 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '실행 재개', exact: true })).toBeEnabled();
  await page.waitForTimeout(2800);
  expect(state.requests).toEqual([]);
  await page.getByRole('button', { name: '실행 재개', exact: true }).click();
  await expect(page.getByText('실행: 실행 대기', { exact: true })).toBeVisible();
  expect(state.requests[0]?.body).toEqual({ action: 'resume', expectedVersion: 2 });
  expect(state.requests[0]?.csrf).toBeTruthy(); expect(state.requests[0]?.key).toBeTruthy();
});

test('bounded launch, pause, cancel and API failure are visible without model calls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const state = await mockWorkflow(page, null);
  await loginAndSelect(page);
  await page.getByRole('button', { name: '검증 업무 실행', exact: true }).click();
  await expect(page.getByText('실행: 실행 대기', { exact: true })).toBeVisible();
  expect(state.requests[0]?.body).toEqual({ fixture: 'node-functions-v1' });
  state.failNext = true;
  await page.getByRole('button', { name: '일시 정지 요청', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '실행 버전이 변경되었습니다.' }).first()).toBeVisible();
  await page.getByRole('button', { name: '일시 정지 요청', exact: true }).click();
  await expect(page.getByText('실행: 일시 정지', { exact: true })).toBeVisible();
  expect(state.requests[1]?.key).toBe(state.requests[2]?.key);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.getByText('실행: 취소됨', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('owner reviews escaped evidence and accepts exact tested QA SHA on mobile', async ({ page }) => {
  const pending = run('WAITING_APPROVAL');
  pending.checkpoint.stage = 'QA'; pending.checkpoint.roles = [role('PM'), role('DEVELOPER'), role('QA')];
  pending.checkpoint.turns = 3;
  pending.checkpoint.workspace = { sha, files: [{ path: 'src/index.js', content: 'export const add = (a, b) => a + b;' }], diff: '+ export const add = (a, b) => a + b;\n<script>throw new Error("unsafe")</script>' };
  pending.checkpoint.verification = { sha, test: { exitCode: 0, output: 'tests 4\npass 4\n<script>alert(1)</script>' }, build: { exitCode: 0, output: 'build succeeded' },
    sandbox: { networkDisabled: true, readOnlyRoot: true, resourceLimited: true }, verifiedAt: now };
  const state = await mockWorkflow(page, pending);
  await loginAndSelect(page);
  const accept = page.getByRole('button', { name: '표시한 SHA 결과 수락', exact: true });
  await expect(accept).toBeDisabled();
  await page.getByText('후보 diff 확인', { exact: true }).click();
  await expect(page.getByText('+ export const add = (a, b) => a + b;', { exact: false })).toBeVisible();
  await page.getByText('테스트 종료 코드: 0', { exact: true }).click();
  await expect(page.getByText('tests 4\npass 4\n<script>alert(1)</script>', { exact: true })).toBeVisible();
  await expect(page.locator('script').filter({ hasText: 'unsafe' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('checkbox', { name: `후보 SHA ${sha}의 결과를 확인했습니다.`, exact: true }).check();
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page.getByText('실행: 실행 성공', { exact: true })).toBeVisible();
  expect(state.requests.at(-1)?.body).toEqual({ candidateSha: sha, expectedVersion: 2 });
});

test('missing or stale verification keeps owner acceptance disabled', async ({ page }) => {
  const pending = run('WAITING_APPROVAL');
  pending.checkpoint.stage = 'QA'; pending.checkpoint.roles = [role('PM'), role('DEVELOPER'), role('QA')];
  pending.checkpoint.workspace = { sha, files: [{ path: 'src/index.js', content: 'export const add = (a, b) => a + b;' }], diff: '+ changed' };
  pending.checkpoint.verification = { sha: 'b'.repeat(40), test: { exitCode: 0, output: 'pass' }, build: { exitCode: 0, output: 'pass' },
    sandbox: { networkDisabled: true, readOnlyRoot: true, resourceLimited: true }, verifiedAt: now };
  const state = await mockWorkflow(page, pending);
  await loginAndSelect(page);
  await expect(page.getByRole('button', { name: '표시한 SHA 결과 수락', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await expect(page.getByText('동일 SHA의 테스트·빌드·QA PASS 근거가 부족하여 수락할 수 없습니다.', { exact: true })).toBeVisible();
  expect(state.requests).toEqual([]);
});
