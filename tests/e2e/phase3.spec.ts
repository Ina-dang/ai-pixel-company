import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Employee, IntegrationOperation, Integrations, MergeRequest, SlackCommandReceipt, StaffAssignment, StaffRole, StaffTemplate } from '../../apps/web/app/ui/collaboration-model';
import type { Task, WorkflowRun } from '../../apps/web/app/ui/api';
import type { OfficeAgent } from '../../packages/contracts/src/index';

const projectId = 'aaaaaaaa-4444-4555-8666-777777777777';
const employeeId = 'bbbbbbbb-4444-4555-8666-777777777777';
const runId = 'cccccccc-4444-4555-8666-777777777777';
const operationId = 'dddddddd-4444-4555-8666-777777777777';
const now = '2026-10-19T09:00:00.000Z';
const sha = 'd'.repeat(64);
const assignedDeveloperName = '별빛 개발자';
const officeAgents: OfficeAgent[] = (['PM', 'DEVELOPER', 'QA'] as StaffRole[]).map(role => ({ id: role, role,
  nameKo: role === 'DEVELOPER' ? assignedDeveloperName : `기본 ${role}`, state: 'IDLE', activityKo: '대기 중', location: 'lounge',
  taskId: null, taskTitle: null, taskStatus: null, runId: null, runStatus: null, stage: null, blockedReason: null,
  version: 1, evidenceSha: null, lastCompletedAt: null, usage: null, activeAssignments: 0 }));
const statuses = ['TODO', 'PLANNING', 'IN_PROGRESS', 'REVIEW', 'APPROVAL_REQUIRED', 'COMPLETED', 'FAILED', 'CANCELLED'];
const labels = ['할 일', '계획 중', '진행 중', '검토 중', '승인 대기', '완료', '실패', '취소'];
const tasks: Task[] = statuses.map((status, index) => ({ id: `eeeeeeee-4444-4555-8666-${String(index + 1).padStart(12, '0')}`, projectId,
  title: `상태별 검증 업무 ${index + 1}`, commandOriginalKo: '한국어 요청 원문', status, statusLabelKo: labels[index], priority: 'MEDIUM', version: 1,
  createdAt: now, updatedAt: now, acceptanceCriteria: [{ id: 'AC-1', descriptionKo: '검증 근거를 확인한다', method: 'manual', required: true }] }));
const templates: StaffTemplate[] = (['PM', 'DEVELOPER', 'QA'] as StaffRole[]).map(role => ({ role, nameKo: role, provider: 'CHATGPT_SUBSCRIPTION', model: 'codex-default',
  tools: role === 'PM' ? ['PLAN'] : role === 'DEVELOPER' ? ['EDIT_FILES'] : ['VERIFY', 'REVIEW'], limits: { maxTurns: 7, maxTokens: 500000, maxElapsedMs: 900000 }, avatar: role.toLowerCase() }));

let authCookies: Parameters<BrowserContext['addCookies']>[0] = [];
const errors = new WeakMap<Page, string[]>();
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const base = process.env.UI_BASE_URL ?? 'http://127.0.0.1:3000';
    const secret = process.env.E2E_OWNER_SECRET ?? readFileSync(resolve('.local/owner-key'), 'utf8').trim();
    const response = await context.request.post(`${base}/api/v1/auth/session`, { data: { secret }, headers: { Origin: base } });
    expect(response.status()).toBe(200); authCookies = await context.cookies();
  } finally { await context.close(); }
});
test.beforeEach(async ({ context, page }) => {
  await context.addCookies(authCookies);
  const found: string[] = []; errors.set(page, found); page.on('pageerror', error => found.push(error.message));
  await page.addInitScript(() => {
    class LocalEventSource extends EventTarget {
      readyState = 1; onopen: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: (() => void) | null = null;
      constructor() { super(); queueMicrotask(() => this.onopen?.()); }
      close() { this.readyState = 2; }
    }
    Object.assign(window, { EventSource: LocalEventSource });
  });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

function pendingRun(): WorkflowRun {
  return { id: runId, taskId: tasks[0].id, status: 'WAITING_APPROVAL', version: 7, createdAt: now, updatedAt: now,
    checkpoint: { stage: 'QA', rework: 0, turns: 3, usage: { inputTokens: 300, cachedInputTokens: 0, outputTokens: 90 }, roles: [],
      activeThreadId: null, activeTurnId: null, stopReason: null, workspace: { sha, files: [{ path: 'src/index.js', content: 'export const add = (a,b) => a+b;' }], diff: '+ add' }, verification: null } };
}
function unknownOperation(): IntegrationOperation {
  return { id: operationId, provider: 'GITHUB', kind: 'DRAFT_PR_CREATE', status: 'UNKNOWN', runId, candidateSha: sha, errorCode: 'REMOTE_RESULT_UNKNOWN',
    externalRef: null, attempts: 1, createdAt: now, updatedAt: now };
}
function mergeRequest(): MergeRequest {
  return { id: operationId, operationId, runId, scopeHash: 'a'.repeat(64), version: 1, status: 'REQUESTED', expiresAt: new Date(Date.now() + 600000).toISOString(), approvedBy: null, approvedAt: null, errorCode: null, result: null,
    scope: { installationId: 123, repositoryId: 456, base: 'main', branch: `ai-pixel/${runId}`, headSha: 'b'.repeat(40), baseSha: 'c'.repeat(40), candidateSha: sha, runVersion: 7, pullNumber: 2, mergeMethod: 'squash', policyVersion: 'v1', requiredChecks: ['unit'],
      remote: { draft: false, protected: false, protectionHash: 'e'.repeat(64), mergeable: true, mergeableState: 'clean', ci: { status: 'PASS' } } } };
}
async function mockCollaboration(page: Page, configured = false) {
  const state = { employees: [] as Employee[], profiles: [] as Employee['profile'][], assignments: [] as StaffAssignment[], operations: [] as IntegrationOperation[],
    requests: [] as { path: string; method: string; body: Record<string, unknown>; csrf?: string; key?: string }[], rejectOperation: false, rejectAssignment: false,
    mergeRequests: [] as MergeRequest[], commands: [] as SlackCommandReceipt[], mergeBlockers: [] as string[], rejectMerge: false };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', '');
    const fulfill = (data: unknown, pagination?: unknown) => route.fulfill({ json: { data, ...(pagination ? { pagination } : {}) } });
    if (request.method() === 'GET') {
      if (path === '/projects') return fulfill([{ id: projectId, name: '협업 검증 프로젝트', repositoryUrl: 'https://github.com/Ina-dang/ai-pixel-company.git', defaultBranch: 'main', version: 1 }], { nextCursor: null });
      if (path === `/projects/${projectId}/snapshot`) return fulfill({ projectId, cursor: '1', syncedAt: now, tasks, agents: officeAgents, approvals: [] });
      if (path === '/subscription') return fulfill({ ready: false, reason: 'BROWSER_TEST_NO_MODEL', authMode: 'chatgpt', billingMode: 'CHATGPT_SUBSCRIPTION', windows: [], checkedAt: now });
      if (path === '/employees/templates') return fulfill({ items: templates });
      if (path === '/employees') return fulfill({ items: state.employees });
      if (path === `/employees/${employeeId}`) return fulfill({ ...state.employees[0], profiles: state.profiles, employmentHistory: [] });
      if (path === `/projects/${projectId}/staffing`) return fulfill({ items: state.assignments.map(assignment => ({ ...assignment, profileVersion: state.employees.find(employee => employee.id === assignment.employeeId)?.currentProfileVersion ?? assignment.profileVersion })) });
      if (path === `/projects/${projectId}/integrations`) {
        const data: Integrations = { connections: [{ id: 'github', provider: 'GITHUB', configured, enabled: configured, version: 1,
          publicConfig: configured ? { repository: 'Ina-dang/fixture', baseBranch: 'main', installationId: 123, policyVersion: 1 } : {}, reason: configured ? null : 'CREDENTIAL_UNCONFIGURED' },
        { id: 'slack', provider: 'SLACK', configured: false, enabled: false, version: 1, publicConfig: {}, reason: 'CREDENTIAL_UNCONFIGURED' }], operations: state.operations, mergeRequests: state.mergeRequests, commands: state.commands,
        setup: { githubEnv: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY'], slackEnv: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'] } };
        return fulfill(data);
      }
      const found = tasks.find(task => path === `/tasks/${task.id}`);
      if (found) return fulfill({ ...found, events: [] });
      if (path.startsWith('/tasks/') && path.endsWith('/runs')) return fulfill({ items: [pendingRun()] });
      return route.continue();
    }
    if (path.startsWith('/employees') || path.startsWith(`/projects/${projectId}/staffing`) || path.startsWith(`/projects/${projectId}/integrations/operations`) || path.includes('/integrations/merges/')) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.requests.push({ path, body, method: request.method(), csrf: request.headers()['x-csrf-token'], key: request.headers()['idempotency-key'] });
      if (path.includes('/integrations/merges/')) {
        if (state.rejectMerge) return route.fulfill({ status: 409, json: { error: { messageKo: 'head SHA가 변경되어 승인이 무효입니다.' } } });
        const row = state.mergeRequests[0];
        if (path.endsWith('/validate')) return fulfill({ ready: state.mergeBlockers.length === 0, blockers: state.mergeBlockers, remoteMergeExecuted: false });
        state.mergeRequests[0] = { ...row, status: path.endsWith('/approve') ? 'APPROVED' : path.endsWith('/execute') ? 'QUEUED' : 'REVOKED', version: row.version + 1 };
        return fulfill(state.mergeRequests[0]);
      }
      if (path === '/employees') {
        const template = templates.find(item => item.role === body.template) ?? templates[0];
        const profile = { employeeId, role: template.role, nameKo: String(body.nameKo), profileVersion: 1, provider: template.provider, model: template.model,
          rolePrompt: String(body.rolePrompt ?? 'Template role specification'), skills: body.skills as string[], departmentKo: String(body.departmentKo ?? '개발'), workStyleKo: String(body.workStyleKo ?? '근거를 확인하고 보고'),
          tools: body.tools as string[], limits: body.limits as Employee['profile']['limits'], avatar: String(body.avatar) };
        state.profiles = [profile]; state.employees = [{ id: employeeId, organizationId: projectId, nameKo: profile.nameKo, role: profile.role, employmentStatus: 'ACTIVE',
          version: 1, currentProfileVersion: 1, profile, createdAt: now, updatedAt: now }];
        return fulfill(state.employees[0]);
      }
      if (path === `/employees/${employeeId}`) {
        const prior = state.employees[0];
        const profile = { ...prior.profile, ...body, profileVersion: prior.currentProfileVersion + 1 } as Employee['profile'];
        state.profiles.push(profile); state.employees[0] = { ...prior, profile, nameKo: profile.nameKo, currentProfileVersion: profile.profileVersion, version: prior.version + 1 };
        return fulfill(state.employees[0]);
      }
      if (path === `/employees/${employeeId}/employment`) {
        const prior = state.employees[0];
        const profile = body.action === 'rehire' ? { ...prior.profile, profileVersion: prior.currentProfileVersion + 1 } : prior.profile;
        if (body.action === 'rehire') state.profiles.push(profile);
        state.employees[0] = { ...prior, profile, currentProfileVersion: profile.profileVersion, version: prior.version + 1,
          employmentStatus: body.action === 'suspend' ? 'SUSPENDED' : body.action === 'retire' ? 'RETIRED' : 'ACTIVE' };
        return fulfill(state.employees[0]);
      }
      if (path === `/projects/${projectId}/staffing`) {
        if (state.rejectAssignment) return route.fulfill({ status: 409, json: { error: { messageKo: '배정 버전이 변경되었습니다. 새 기록을 확인하세요.' } } });
        const employee = state.employees.find(item => item.id === body.employeeId);
        const prior = state.assignments.find(item => item.role === body.role);
        const assignment: StaffAssignment = { role: body.role as StaffRole, employeeId: String(body.employeeId), employeeNameKo: employee?.nameKo ?? '검증 직원',
          profileVersion: employee?.currentProfileVersion ?? 1, version: (prior?.version ?? 0) + 1, employmentStatus: 'ACTIVE' };
        state.assignments = [...state.assignments.filter(item => item.role !== body.role), assignment]; return fulfill(assignment);
      }
      if (path.endsWith('/reconcile')) return fulfill(state.operations[0]);
      if (path.endsWith('/operations')) {
        if (state.rejectOperation) return route.fulfill({ status: 409, json: { error: { messageKo: '동일 SHA의 테스트·빌드·QA 근거가 필요합니다.' } } });
        state.operations = [unknownOperation()]; return fulfill(state.operations[0]);
      }
    }
    return route.continue();
  });
  return state;
}
async function openCollaboration(page: Page, tab = '업무 보드') {
  await page.goto('/');
  const area = page.getByRole('region', { name: '업무와 협업 관리', exact: true });
  await expect(area.getByRole('tab', { name: tab, exact: true })).toBeVisible();
  await area.getByRole('tab', { name: tab, exact: true }).click();
  return area;
}

test('Kanban reflects all server states and keyboard cards open gated task details', async ({ page }) => {
  const state = await mockCollaboration(page);
  const area = await openCollaboration(page);
  const office = page.getByRole('region', { name: '픽셀 사무실', exact: true });
  const developer = office.getByRole('button', { name: 'Developer 직원 상세', exact: true });
  await expect(developer).toContainText(assignedDeveloperName);
  await developer.focus(); await page.keyboard.press('Enter');
  await expect(office.getByRole('heading', { name: 'Developer 직원 상세', exact: true })).toBeVisible();
  await expect(office.locator('.office-detail-intro')).toContainText(assignedDeveloperName);
  for (const task of tasks) await expect(area.getByRole('button', { name: `보드 업무 열기: ${task.title}`, exact: true })).toBeVisible();
  await expect(area.getByRole('region', { name: '검토·승인 업무', exact: true })).toContainText('승인 대기');
  await expect(area.locator('[draggable="true"]')).toHaveCount(0);
  const card = area.getByRole('button', { name: `보드 업무 열기: ${tasks[4].title}`, exact: true });
  await card.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: tasks[4].title, exact: true })).toBeVisible();
  expect(state.requests).toEqual([]);
  await area.getByRole('tab', { name: '업무 보드', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(area.getByRole('tab', { name: '직원·배정', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('hire and assign Developer; profile updates retain prior immutable versions', async ({ page }) => {
  const state = await mockCollaboration(page);
  const area = await openCollaboration(page, '직원·배정');
  await area.getByRole('button', { name: '새 직원 채용', exact: true }).click();
  await area.getByLabel('역할 템플릿', { exact: true }).selectOption('DEVELOPER');
  await area.getByLabel('직원 이름', { exact: true }).fill('다온 개발자');
  await area.getByLabel('전문 기술', { exact: true }).fill('TypeScript, 테스트 설계');
  await area.getByLabel('업무 성향', { exact: true }).fill('근거를 확인하고 보고');
  await area.getByRole('checkbox', { name: '코드 파일 수정', exact: true }).uncheck();
  await area.getByRole('button', { name: '직원 채용 저장', exact: true }).click();
  await expect(area.getByRole('alert').filter({ hasText: '허용 도구와 실행 상한을 확인해 주세요.' })).toBeVisible();
  expect(state.requests).toEqual([]);
  await area.getByRole('checkbox', { name: '코드 파일 수정', exact: true }).check();
  await area.getByRole('button', { name: '직원 채용 저장', exact: true }).click();
  await expect(area.getByRole('button', { name: '다온 개발자 새 프로필 버전', exact: true })).toBeVisible();
  const assignment = area.getByRole('region', { name: 'Developer 프로젝트 배정', exact: true });
  await assignment.getByLabel('Developer 배정 직원', { exact: true }).selectOption(employeeId);
  await assignment.getByRole('button', { name: '배정 저장', exact: true }).click();
  await expect(assignment.locator('p')).toContainText('프로필 v1');
  await area.getByRole('button', { name: '다온 개발자 새 프로필 버전', exact: true }).click();
  await expect(area.getByLabel('역할 템플릿', { exact: true })).toBeDisabled();
  await area.getByLabel('업무 성향', { exact: true }).fill('검증 순서를 먼저 점검');
  await area.getByLabel('최대 모델 응답 수', { exact: true }).fill('6');
  await area.getByRole('button', { name: '새 프로필 버전 저장', exact: true }).click();
  await area.getByRole('button', { name: '다온 개발자 프로필 이력', exact: true }).click();
  await expect(area.getByText('프로필 v1 · codex-default', { exact: true })).toBeVisible();
  await expect(area.getByText('프로필 v2 · codex-default', { exact: true })).toBeVisible();
  expect(state.profiles[0].workStyleKo).toBe('근거를 확인하고 보고');
  expect(state.profiles[1].workStyleKo).toBe('검증 순서를 먼저 점검');
  await expect(assignment.locator('p')).toContainText('프로필 v2');
  expect(state.requests.every(request => !!request.csrf && !!request.key)).toBe(true);
  expect(state.requests.find(request => request.method === 'PATCH')?.body.expectedVersion).toBe(1);
  await area.getByRole('button', { name: '다온 개발자 일시 중지', exact: true }).click();
  await area.getByRole('button', { name: '다온 개발자 재직 재개', exact: true }).click();
  await expect(area.getByRole('button', { name: '다온 개발자 일시 중지', exact: true })).toBeVisible();
  await area.getByRole('button', { name: '다온 개발자 퇴사 처리', exact: true }).click();
  await area.getByRole('button', { name: '다온 개발자 재채용', exact: true }).click();
  await expect(area.getByRole('button', { name: '다온 개발자 일시 중지', exact: true })).toBeVisible();
  expect(state.employees[0].id).toBe(employeeId);
  expect(state.employees[0].currentProfileVersion).toBe(4);
  expect(state.profiles[0].workStyleKo).toBe('근거를 확인하고 보고');
});

test('unconfigured connections explain setup and UNKNOWN history never auto-reissues', async ({ page }) => {
  const state = await mockCollaboration(page);
  state.operations = [{ ...unknownOperation(), errorCode: '<script>window.collaborationInjected=true</script>', externalRef: 'javascript:alert(1)' },
    { ...unknownOperation(), id: 'ci-read', kind: 'CI_REFRESH', status: 'SUCCEEDED', errorCode: null,
      externalRef: { status: 'NOT_PASSED', headSha: 'a'.repeat(40), required: [{ name: 'unit', state: 'MISSING' }] } }];
  const area = await openCollaboration(page, '연동 현황');
  await expect(area.getByText('미설정', { exact: true })).toHaveCount(2);
  await expect(area.getByText('조회 완료', { exact: true })).toBeVisible();
  await expect(area.getByText('CI 검사 결과: 미통과', { exact: true })).toBeVisible();
  await expect(area.getByText('unit: MISSING', { exact: true })).toBeVisible();
  await expect(area.getByRole('form', { name: '외부 작업 요청', exact: true })).toHaveCount(0);
  const github = area.getByRole('region', { name: 'GitHub 연결', exact: true });
  await github.getByText('설정 확인 경로', { exact: true }).click();
  await expect(github.getByRole('link', { name: 'GitHub App 만들기 공식 안내', exact: true })).toBeVisible();
  await github.getByText('개발자용 서버 설정 이름', { exact: true }).click();
  await expect(github.getByText('GITHUB_APP_PRIVATE_KEY', { exact: true })).toBeVisible();
  await expect(area.getByText('원격 결과 확인 필요', { exact: true })).toBeVisible();
  await expect(area.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => 'collaborationInjected' in window)).toBe(false);
  expect(state.requests).toEqual([]);
  await area.getByRole('button', { name: '원격 결과 다시 확인', exact: true }).click();
  expect(state.requests).toHaveLength(1); expect(state.requests[0].path).toContain('/reconcile');
  await expect(area.getByText('원격 결과 확인 필요', { exact: true })).toBeVisible();
});

test('merge approval and execution remain separate after scope validation and keyboard confirmation', async ({ page }) => {
  const state = await mockCollaboration(page, true); state.mergeRequests = [mergeRequest()];
  const area = await openCollaboration(page, '연동 현황');
  const card = area.getByRole('listitem', { name: 'PR 2 merge 승인', exact: true });
  const approve = card.getByRole('button', { name: '이 범위의 merge 승인', exact: true });
  await expect(approve).toBeDisabled(); await expect(card.getByRole('checkbox')).toBeDisabled();
  await card.getByRole('button', { name: 'merge 범위 재검증', exact: true }).click();
  await expect(card.getByText('원격 범위와 권한을 확인했습니다. 아직 merge하지 않았습니다.', { exact: true })).toBeVisible();
  await card.getByRole('checkbox').focus(); await page.keyboard.press('Space'); await approve.click();
  const execute = card.getByRole('button', { name: '승인 범위로 실제 merge 실행', exact: true });
  await expect(execute).toBeDisabled(); expect(state.requests.some(row => row.path.endsWith('/execute'))).toBe(false);
  await card.getByRole('button', { name: 'merge 범위 재검증', exact: true }).click();
  await card.getByRole('checkbox').check(); await execute.click();
  await expect(card.getByText('실행 대기', { exact: true })).toBeVisible();
  const mutations = state.requests.filter(row => /\/(approve|execute)$/.test(row.path));
  expect(mutations).toHaveLength(2); expect(mutations[0].body).toEqual({ expectedVersion: 1, scopeHash: 'a'.repeat(64) });
  expect(mutations[1].body.expectedVersion).toBe(2); expect(mutations.every(row => !!row.csrf && !!row.key)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('server scope denial and draft blockers cannot enable merge approval', async ({ page }) => {
  const state = await mockCollaboration(page, true); state.mergeRequests = [mergeRequest()]; state.mergeBlockers = ['DRAFT_PULL_REQUEST'];
  const area = await openCollaboration(page, '연동 현황'), card = area.getByRole('listitem', { name: 'PR 2 merge 승인', exact: true });
  await card.getByRole('button', { name: 'merge 범위 재검증', exact: true }).click();
  await expect(card.getByText('Draft PR을 검토 가능한 상태로 전환한 뒤 새 승인 범위를 요청하세요.', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '이 범위의 merge 승인', exact: true })).toBeDisabled();
  state.mergeBlockers = []; state.rejectMerge = true;
  await card.getByRole('button', { name: 'merge 범위 재검증', exact: true }).click();
  await expect(card.getByText('head SHA가 변경되어 승인이 무효입니다.', { exact: true })).toBeVisible();
  await expect(card.getByRole('checkbox')).toBeDisabled(); expect(state.requests.every(row => row.path.endsWith('/validate'))).toBe(true);
});

test('Slack receipt outcomes render as escaped text and do not imply execution or merge acceptance', async ({ page }) => {
  const state = await mockCollaboration(page, true); state.commands = [{ id: operationId, eventType: '/ai-pixel', status: 'PROCESSED', errorCode: 'EFFECT_UNKNOWN',
    result: { taskId: tasks[0].id, text: '업무 등록: <script>throw new Error("unsafe")</script>\n상태: 할 일' }, replyStatus: 'UNKNOWN', createdAt: now }];
  const area = await openCollaboration(page, '연동 현황'), history = area.getByRole('region', { name: 'Slack 명령 처리 기록', exact: true });
  await expect(history.getByText('업무 등록: <script>throw new Error("unsafe")</script>\n상태: 할 일', { exact: true })).toBeVisible();
  await expect(history.getByText(/전송 결과 불명 · 자동 재전송 없음/)).toBeVisible();
  await expect(history.locator('script')).toHaveCount(0); expect(state.requests).toHaveLength(0);
});

test('external operation gate denial is visible and UNKNOWN blocks duplicate requests', async ({ page }) => {
  const state = await mockCollaboration(page, true); state.rejectOperation = true;
  const area = await openCollaboration(page, '연동 현황');
  await area.getByLabel('대상 업무', { exact: true }).selectOption(tasks[0].id);
  await expect(area.getByLabel('대상 실행', { exact: true })).toHaveValue(runId);
  await expect(area.getByText(sha, { exact: true })).toBeVisible();
  const form = area.getByRole('form', { name: '외부 작업 요청', exact: true });
  const submit = form.getByRole('button', { name: '확인한 외부 작업 요청', exact: true });
  await expect(submit).toBeDisabled();
  await form.getByRole('checkbox').check(); await submit.click();
  await expect(area.getByRole('alert').filter({ hasText: '동일 SHA의 테스트·빌드·QA 근거가 필요합니다.' })).toBeVisible();
  expect(state.requests[0].body).toMatchObject({ kind: 'DRAFT_PR_CREATE', runId, expectedRunVersion: 7 });
  state.rejectOperation = false; await submit.click();
  await expect(area.getByText('원격 결과 확인 필요', { exact: true })).toBeVisible();
  await expect(submit).toBeDisabled();
  await expect(form.getByRole('checkbox')).toBeDisabled();
  expect(state.requests.filter(request => request.path.endsWith('/operations'))).toHaveLength(2);
  expect(state.requests[0].key).toBe(state.requests[1].key);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
