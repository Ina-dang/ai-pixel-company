import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { OfficeAgent } from '../../packages/contracts/src/index';

const projectId = '55555555-4444-4555-8666-777777777777';
const secondProjectId = '66666666-4444-4555-8666-777777777777';
const taskId = '77777777-3333-4444-8555-666666666666';
const runId = '88888888-5555-4666-8777-888888888888';
const now = '2026-10-19T01:00:00.000Z';
const sha = 'c'.repeat(64);
const task = { id: taskId, projectId, title: '직원 연동 검증 업무', commandOriginalKo: '함수 수정과 테스트를 수행해 주세요.', status: 'IN_PROGRESS',
  statusLabelKo: '진행 중', priority: 'MEDIUM', version: 3, createdAt: now, updatedAt: now,
  acceptanceCriteria: [{ id: 'AC-1', descriptionKo: '함수와 테스트를 검증한다', method: 'unit-test', required: true }] };

type MockStream = EventTarget & {
  url: string; readyState: number; closed: boolean;
  onopen: ((event: Event) => unknown) | null; onmessage: ((event: MessageEvent) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
};
type StreamWindow = Window & { __officeStreams: MockStream[] };

async function installEventSource(page: Page) {
  await page.addInitScript(() => {
    const streams: EventSource[] = [];
    class OfficeTestSource extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
      CONNECTING = 0; OPEN = 1; CLOSED = 2;
      readyState = 1; closed = false; withCredentials = false;
      onopen: ((event: Event) => unknown) | null = null;
      onmessage: ((event: MessageEvent) => unknown) | null = null;
      onerror: ((event: Event) => unknown) | null = null;
      constructor(public url: string) {
        super(); streams.push(this as unknown as EventSource);
        queueMicrotask(() => { if (!this.closed) this.onopen?.(new Event('open')); });
      }
      close() { this.closed = true; this.readyState = 2; }
    }
    Object.assign(window, { EventSource: OfficeTestSource, __officeStreams: streams });
  });
}

async function officeEvent(page: Page, type: string, data: unknown, sequence: string, project = projectId) {
  await page.evaluate(({ type, data, sequence, project }) => {
    const streams = (window as unknown as StreamWindow).__officeStreams;
    for (const stream of streams.filter(entry => !entry.closed && entry.url.includes(project))) {
      const message = new MessageEvent(type, { data: JSON.stringify(data), lastEventId: sequence });
      stream.dispatchEvent(message);
      if (type === 'message') stream.onmessage?.(message);
    }
  }, { type, data, sequence, project });
}

async function loginOffice(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('region', { name: '픽셀 사무실', exact: true }).getByRole('heading', { name: /^픽셀 사무실/ })).toBeVisible();
}

const pageErrors = new WeakMap<Page, string[]>();
let authCookies: Parameters<BrowserContext['addCookies']>[0] = [];
test.beforeAll(async ({ browser }) => {
  const base = process.env.UI_BASE_URL ?? 'http://127.0.0.1:3000';
  const context = await browser.newContext();
  try {
    const secret = process.env.E2E_OWNER_SECRET ?? readFileSync(resolve('.local/owner-key'), 'utf8').trim();
    const response = await context.request.post(`${base}/api/v1/auth/session`, { data: { secret }, headers: { Origin: base } });
    expect(response.status(), 'Office browser tests require a real authenticated session.').toBe(200);
    authCookies = await context.cookies();
  } finally { await context.close(); }
});
test.beforeEach(async ({ context, page }) => {
  await context.addCookies(authCookies);
  const errors: string[] = []; pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

function employee(role: OfficeAgent['role'], change: Partial<OfficeAgent> = {}): OfficeAgent {
  return { id: role, role, nameKo: role === 'DEVELOPER' ? 'Developer' : role, state: 'IDLE', activityKo: '대기 중', location: 'lounge',
    taskId: null, taskTitle: null, taskStatus: null, runId: null, runStatus: null, stage: null, blockedReason: null,
    version: 1, evidenceSha: null, lastCompletedAt: null, usage: null, activeAssignments: 0, ...change };
}
function assigned(role: OfficeAgent['role'], version: number, change: Partial<OfficeAgent> = {}): OfficeAgent {
  return employee(role, { state: role === 'QA' ? 'REVIEWING' : 'RUNNING', activityKo: `${role} 작업 중`,
    location: role === 'PM' ? 'pmDesk' : role === 'DEVELOPER' ? 'developerDesk' : 'qaDesk', taskId, taskTitle: task.title,
    taskStatus: 'IN_PROGRESS', runId, runStatus: 'RUNNING', stage: role, version, evidenceSha: sha,
    usage: { inputTokens: 1234, cachedInputTokens: 200, outputTokens: 321 }, activeAssignments: 1, ...change });
}
function snapshot(agents: OfficeAgent[], cursor = '10', currentProject = projectId) {
  const bound = agents.find(agent => agent.taskId === taskId);
  const status = bound?.taskStatus ?? task.status;
  const labels: Record<string, string> = { TODO: '할 일', PLANNING: '계획 중', IN_PROGRESS: '진행 중', REVIEW: '검토 중', APPROVAL_REQUIRED: '승인 대기', COMPLETED: '완료', FAILED: '실패', CANCELLED: '취소' };
  return { projectId: currentProject, cursor, syncedAt: now, tasks: currentProject === projectId ? [{ ...task, status, statusLabelKo: labels[status] ?? status }] : [], agents, approvals: [] };
}
function event(sequence: string, version = Number(sequence), project = projectId) {
  return { schemaVersion: 1, eventId: `99999999-0000-4000-8000-${sequence.padStart(12, '0')}`, organizationId: '11111111-1111-4111-8111-111111111111',
    projectId: project, runId, taskId, agentId: null, sequence, timestamp: now, type: 'workflow.run.updated', aggregateVersion: version,
    payload: { runId, status: 'RUNNING', stage: 'QA' } };
}
async function mockOffice(page: Page, agents: OfficeAgent[]) {
  await installEventSource(page);
  const state = { current: snapshot(agents), second: snapshot(['PM', 'DEVELOPER', 'QA'].map(role => employee(role as OfficeAgent['role'])), '0', secondProjectId), snapshotRequests: 0, snapshotFailures: 0, mutations: [] as string[] };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) state.mutations.push(path);
    const fulfill = (data: unknown, pagination?: unknown) => route.fulfill({ json: { data, ...(pagination ? { pagination } : {}) } });
    if (path === '/subscription') return fulfill({ ready: false, reason: 'BROWSER_TEST_NO_MODEL', authMode: 'chatgpt', billingMode: 'CHATGPT_SUBSCRIPTION', windows: [], checkedAt: now });
    if (path === '/projects') return fulfill([{ id: projectId, name: '픽셀 사무실 검증', repositoryUrl: 'https://github.com/Ina-dang/ai-pixel-company.git', defaultBranch: 'main', version: 1 },
      { id: secondProjectId, name: '두 번째 사무실', repositoryUrl: 'https://github.com/Ina-dang/ai-pixel-company.git', defaultBranch: 'main', version: 1 }], { nextCursor: null });
    if (path === `/projects/${projectId}/snapshot`) {
      state.snapshotRequests += 1;
      if (state.snapshotFailures > 0) { state.snapshotFailures -= 1; return route.fulfill({ status: 503, json: { error: { messageKo: '스냅샷을 일시적으로 읽을 수 없습니다.' } } }); }
      return fulfill(state.current);
    }
    if (path === `/projects/${secondProjectId}/snapshot`) return fulfill(state.second);
    if (path === `/tasks/${taskId}`) return fulfill({ ...task, events: [] });
    if (path === `/tasks/${taskId}/runs`) return fulfill({ items: [] });
    return route.continue();
  });
  return state;
}

test('server snapshots drive PM, Developer, QA verification, approval and completion', async ({ page }) => {
  const state = await mockOffice(page, [assigned('PM', 10, { activityKo: 'PM 계획 수립 중' }), employee('DEVELOPER'), employee('QA')]);
  await loginOffice(page);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  await expect(office.getByText('PM 계획 수립 중', { exact: true })).toBeVisible();
  state.current = snapshot([employee('PM'), assigned('DEVELOPER', 11, { activityKo: 'Developer 코드 수정 중' }), employee('QA')], '11');
  await officeEvent(page, 'workflow.run.updated', event('11'), '11');
  await expect(office.getByText('Developer 코드 수정 중', { exact: true })).toBeVisible();
  state.current = snapshot([employee('PM'), employee('DEVELOPER'), assigned('QA', 12, { stage: 'VERIFY', activityKo: '샌드박스 테스트 검증 중' })], '12');
  await officeEvent(page, 'workflow.run.updated', event('12'), '12');
  await expect(office.getByText('샌드박스 테스트 검증 중', { exact: true })).toBeVisible();
  state.current = snapshot([employee('PM'), employee('DEVELOPER'), assigned('QA', 13, { stage: 'QA', activityKo: 'QA 근거 검토 중' })], '13');
  await officeEvent(page, 'workflow.run.updated', event('13'), '13');
  await expect(office.getByText('QA 근거 검토 중', { exact: true })).toBeVisible();
  state.current = snapshot([employee('PM'), assigned('DEVELOPER', 14, { state: 'BLOCKED', runStatus: 'BLOCKED', blockedReason: 'QUOTA_EXHAUSTED', activityKo: '구독 한도로 진행 불가' }), employee('QA')], '14');
  await officeEvent(page, 'workflow.run.updated', event('14'), '14');
  await expect(office.getByText('구독 한도로 진행 불가', { exact: true })).toBeVisible();
  state.current = snapshot([employee('PM'), employee('DEVELOPER'), assigned('QA', 15, { state: 'ERROR', runStatus: 'FAILED', taskStatus: 'FAILED', activityKo: '검증 오류 발생' })], '15');
  await officeEvent(page, 'workflow.run.updated', event('15'), '15');
  await expect(office.getByText('검증 오류 발생', { exact: true })).toBeVisible();
  state.current = snapshot([assigned('PM', 16, { state: 'WAITING', location: 'owner', runStatus: 'WAITING_APPROVAL', taskStatus: 'APPROVAL_REQUIRED', activityKo: '결과 수락을 기다리고 있어요' }), employee('DEVELOPER'), employee('QA')], '16');
  await officeEvent(page, 'approval.requested', { ...event('16'), type: 'approval.requested' }, '16');
  await expect(office.getByText('결과 수락을 기다리고 있어요', { exact: true })).toBeVisible();
  state.current = snapshot([assigned('PM', 17, { state: 'IDLE', location: 'lounge', runStatus: 'SUCCEEDED', taskStatus: 'COMPLETED', activeAssignments: 0, lastCompletedAt: now, activityKo: '업무를 완료했어요' }), employee('DEVELOPER'), employee('QA')], '17');
  await officeEvent(page, 'task.status.changed', { ...event('17'), type: 'task.status.changed', payload: { status: 'COMPLETED' } }, '17');
  await expect(office.getByText('업무를 완료했어요', { exact: true })).toBeVisible();
  await page.reload();
  await expect(office.getByText('업무를 완료했어요', { exact: true })).toBeVisible();
});

test('three staff coexist; keyboard details preserve escaped text and mobile task navigation', async ({ page }) => {
  const hostile = '<script>window.officeInjected = true</script>';
  await mockOffice(page, [assigned('PM', 10), assigned('DEVELOPER', 10, { taskTitle: hostile }), assigned('QA', 10)]);
  await loginOffice(page);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  for (const role of ['PM', 'Developer', 'QA']) await expect(office.getByRole('button', { name: `${role} 직원 상세`, exact: true })).toBeVisible();
  const developer = office.getByRole('button', { name: 'Developer 직원 상세', exact: true });
  await developer.focus(); await page.keyboard.press('Enter');
  await expect(office.getByText(hostile, { exact: true })).toBeVisible();
  await expect(office.getByText(sha, { exact: true })).toBeVisible();
  await expect(office.getByText(runId, { exact: false })).toBeVisible();
  await expect(office.getByText('1,234', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => 'officeInjected' in window)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await office.getByRole('button', { name: '업무 상세 열기', exact: true }).click();
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
});

test('visual pilot keeps selected speech tied to server state, motion preference and local license notice', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await mockOffice(page, [assigned('PM', 10, { state: 'WAITING', runStatus: 'WAITING_APPROVAL', activityKo: '실제 검증 결과의 Owner 수락을 기다립니다' }), assigned('DEVELOPER', 10), assigned('QA', 10)]);
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  await loginOffice(page);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  await expect(office).toHaveAttribute('data-office-state', 'ready');
  await expect(office.locator('[data-office-style="visual-pilot-v1"] canvas')).toHaveCount(1);
  const speech = office.getByRole('note', { name: '선택 직원 현재 활동', exact: true });
  await expect(speech).toContainText('실제 검증 결과의 Owner 수락을 기다립니다');
  await office.getByRole('button', { name: 'QA 직원 상세', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(speech).toContainText('QA 작업 중');
  await expect(speech).not.toContainText('수락 완료');
  const notice = await page.request.get('/office-licenses.txt'); expect(notice.ok()).toBe(true);
  expect(await notice.text()).toContain('Copyright (c) 2026 Pablo De Lucca');
  expect(await notice.text()).toContain('b1bafd02896d90d83457266575a1e8e5011ce997');
  await expect(office.getByRole('link', { name: '오픈소스 고지', exact: true })).toHaveAttribute('href', '/office-licenses.txt');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(speech).toBeVisible(); expect(pageErrors).toEqual([]); expect(state.mutations).toEqual([]);
});

test('map failure preserves DOM staff details and graphics toggle tears down one canvas', async ({ page }) => {
  const state = await mockOffice(page, [assigned('PM', 10), assigned('DEVELOPER', 10), assigned('QA', 10)]);
  await page.route('**/office-map.json', route => route.abort('failed'));
  await loginOffice(page);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  await expect(office).toHaveAttribute('data-office-state', 'fallback');
  await office.getByRole('button', { name: 'QA 직원 상세', exact: true }).click();
  await expect(office.getByText(sha, { exact: true })).toBeVisible();
  await office.getByRole('button', { name: '그래픽 끄기', exact: true }).click();
  await expect(office.locator('canvas')).toHaveCount(0);
  await expect(office).toHaveAttribute('data-office-state', 'off');
  await page.unroute('**/office-map.json');
  await office.getByRole('button', { name: '그래픽 켜기', exact: true }).click();
  await expect(office).toHaveAttribute('data-office-state', 'ready');
  await expect(office.locator('canvas')).toHaveCount(1);
  for (let repeat = 0; repeat < 2; repeat += 1) {
    await office.getByRole('button', { name: '그래픽 끄기', exact: true }).click();
    await expect(office.locator('canvas')).toHaveCount(0);
    await office.getByRole('button', { name: '그래픽 켜기', exact: true }).click();
    await expect(office.locator('canvas')).toHaveCount(1);
  }
  expect(state.mutations).toEqual([]);
});

test('duplicate and stale snapshots do not regress; project switch closes the prior stream', async ({ page }) => {
  const state = await mockOffice(page, [employee('PM'), employee('DEVELOPER'), assigned('QA', 30, { activityKo: '최신 QA 검토 중' })]);
  state.current = { ...state.current, cursor: '30' };
  await loginOffice(page);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  await expect(office.getByText('최신 QA 검토 중', { exact: true })).toBeVisible();
  state.current = snapshot([assigned('PM', 20, { activityKo: '오래된 PM 작업' }), employee('DEVELOPER'), employee('QA')], '20');
  await officeEvent(page, 'workflow.run.updated', event('20'), '20');
  await officeEvent(page, 'workflow.run.updated', event('20'), '20');
  await Promise.all([
    page.waitForResponse(response => response.url().includes(`/projects/${projectId}/snapshot`)),
    officeEvent(page, 'workflow.run.updated', event('31'), '31'),
  ]);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(office.getByText('최신 QA 검토 중', { exact: true })).toBeVisible();
  await expect(office.getByText('오래된 PM 작업', { exact: true })).toHaveCount(0);
  await page.getByLabel('현재 프로젝트', { exact: true }).selectOption(secondProjectId);
  await expect(office.getByText('최신 QA 검토 중', { exact: true })).toHaveCount(0);
  await expect(office.getByRole('button', { name: 'PM 직원 상세', exact: true })).toBeVisible();
  const oldClosed = await page.evaluate(project => (window as unknown as StreamWindow).__officeStreams.filter(stream => stream.url.includes(project)).every(stream => stream.closed), projectId);
  expect(oldClosed).toBe(true);
  await officeEvent(page, 'workflow.run.updated', event('31'), '31');
  await expect(office.getByText('최신 QA 검토 중', { exact: true })).toHaveCount(0);
});

test('disconnect shows stale state and retained last sync time; reconnect refreshes snapshot', async ({ page }) => {
  const state = await mockOffice(page, [assigned('PM', 10), employee('DEVELOPER'), employee('QA')]);
  await loginOffice(page);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  await expect(office.locator('.office-sync small')).toContainText('마지막 확인');
  await page.evaluate(() => {
    for (const stream of (window as unknown as StreamWindow).__officeStreams.filter(entry => !entry.closed)) {
      stream.readyState = 0; stream.onerror?.(new Event('error'));
    }
  });
  await expect(office.getByText('연결 복구 중', { exact: false })).toBeVisible();
  await expect(office.locator('.office-sync small')).toContainText('마지막 확인');
  state.current = snapshot([employee('PM'), assigned('DEVELOPER', 11, { activityKo: '재연결 후 수정 중' }), employee('QA')], '11');
  await page.evaluate(() => {
    for (const stream of (window as unknown as StreamWindow).__officeStreams.filter(entry => !entry.closed)) {
      stream.readyState = 1; stream.onopen?.(new Event('open'));
    }
  });
  await expect(office.getByText('재연결 후 수정 중', { exact: true })).toBeVisible();
});

test('initial snapshot failure recovers live SSE when the visible tab refreshes', async ({ page }) => {
  const state = await mockOffice(page, [assigned('PM', 10, { activityKo: '복구된 PM 작업' }), employee('DEVELOPER'), employee('QA')]);
  state.snapshotFailures = 1;
  const failed = page.waitForResponse(response => response.url().includes(`/projects/${projectId}/snapshot`) && response.status() === 503);
  await loginOffice(page);
  await failed;
  await expect(page.getByRole('alert').filter({ hasText: '스냅샷을 일시적으로 읽을 수 없습니다.' }).first()).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => page.evaluate(() => (window as unknown as StreamWindow).__officeStreams.filter(stream => !stream.closed).length)).toBe(1);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  await expect(office.getByText('복구된 PM 작업', { exact: true })).toBeVisible();
  await expect(office.getByText('실제 서버 상태와 연결됨', { exact: true })).toBeVisible();
});

test('revoked SSE session clears office details and destroys its canvas', async ({ page }) => {
  const state = await mockOffice(page, [assigned('PM', 10), assigned('DEVELOPER', 10), assigned('QA', 10)]);
  await loginOffice(page);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  await expect(office).toHaveAttribute('data-office-state', 'ready');
  await expect(office.locator('canvas')).toHaveCount(1);
  await officeEvent(page, 'stream.auth-error', { reason: 'SESSION_REVOKED' }, '41');
  await expect(page.getByLabel('Owner 비밀키', { exact: true })).toBeVisible();
  await expect(office).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as StreamWindow).__officeStreams.every(stream => stream.closed))).toBe(true);
  expect(state.mutations).toEqual([]);
});
