import { createHash, randomUUID } from 'node:crypto';
import { type OfficeAgent, type Snapshot, snapshotSchema } from '@ai-pixel/contracts';
import { createDatabase, migrateDatabase } from '@ai-pixel/db';
import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp, initializeOwner } from '../apps/api/src/app.js';
import { projectOffice } from '../apps/api/src/office.js';
import { WorkflowRepository } from '../apps/api/src/workflows.js';
import { initialCheckpoint, type Checkpoint, type RoleEvidence, type RunStatus, type Stage } from '../packages/agents/src/types.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'http://127.0.0.1:3000';
const SECRET = 'phase2-office-fixture-not-an-owner-credential';
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/(?:^|[_-])test(?:$|[_-])/.test(decodeURIComponent(new URL(databaseUrl).pathname.slice(1))) || databaseUrl === process.env.DATABASE_URL) throw new Error('Phase 2 office tests require a separate test database.');
const database = createDatabase(databaseUrl);
const repository = new WorkflowRepository(database);
const SHA = 'b'.repeat(64);
let app: ReturnType<typeof createApp>;
let secretHash: string;
let cookie = '';
let projectId = '';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function roleEvidence(role: RoleEvidence['role']): RoleEvidence {
  return { role, threadId: `real-fixture-${randomUUID()}`, turnId: null, candidateSha: role === 'PM' ? null : SHA,
    completedAt: '2026-10-19T01:00:00.000Z', usage: { inputTokens: 17, cachedInputTokens: 3, outputTokens: 9 },
    output: { summaryKo: '<img src=x onerror=alert(1)> private-summary', specEn: 'PRIVATE_SPEC_MUST_NOT_ENTER_OFFICE', acceptanceCriteria: [{ id: 'AC-1', description: 'Implement addition' }],
      files: [{ path: 'private.mjs', content: 'PRIVATE_CODE_MUST_NOT_ENTER_OFFICE' }], verdict: 'PASS', candidateSha: SHA, issues: [] } };
}
async function fixture(options: { stage?: Stage; status?: RunStatus; taskStatus?: OfficeAgent['taskStatus']; roles?: RoleEvidence[]; title?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; stopReason?: string; project?: string } = {}) {
  const taskId = randomUUID(), runId = randomUUID();
  const stage = options.stage ?? 'PM', status = options.status ?? 'RUNNING';
  const taskStatus = options.taskStatus ?? (status === 'SUCCEEDED' ? 'COMPLETED' : status === 'CANCELLED' ? 'CANCELLED' : status === 'FAILED' ? 'FAILED' : status === 'WAITING_APPROVAL' ? 'APPROVAL_REQUIRED' : stage === 'PM' ? 'PLANNING' : stage === 'QA' ? 'REVIEW' : 'IN_PROGRESS');
  const checkpoint: Checkpoint = { ...initialCheckpoint(), stage, roles: options.roles ?? [], stopReason: options.stopReason ?? null,
    workspace: { files: [{ path: 'private.mjs', content: 'PRIVATE_CODE_MUST_NOT_ENTER_OFFICE' }], sha: SHA, diff: 'PRIVATE_DIFF_MUST_NOT_ENTER_OFFICE' } };
  await database.sql.begin(async (tx) => {
    await tx`insert into tasks (id,organization_id,project_id,title,command_original_ko,command_hash,acceptance_criteria,status,priority,created_by)
      values (${taskId},${ORG},${options.project ?? projectId},${options.title ?? '사무실 실제 상태 검증'},'한국어 명령을 유지해 주세요.',${digest('한국어 명령을 유지해 주세요.')},
      ${tx.json([{ id: 'AC-1', descriptionKo: '상태를 정확하게 보여준다', method: 'integration-test', required: true }])},${taskStatus},${options.priority ?? 'MEDIUM'},${USER})`;
    await tx`insert into workflow_runs (id,organization_id,project_id,task_id,command_original_ko,status,checkpoint,lease_token,lease_expires_at)
      values (${runId},${ORG},${options.project ?? projectId},${taskId},'한국어 명령을 유지해 주세요.',${status},${tx.json(JSON.parse(JSON.stringify(checkpoint)))},
      ${status === 'RUNNING' ? randomUUID() : null}::uuid,${status === 'RUNNING' ? tx`now()+interval '60 seconds'` : tx`null`})`;
  });
  return { taskId, runId, checkpoint };
}
async function snapshot(id = projectId): Promise<Snapshot> {
  const response = await app.request(`http://127.0.0.1:3001/api/v1/projects/${id}/snapshot`, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  return snapshotSchema.parse((await response.json()).data);
}
function role(snapshot: Snapshot, id: OfficeAgent['role']) {
  const found = snapshot.agents.find((agent) => agent.role === id);
  if (!found) throw new Error(`Missing office role ${id}`);
  return found;
}
beforeAll(async () => { await migrateDatabase(database); secretHash = await hash(SECRET); });
beforeEach(async () => {
  await database.sql`truncate organizations,users cascade`;
  await initializeOwner(database);
  projectId = randomUUID();
  await database.sql`insert into projects (id,organization_id,name,repository_url) values (${projectId},${ORG},'픽셀 사무실','https://github.com/Ina-dang/ai-pixel-company.git')`;
  app = createApp({ database, config: { appOrigin: ORIGIN, bootstrapSecretHash: secretHash, sessionTtlSeconds: 3600, cookieSecure: false, ssePollMs: 10, sseHeartbeatMs: 100,
    sseBatchSize: 1000, sseRetentionDays: 30, loginMaxAttempts: 100, loginWindowMs: 60_000 } });
  const login = await app.request('http://127.0.0.1:3001/api/v1/auth/session', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET }) });
  expect(login.status).toBe(200); cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
});
afterAll(async () => { await database.close(); });

describe('Phase 2 server-authoritative office projection', () => {
  test('empty project returns exactly three idle roles and a server synchronization timestamp', async () => {
    const result = await snapshot();
    expect(result.agents.map((agent) => agent.role)).toEqual(['PM', 'DEVELOPER', 'QA']);
    expect(result.agents.every((agent) => agent.state === 'IDLE' && agent.runId === null && agent.activeAssignments === 0)).toBe(true);
    expect(Number.isFinite(Date.parse(result.syncedAt))).toBe(true);
    expect(result.cursor).toBe('0');
  });
  test.each(['PM', 'DEVELOPER', 'VERIFY', 'QA'] as const)('%s stage projects only the current worker with fixed activity', async (stage) => {
    const previousRoles = stage === 'PM' ? [] : stage === 'DEVELOPER' ? [roleEvidence('PM')] : [roleEvidence('PM'), roleEvidence('DEVELOPER')];
    const item = await fixture({ stage, roles: previousRoles });
    const result = await snapshot();
    const current = stage === 'PM' ? 'PM' : stage === 'DEVELOPER' ? 'DEVELOPER' : 'QA';
    expect(role(result, current).state).toBe(current === 'QA' ? 'REVIEWING' : 'RUNNING');
    expect(role(result, current).runId).toBe(item.runId);
    expect(role(result, current).activeAssignments).toBe(1);
    expect(result.agents.filter((agent) => agent.state === 'RUNNING' || agent.state === 'REVIEWING')).toHaveLength(1);
    if (stage !== 'PM') expect(role(result, 'PM').lastCompletedAt).toBe('2026-10-19T01:00:00.000Z');
    if (stage === 'VERIFY') expect(role(result, 'QA').activityKo).toContain('테스트와 빌드');
    if (stage === 'QA') expect(role(result, 'QA').activityKo).toContain('검토');
    const serialized = JSON.stringify(result.agents);
    expect(serialized).not.toContain('PRIVATE_'); expect(serialized).not.toContain('private-summary'); expect(serialized).not.toContain('leaseToken');
  });
  test('different runs can activate all roles; higher priority current work wins deterministically', async () => {
    const pm = await fixture({ stage: 'PM' });
    const developer = await fixture({ stage: 'DEVELOPER', priority: 'URGENT' });
    const qa = await fixture({ stage: 'VERIFY' });
    await fixture({ stage: 'DEVELOPER', status: 'QUEUED', priority: 'URGENT' });
    await fixture({ stage: 'DEVELOPER', priority: 'LOW' });
    const result = await snapshot();
    expect(role(result, 'PM').runId).toBe(pm.runId);
    expect(role(result, 'DEVELOPER').runId).toBe(developer.runId);
    expect(role(result, 'QA').runId).toBe(qa.runId);
    expect(role(result, 'DEVELOPER').activeAssignments).toBe(3);
    expect(result.agents.map((agent) => agent.state)).toEqual(['RUNNING', 'RUNNING', 'REVIEWING']);
  });
  test.each([
    ['QUEUED', 'WAITING', 'developerDesk'], ['PAUSED', 'WAITING', 'lounge'], ['BLOCKED', 'BLOCKED', 'developerDesk'],
    ['FAILED', 'ERROR', 'developerDesk'], ['CANCELLED', 'IDLE', 'lounge'],
  ] as const)('%s execution stays separate from task status', async (status, state, location) => {
    await fixture({ stage: 'DEVELOPER', status, taskStatus: status === 'CANCELLED' ? 'CANCELLED' : status === 'FAILED' ? 'FAILED' : 'IN_PROGRESS', stopReason: 'FIXTURE_REASON' });
    const result = await snapshot(); const developer = role(result, 'DEVELOPER');
    expect(developer.state).toBe(state); expect(developer.location).toBe(location); expect(developer.runStatus).toBe(status);
    expect(result.tasks[0].status).toBe(status === 'CANCELLED' ? 'CANCELLED' : status === 'FAILED' ? 'FAILED' : 'IN_PROGRESS');
    expect(developer.taskStatus).toBe(result.tasks[0].status);
    expect(developer.blockedReason).toBe(['BLOCKED', 'FAILED'].includes(status) ? 'FIXTURE_REASON' : null);
  });
  test('approval waits at Owner with role evidence; only actual task state indicates completion', async () => {
    const item = await fixture({ stage: 'QA', status: 'WAITING_APPROVAL', roles: [roleEvidence('PM'), roleEvidence('DEVELOPER'), roleEvidence('QA')] });
    let result = await snapshot();
    expect(result.approvals).toEqual([{ id: item.runId, runId: item.runId, taskId: item.taskId, candidateSha: SHA, status: 'WAITING_APPROVAL', version: 1 }]);
    expect(JSON.stringify(result.approvals)).not.toContain('PRIVATE_');
    expect(role(result, 'PM').state).toBe('WAITING'); expect(role(result, 'PM').location).toBe('owner');
    expect(role(result, 'QA').state).toBe('IDLE'); expect(role(result, 'QA').evidenceSha).toBe(SHA);
    expect(role(result, 'QA').usage).toEqual({ inputTokens: 17, cachedInputTokens: 3, outputTokens: 9 });
    expect(result.tasks[0].status).toBe('APPROVAL_REQUIRED');
    await database.sql`update workflow_runs set status='SUCCEEDED',version=2 where id=${item.runId}`;
    result = await snapshot();
    expect(result.approvals).toEqual([]);
    expect(result.agents.every((agent) => agent.state === 'IDLE')).toBe(true);
    expect(result.tasks[0].status).toBe('APPROVAL_REQUIRED');
    expect(role(result, 'QA').taskStatus).toBe('APPROVAL_REQUIRED');
    await database.sql`update tasks set status='COMPLETED',version=version+1 where id=${item.taskId}`;
    expect((await snapshot()).tasks[0].status).toBe('COMPLETED');
  });
  test('latest completed role is shown only when no active assignment outranks it', async () => {
    const done = await fixture({ stage: 'QA', status: 'SUCCEEDED', roles: [roleEvidence('PM'), roleEvidence('DEVELOPER'), roleEvidence('QA')] });
    const active = await fixture({ stage: 'PM', priority: 'LOW' });
    const result = await snapshot();
    expect(role(result, 'PM').runId).toBe(active.runId); expect(role(result, 'PM').state).toBe('RUNNING');
    expect(role(result, 'DEVELOPER').runId).toBe(done.runId); expect(role(result, 'DEVELOPER').state).toBe('IDLE');
  });
  test('all active assignments are counted without a latest-run cap', async () => {
    for (let count = 0; count < 105; count++) await fixture({ stage: 'PM', status: 'QUEUED' });
    const actual = await fixture({ stage: 'PM', status: 'RUNNING', priority: 'LOW' });
    const result = await snapshot();
    expect(role(result, 'PM').activeAssignments).toBe(106);
    expect(role(result, 'PM').runId).toBe(actual.runId);
    expect(role(result, 'PM').state).toBe('RUNNING');
  });
  test('latest completed role uses its completion time rather than unrelated later run updates', async () => {
    const newerEvidence = roleEvidence('PM');
    const newest = await fixture({ stage: 'QA', status: 'SUCCEEDED', roles: [newerEvidence], priority: 'LOW' });
    const olderEvidence = { ...roleEvidence('PM'), completedAt: '2026-10-18T01:00:00.000Z' };
    await fixture({ stage: 'QA', status: 'SUCCEEDED', roles: [olderEvidence], priority: 'URGENT' });
    const result = await snapshot();
    expect(role(result, 'PM').runId).toBe(newest.runId);
    expect(role(result, 'PM').lastCompletedAt).toBe(newerEvidence.completedAt);
  });
  test('accepting an older QA result later does not replace more recent completed QA evidence', async () => {
    const newestEvidence = roleEvidence('QA');
    const newest = await fixture({ stage: 'QA', status: 'SUCCEEDED', roles: [roleEvidence('PM'), newestEvidence] });
    const olderEvidence = { ...roleEvidence('QA'), completedAt: '2026-10-18T01:00:00.000Z' };
    const acceptedLater = await fixture({ stage: 'QA', status: 'WAITING_APPROVAL', roles: [roleEvidence('PM'), olderEvidence] });
    await database.sql.begin(async (tx) => {
      await tx`update workflow_runs set status='SUCCEEDED',updated_at=now()+interval '1 hour',version=version+1 where id=${acceptedLater.runId}`;
      await tx`update tasks set status='COMPLETED',version=version+1 where id=${acceptedLater.taskId}`;
    });
    const result = await snapshot();
    expect(role(result, 'QA').runId).toBe(newest.runId);
    expect(role(result, 'QA').lastCompletedAt).toBe(newestEvidence.completedAt);
    expect(role(result, 'QA').state).toBe('IDLE');
  });
  test('office, tasks, and cursor share the exact repeatable-read database snapshot', async () => {
    const item = await fixture({ stage: 'PM' });
    const current = await repository.get(item.runId);
    if (!current?.leaseToken) throw new Error('Expected fixture lease');
    await database.sql.begin('isolation level repeatable read read only', async (tx) => {
      const before = await tx<{ last_sequence: string }[]>`select last_sequence from organization_event_counters where organization_id=${ORG}`;
      await repository.save(item.runId, current.leaseToken as string, { checkpoint: { ...item.checkpoint, stage: 'DEVELOPER', roles: [roleEvidence('PM')] } });
      const oldOffice = await projectOffice(tx, ORG, projectId);
      const oldTask = await tx`select status from tasks where id=${item.taskId}`;
      const after = await tx<{ last_sequence: string }[]>`select last_sequence from organization_event_counters where organization_id=${ORG}`;
      expect(before[0].last_sequence).toBe(after[0].last_sequence);
      expect(oldOffice.find((agent) => agent.role === 'PM')?.state).toBe('RUNNING');
      expect(oldOffice.find((agent) => agent.role === 'DEVELOPER')?.runId).toBeNull();
      expect(oldTask[0].status).toBe('PLANNING');
    });
    const latest = await snapshot();
    expect(role(latest, 'DEVELOPER').state).toBe('RUNNING');
    expect(latest.tasks[0].status).toBe('IN_PROGRESS'); expect(BigInt(latest.cursor)).toBeGreaterThan(0n);
  });
  test('project and organization scope exclude foreign assignments and require authentication', async () => {
    const foreignProject = randomUUID();
    await database.sql`insert into projects (id,organization_id,name,repository_url) values (${foreignProject},${ORG},'다른 프로젝트','https://github.com/Ina-dang/ai-pixel-company.git')`;
    await fixture({ stage: 'QA', status: 'WAITING_APPROVAL', project: foreignProject });
    expect((await snapshot()).agents.every((agent) => agent.runId === null)).toBe(true);
    expect((await snapshot()).approvals).toEqual([]);
    const otherOrg = randomUUID(), otherUser = randomUUID(), token = 'x'.repeat(43), csrf = 'y'.repeat(43);
    await database.sql`insert into organizations (id,name) values (${otherOrg},'다른 조직')`;
    await database.sql`insert into users (id,external_subject,display_name) values (${otherUser},${otherUser},'다른 Owner')`;
    await database.sql`insert into memberships (id,organization_id,user_id,role) values (${randomUUID()},${otherOrg},${otherUser},'OWNER')`;
    await database.sql`insert into sessions (id,organization_id,user_id,token_hash,csrf_hash,expires_at) values (${randomUUID()},${otherOrg},${otherUser},${digest(token)},${digest(csrf)},now()+interval '1 hour')`;
    expect((await app.request(`http://127.0.0.1:3001/api/v1/projects/${foreignProject}/snapshot`, { headers: { Cookie: `pixel_session=${token}; pixel_csrf=${csrf}` } })).status).toBe(404);
    expect((await app.request(`http://127.0.0.1:3001/api/v1/projects/${projectId}/snapshot`)).status).toBe(401);
  });
  test('hostile summaries stay out of office bubbles while task title remains original data', async () => {
    const title = '<script>alert("office")</script>';
    await fixture({ stage: 'DEVELOPER', title, roles: [roleEvidence('PM')] });
    const result = await snapshot();
    expect(role(result, 'DEVELOPER').taskTitle).toBe(title);
    expect(result.agents.every((agent) => !agent.activityKo.includes('<') && !agent.activityKo.includes('private-summary'))).toBe(true);
    const serialized = JSON.stringify(result.agents);
    expect(serialized).not.toContain('PRIVATE_CODE'); expect(serialized).not.toContain('PRIVATE_SPEC'); expect(serialized).not.toContain('PRIVATE_DIFF');
  });
});
