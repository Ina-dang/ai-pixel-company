import { randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@ai-pixel/db';
import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp, initializeOwner } from '../apps/api/src/app.js';
import { authorizeStaffingRole, ensureDefaultStaffing, readRunStaffing } from '../apps/api/src/staffing.js';
import { WorkflowRepository } from '../apps/api/src/workflows.js';
import { initialCheckpoint, type AgentProvider, type Role, type StaffingProfile, type WorkflowRun, type WorkflowStore } from '../packages/agents/src/types.js';
import { WorkflowRunner } from '../packages/agents/src/workflow.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'http://127.0.0.1:3000';
const SECRET = 'phase3-staffing-test-not-a-production-owner-key';
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/(?:^|[_-])test(?:$|[_-])/.test(decodeURIComponent(new URL(databaseUrl).pathname.slice(1))) || process.env.DATABASE_URL === databaseUrl) throw new Error('Staffing tests require a separate test database.');
const database = createDatabase(databaseUrl);
const repository = new WorkflowRepository(database);
const provider: AgentProvider = {
  status: async () => ({ ready: true, reason: null, authMode: 'chatgpt', billingMode: 'CHATGPT_SUBSCRIPTION', windows: [{ usedPercent: 10, resetsAt: null, windowDurationMins: null }], checkedAt: new Date().toISOString() }),
  run: async () => { throw new Error('No model invocation is permitted in staffing integration fixtures.'); }, close: async () => undefined,
};
type Employee = { id: string; role: Role; nameKo: string; employmentStatus: string; version: number; currentProfileVersion: number; profile: StaffingProfile };
type Assignment = { role: Role; employeeId: string; version: number; profileVersion: number };
let app: ReturnType<typeof createApp>, secretHash: string, cookie: string, csrf: string, projectId: string;
async function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return app.request(`http://127.0.0.1:3001/api/v1${path}`, { method, headers: { Cookie: cookie, Origin: ORIGIN, 'X-CSRF-Token': csrf,
    'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function hire(template: Role = 'DEVELOPER', nameKo = '새 개발자'): Promise<Employee> {
  const response = await request('/employees', 'POST', { template, nameKo }); expect(response.status).toBe(201); return (await response.json()).data;
}
async function assignments(): Promise<Assignment[]> { return (await (await request(`/projects/${projectId}/staffing`)).json()).data.items; }
async function assign(person: Employee) {
  const current = (await assignments()).find(item => item.role === person.role);
  const response = await request(`/projects/${projectId}/staffing`, 'PUT', { role: person.role, employeeId: person.id, ...(current ? { expectedVersion: current.version } : {}) });
  expect(response.status).toBe(200); return (await response.json()).data as Assignment;
}
async function createRun(): Promise<WorkflowRun> {
  const task = await (await request(`/projects/${projectId}/tasks`, 'POST', { title: '채용 직원 실행 검증', commandOriginalKo: '새로 채용한 개발자가 덧셈 오류를 수정해 주세요.', source: 'TEXT',
    acceptanceCriteria: [{ id: 'AC-1', descriptionKo: '실제 배정된 직원의 고정 프로필을 사용한다', method: 'integration-test', required: true }] })).json();
  const response = await request(`/tasks/${task.data.id}/runs`, 'POST', { fixture: 'node-functions-v1' }); expect(response.status).toBe(201); return (await response.json()).data;
}
async function activate(run: WorkflowRun) {
  const token = randomUUID();
  await database.sql`update workflow_runs set status='RUNNING',lease_token=${token},lease_expires_at=now()+interval '60 seconds' where id=${run.id}`;
  return token;
}
describe('Phase 3 persistent template staffing', () => {
beforeAll(async () => { await migrateDatabase(database); secretHash = await hash(SECRET); });
beforeEach(async () => {
  await database.sql`truncate organizations,users cascade`; await initializeOwner(database);
  app = createApp({ database, workflowProvider: provider, config: { appOrigin: ORIGIN, bootstrapSecretHash: secretHash, sessionTtlSeconds: 3600, cookieSecure: false,
    ssePollMs: 10, sseHeartbeatMs: 100, sseBatchSize: 1000, sseRetentionDays: 30, loginMaxAttempts: 100, loginWindowMs: 60_000 } });
  const login = await app.request('http://127.0.0.1:3001/api/v1/auth/session', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET }) });
  expect(login.status).toBe(200); csrf = (await login.json()).data.csrfToken; cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const project = await (await request('/projects', 'POST', { name: '직원 배정 프로젝트', repositoryUrl: 'https://github.com/Ina-dang/ai-pixel-company.git', defaultBranch: 'main' })).json();
  projectId = project.data.id;
});
afterAll(async () => { await database.close(); });

  test('baseline employees and project assignments initialize once, without silent reassignment', async () => {
    const employees = (await (await request('/employees')).json()).data.items as Employee[];
    expect(employees).toHaveLength(3); expect(new Set(employees.map(person => person.role)).size).toBe(3);
    const assigned = await assignments(); expect(assigned).toHaveLength(3);
    const developer = assigned.find(item => item.role === 'DEVELOPER'); if (!developer) throw new Error('Expected developer');
    expect((await request(`/projects/${projectId}/staffing/DEVELOPER`, 'DELETE', { expectedVersion: developer.version })).status).toBe(200);
    await database.sql.begin(tx => ensureDefaultStaffing(tx, ORG, projectId));
    expect(await assignments()).toHaveLength(2);
    expect((await request('/employees/templates', 'GET', undefined, { Cookie: '' })).status).toBe(401);
  });
  test('recruitment rejects model, provider, arbitrary tools, permission escalation and oversized budgets', async () => {
    const base = { template: 'DEVELOPER', nameKo: '검증 개발자' };
    for (const changed of [{ model: 'arbitrary-paid-model' }, { provider: 'OPENAI_API' }, { tools: ['SHELL'] }, { tools: ['PLAN'] },
      { apiKey: 'not-a-real-secret' }, { limits: { maxTurns: 8, maxTokens: 500000, maxElapsedMs: 900000 } }]) {
      expect((await request('/employees', 'POST', { ...base, ...changed })).status).toBe(400);
    }
    const hired = await hire(); expect(hired.profile.provider).toBe('CHATGPT_SUBSCRIPTION'); expect(hired.profile.model).toBe('codex-default');
    expect(hired.profile.tools).toEqual(['EDIT_FILES']); expect(hired.profile.profileVersion).toBe(1);
  });
  test('new Developer assignment is captured immutably when a run is created', async () => {
    const hired = await hire(); await assign(hired); const run = await createRun();
    const snapshots = await readRunStaffing(database.sql, run.id);
    expect(snapshots).toHaveLength(3);
    expect(snapshots.find(profile => profile.role === 'DEVELOPER')?.employeeId).toBe(hired.id);
    expect((await repository.get(run.id))?.staffing?.find(profile => profile.role === 'DEVELOPER')?.profileVersion).toBe(1);
    const modified = await request(`/employees/${hired.id}`, 'PATCH', { expectedVersion: hired.version, nameKo: '변경된 개발자', rolePrompt: 'New preferences remain bounded by policy.' });
    expect(modified.status).toBe(200);
    const current = (await modified.json()).data as Employee; expect(current.currentProfileVersion).toBe(2);
    const detail = (await (await request(`/employees/${hired.id}`)).json()).data;
    expect(detail.profiles).toHaveLength(2); expect(detail.profiles[0].nameKo).toBe('새 개발자');
    expect((await readRunStaffing(database.sql, run.id)).find(profile => profile.role === 'DEVELOPER')?.nameKo).toBe('새 개발자');
    await expect(database.sql`update employee_profiles set config='{}' where employee_id=${hired.id}`).rejects.toMatchObject({ code: '42501' });
    await expect(database.sql`delete from workflow_staffing_snapshots where run_id=${run.id}`).rejects.toMatchObject({ code: '42501' });
    expect((await request(`/employees/${hired.id}`, 'PATCH', { expectedVersion: hired.version, nameKo: '오래된 변경' })).status).toBe(409);
  });
  test('runtime permission checks deny paused, expired and unassigned executions', async () => {
    const hired = await hire(); const assigned = await assign(hired); const run = await createRun(); await activate(run);
    expect((await authorizeStaffingRole(database, run.id, 'DEVELOPER', ['EDIT_FILES'])).employeeId).toBe(hired.id);
    await expect(authorizeStaffingRole(database, run.id, 'DEVELOPER', ['PLAN'])).rejects.toMatchObject({ reason: 'STAFFING_PERMISSION_REVOKED' });
    await database.sql`update workflow_runs set lease_expires_at=now()-interval '1 second' where id=${run.id}`;
    await expect(authorizeStaffingRole(database, run.id, 'DEVELOPER', ['EDIT_FILES'])).rejects.toMatchObject({ reason: 'STAFFING_PERMISSION_REVOKED' });
    await database.sql`update workflow_runs set lease_expires_at=now()+interval '60 seconds' where id=${run.id}`;
    expect((await request(`/projects/${projectId}/staffing/DEVELOPER`, 'DELETE', { expectedVersion: assigned.version })).status).toBe(200);
    const stopped = await repository.get(run.id); expect(stopped?.status).toBe('PAUSED'); expect(stopped?.leaseToken).toBeNull();
    await expect(authorizeStaffingRole(database, run.id, 'DEVELOPER', ['EDIT_FILES'])).rejects.toMatchObject({ reason: 'STAFFING_PERMISSION_REVOKED' });
    const task = await (await request(`/projects/${projectId}/tasks`, 'POST', { title: '배정 없음', commandOriginalKo: '미배정 직원 실행 금지', acceptanceCriteria: [{ id: 'AC-1', descriptionKo: '거부한다', method: 'integration-test', required: true }] })).json();
    expect((await request(`/tasks/${task.data.id}/runs`, 'POST', { fixture: 'node-functions-v1' })).status).toBe(409);
  });
  test('suspension fences active work; rehire preserves history and creates a new profile version', async () => {
    const hired = await hire(); await assign(hired); const run = await createRun(); const token = await activate(run);
    const suspended = await request(`/employees/${hired.id}/employment`, 'POST', { action: 'suspend', expectedVersion: hired.version });
    expect(suspended.status).toBe(200); const person = (await suspended.json()).data as Employee; expect(person.employmentStatus).toBe('SUSPENDED');
    expect((await repository.get(run.id))?.status).toBe('PAUSED'); expect(await repository.save(run.id, token, { status: 'WAITING_APPROVAL' })).toBe(false);
    await expect(authorizeStaffingRole(database, run.id, 'DEVELOPER', ['EDIT_FILES'])).rejects.toMatchObject({ reason: 'STAFFING_PERMISSION_REVOKED' });
    const rehired = await request(`/employees/${hired.id}/employment`, 'POST', { action: 'rehire', expectedVersion: person.version });
    expect(rehired.status).toBe(200); const back = (await rehired.json()).data as Employee; expect(back.id).toBe(hired.id); expect(back.currentProfileVersion).toBe(2);
    const detail = (await (await request(`/employees/${hired.id}`)).json()).data;
    expect(detail.employmentHistory.map((event: { toStatus: string }) => event.toStatus)).toEqual(['ACTIVE', 'SUSPENDED', 'ACTIVE']);
    expect((await readRunStaffing(database.sql, run.id)).find(profile => profile.role === 'DEVELOPER')?.profileVersion).toBe(1);
  });
  test('retirement invalidates pending acceptance and keeps old profiles after rehire', async () => {
    const hired = await hire(); await assign(hired); const run = await createRun();
    await database.sql`update workflow_runs set status='WAITING_APPROVAL' where id=${run.id}`;
    const retired = await request(`/employees/${hired.id}/employment`, 'POST', { action: 'retire', expectedVersion: hired.version });
    expect(retired.status).toBe(200); const person = (await retired.json()).data as Employee;
    expect((await repository.get(run.id))?.status).toBe('PAUSED');
    expect((await request(`/runs/${run.id}/accept`, 'POST', { expectedVersion: (await repository.get(run.id))?.version, candidateSha: 'a'.repeat(64) })).status).toBe(409);
    expect((await request(`/employees/${hired.id}/employment`, 'POST', { action: 'rehire', expectedVersion: person.version })).status).toBe(200);
    expect((await (await request(`/employees/${hired.id}`)).json()).data.profiles).toHaveLength(2);
  });
  test('assignment replacement requires matching role/version and uses fresh versions after remove/readd', async () => {
    const hired = await hire(), pm = await hire('PM', '새 PM'); const before = (await assignments()).find(item => item.role === 'DEVELOPER'); if (!before) throw new Error('Expected assignment');
    expect((await request(`/projects/${projectId}/staffing`, 'PUT', { role: 'DEVELOPER', employeeId: hired.id })).status).toBe(409);
    expect((await request(`/projects/${projectId}/staffing`, 'PUT', { role: 'DEVELOPER', employeeId: pm.id, expectedVersion: before.version })).status).toBe(409);
    const assigned = await assign(hired);
    expect((await request(`/projects/${projectId}/staffing/DEVELOPER`, 'DELETE', { expectedVersion: before.version })).status).toBe(409);
    expect((await request(`/projects/${projectId}/staffing/DEVELOPER`, 'DELETE', { expectedVersion: assigned.version })).status).toBe(200);
    const again = await assign(hired); expect(again.version).toBeGreaterThan(assigned.version);
    expect((await request(`/projects/${projectId}/staffing/DEVELOPER`, 'DELETE', { expectedVersion: assigned.version })).status).toBe(409);
  });
  test('office shows newly assigned identity without crediting previous employee evidence; unassigned is blocked', async () => {
    const oldRun = await createRun();
    const checkpoint = { ...initialCheckpoint(), stage: 'QA', roles: [{ role: 'DEVELOPER', threadId: 'old-developer-evidence', turnId: null,
      completedAt: new Date().toISOString(), candidateSha: 'a'.repeat(64), usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
      output: { summaryKo: '이전 직원 검증', specEn: 'Old fixture', acceptanceCriteria: [], files: [], verdict: 'NA', candidateSha: 'a'.repeat(64), issues: [] } }] };
    await database.sql`update workflow_runs set status='SUCCEEDED',checkpoint=${database.sql.json(JSON.parse(JSON.stringify(checkpoint)))} where id=${oldRun.id}`;
    let office = (await (await request(`/projects/${projectId}/snapshot`)).json()).data.agents as { role: string; employeeId: string | null; nameKo: string; state: string; evidenceSha: string | null; runId: string | null }[];
    expect(office.find(person => person.role === 'DEVELOPER')?.evidenceSha).toBe('a'.repeat(64));
    const hired = await hire('DEVELOPER', '실제 새 개발자'); const assigned = await assign(hired);
    office = (await (await request(`/projects/${projectId}/snapshot`)).json()).data.agents;
    const developer = office.find(person => person.role === 'DEVELOPER');
    expect(developer?.employeeId).toBe(hired.id); expect(developer?.nameKo).toBe('실제 새 개발자'); expect(developer?.evidenceSha).toBeNull(); expect(developer?.runId).toBeNull();
    expect((await request(`/projects/${projectId}/staffing/DEVELOPER`, 'DELETE', { expectedVersion: assigned.version })).status).toBe(200);
    office = (await (await request(`/projects/${projectId}/snapshot`)).json()).data.agents;
    expect(office.find(person => person.role === 'DEVELOPER')?.state).toBe('BLOCKED'); expect(office.find(person => person.role === 'DEVELOPER')?.employeeId).toBeNull();
    expect(office.find(person => person.role === 'DEVELOPER')?.evidenceSha).toBeNull();
  });
  test('replacement queued work remains visible when the previous employee has a higher-ranked paused run', async () => {
    const oldRun = await createRun();
    const oldCheckpoint = { ...initialCheckpoint(), stage: 'DEVELOPER' };
    await database.sql`update workflow_runs set checkpoint=${database.sql.json(JSON.parse(JSON.stringify(oldCheckpoint)))} where id=${oldRun.id}`;
    const hired = await hire('DEVELOPER', '교체된 새 개발자'); await assign(hired);
    expect((await repository.get(oldRun.id))?.status).toBe('PAUSED');
    const newRun = await createRun();
    const queuedCheckpoint = { ...initialCheckpoint(), stage: 'DEVELOPER' };
    await database.sql`update workflow_runs set checkpoint=${database.sql.json(JSON.parse(JSON.stringify(queuedCheckpoint)))} where id=${newRun.id}`;
    const office = (await (await request(`/projects/${projectId}/snapshot`)).json()).data.agents as { role: string; employeeId: string | null; nameKo: string; state: string; runId: string | null; runStatus: string | null; activeAssignments: number }[];
    const developer = office.find(person => person.role === 'DEVELOPER');
    expect(developer?.employeeId).toBe(hired.id); expect(developer?.nameKo).toBe('교체된 새 개발자');
    expect(developer?.runId).toBe(newRun.id); expect(developer?.runStatus).toBe('QUEUED'); expect(developer?.state).toBe('WAITING');
    expect(developer?.activeAssignments).toBe(1);
  });
  test('tenant boundaries and CSRF block employee/profile/assignment writes', async () => {
    const hired = await hire();
    expect((await request(`/employees/${hired.id}`, 'PATCH', { expectedVersion: 1, nameKo: 'CSRF' }, { 'X-CSRF-Token': '' })).status).toBe(403);
    const foreign = randomUUID();
    await database.sql`insert into organizations (id,name) values (${foreign},'다른 조직')`;
    const invisible = randomUUID();
    await database.sql`insert into employees (id,organization_id,name_ko,role) values (${invisible},${foreign},'다른 개발자','DEVELOPER')`;
    await database.sql`insert into employee_profiles (organization_id,employee_id,version,config) values (${foreign},${invisible},1,${database.sql.json({ ...hired.profile, employeeId: invisible })})`;
    expect((await request(`/employees/${invisible}`)).status).toBe(404);
    expect((await request(`/employees/${invisible}`, 'PATCH', { expectedVersion: 1, nameKo: '교차 조직' })).status).toBe(404);
    const assigned = (await assignments()).find(item => item.role === 'DEVELOPER');
    expect((await request(`/projects/${projectId}/staffing`, 'PUT', { role: 'DEVELOPER', employeeId: invisible, expectedVersion: assigned?.version })).status).toBe(404);
    expect(((await (await request('/employees')).json()).data.items as Employee[]).some(person => person.id === invisible)).toBe(false);
  });
  test('runtime uses pinned new employee preferences and rechecks suspension before applying generated files', async () => {
    const hired = await hire(); await assign(hired); const run = await createRun();
    let applyCalls = 0; const observed: Role[] = [];
    const workspace = { files: [{ path: 'src/math.mjs', content: 'old fixture' }], sha: 'b'.repeat(64), diff: '' };
    const fakeProvider: AgentProvider = { ...provider, run: async input => {
      observed.push(input.role); const prompt = JSON.parse(input.prompt);
      await input.onStarted(`fixture-thread-${input.role}`, null);
      if (input.role === 'DEVELOPER') {
        expect(prompt.profile.employeeId).toBe(hired.id); expect(prompt.profile.profileVersion).toBe(1);
        expect((await request(`/employees/${hired.id}/employment`, 'POST', { action: 'suspend', expectedVersion: hired.version })).status).toBe(200);
      }
      return { role: input.role, threadId: `fixture-thread-${input.role}`, turnId: null, completedAt: new Date().toISOString(), candidateSha: null,
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, output: { summaryKo: '권한 재검사 시험', specEn: 'Fix add and sum.', acceptanceCriteria: [{ id: 'AC-1', description: 'Tests pass.' }],
          files: input.role === 'DEVELOPER' ? [{ path: 'src/math.mjs', content: 'new fixture' }] : [], verdict: 'NA', candidateSha: '', issues: [] } };
    } };
    const runner = new WorkflowRunner(repository, fakeProvider, { prepare: async () => workspace, snapshot: async () => workspace,
      apply: async () => { applyCalls++; return workspace; }, verify: async () => { throw new Error('Verification must not execute after permission revocation.'); } });
    expect(await runner.tick()).toBe(true);
    expect(observed).toEqual(['PM', 'DEVELOPER']); expect(applyCalls).toBe(0);
    const stopped = await repository.get(run.id); expect(stopped?.status).toBe('PAUSED'); expect(stopped?.checkpoint.stopReason).toBe('STAFFING_PERMISSION_REVOKED');
    await runner.stop();
  });
});

describe('Phase 3 in-memory budget regression without database or model calls', () => {
  test('the lowest pinned profile token limit stops the entire workflow after recording consumed usage', async () => {
    const staffing: StaffingProfile[] = (['PM', 'DEVELOPER', 'QA'] as const).map(role => ({ employeeId: randomUUID(), role, nameKo: role, profileVersion: 1,
      provider: 'CHATGPT_SUBSCRIPTION', model: 'codex-default', rolePrompt: 'Bounded fixture preferences.', skills: [], departmentKo: '검증', workStyleKo: '검증',
      tools: role === 'PM' ? ['PLAN'] : role === 'DEVELOPER' ? ['EDIT_FILES'] : ['VERIFY', 'REVIEW'],
      limits: { maxTurns: 7, maxTokens: role === 'DEVELOPER' ? 1000 : 500000, maxElapsedMs: 900000 }, avatar: role === 'PM' ? 'pm' : role === 'DEVELOPER' ? 'developer' : 'qa' }));
    const now = new Date().toISOString(); let calls = 0; let claimed = false;
    let current: WorkflowRun = { id: randomUUID(), organizationId: ORG, projectId: randomUUID(), taskId: randomUUID(), commandOriginalKo: '공유 한도를 지켜 주세요.',
      status: 'QUEUED', version: 1, leaseToken: null, leaseExpiresAt: null, checkpoint: initialCheckpoint(), createdAt: now, updatedAt: now, staffing };
    const store: WorkflowStore = {
      claim: async () => { if (claimed) return null; claimed = true; current = { ...current, status: 'RUNNING', leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60000).toISOString() }; return structuredClone(current); },
      get: async () => structuredClone(current), heartbeat: async (_id, token) => current.status === 'RUNNING' && current.leaseToken === token,
      recover: async () => 0, acknowledgeStop: async () => false,
      authorizeRole: async (_id, role) => { const found = staffing.find(profile => profile.role === role); if (!found) throw new Error('Missing test staffing'); return found; },
      save: async (_id, token, change) => { if (current.status !== 'RUNNING' || current.leaseToken !== token) return false;
        current = { ...current, ...structuredClone(change), version: current.version + 1 }; if (current.status !== 'RUNNING') current.leaseToken = null; return true; },
    };
    const fakeProvider: AgentProvider = { ...provider, run: async input => {
      calls++; await input.onStarted('budget-fixture-thread', null);
      return { role: input.role, threadId: 'budget-fixture-thread', turnId: null, completedAt: new Date().toISOString(), candidateSha: null,
        usage: { inputTokens: 900, cachedInputTokens: 0, outputTokens: 200 }, output: { summaryKo: '한도 검증', specEn: 'Plan the fixture.', acceptanceCriteria: [{ id: 'AC-1', description: 'Pass tests.' }],
          files: [], verdict: 'NA', candidateSha: '', issues: [] } };
    } };
    const workspace = { files: [{ path: 'src/math.mjs', content: 'fixture' }], sha: 'b'.repeat(64), diff: '' };
    const runner = new WorkflowRunner(store, fakeProvider, { prepare: async () => workspace, snapshot: async () => workspace,
      apply: async () => { throw new Error('Code changes must not execute over the profile budget.'); }, verify: async () => { throw new Error('Verification must not execute over the profile budget.'); } });
    expect(await runner.tick()).toBe(true); expect(calls).toBe(1);
    const stopped = await store.get(current.id); expect(stopped?.status).toBe('BLOCKED'); expect(stopped?.checkpoint.stopReason).toBe('TOKEN_LIMIT');
    expect(stopped?.checkpoint.usage).toEqual({ inputTokens: 900, cachedInputTokens: 0, outputTokens: 200 });
    await runner.stop();
  });
});
