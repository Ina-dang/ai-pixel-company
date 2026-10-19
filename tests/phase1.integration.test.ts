import { createHash, randomUUID } from 'node:crypto';
import { initialCheckpoint, type AgentProvider, type Checkpoint, type RoleEvidence, type WorkflowRun } from '../packages/agents/src/index.js';
import { createDatabase, migrateDatabase } from '@ai-pixel/db';
import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp, initializeOwner } from '../apps/api/src/app.js';
import { WorkflowRepository } from '../apps/api/src/workflows.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'http://127.0.0.1:3000';
const SECRET = 'phase1-test-fixture-not-a-local-owner-secret';
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/(?:^|[_-])test(?:$|[_-])/.test(decodeURIComponent(new URL(databaseUrl).pathname.slice(1))) || databaseUrl === process.env.DATABASE_URL) {
  throw new Error('Phase 1 verification requires a separate test database.');
}
const database = createDatabase(databaseUrl);
const repository = new WorkflowRepository(database);
let app: ReturnType<typeof createApp>;
let secretHash: string;
let cookie: string;
let csrf: string;
let ready = true;
const provider: AgentProvider = {
  status: async () => ({ ready, reason: ready ? null : 'QUOTA_LIMIT', authMode: 'chatgpt', billingMode: 'CHATGPT_SUBSCRIPTION', windows: [{ usedPercent: ready ? 30 : 100, resetsAt: null, windowDurationMins: null }], checkedAt: new Date().toISOString() }),
  run: async () => { throw new Error('No live inference in integration fixtures.'); }, close: async () => undefined,
};
async function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return app.request(`http://127.0.0.1:3001/api/v1${path}`, { method,
    headers: { Cookie: cookie, Origin: ORIGIN, 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function createRun(key?: string): Promise<WorkflowRun> {
  const project = await (await request('/projects', 'POST', { name: '구독 실행 검증', repositoryUrl: 'https://github.com/Ina-dang/ai-pixel-company.git', defaultBranch: 'main' })).json();
  const task = await (await request(`/projects/${project.data.id}/tasks`, 'POST', { title: '두 수의 합', commandOriginalKo: '두 수의 합을 구현하고 검증해줘.', source: 'TEXT',
    acceptanceCriteria: [{ id: 'AC-1', descriptionKo: '합을 반환한다', method: 'unit-test', required: true }] })).json();
  const response = await request(`/tasks/${task.data.id}/runs`, 'POST', { fixture: 'node-functions-v1' }, key ? { 'Idempotency-Key': key } : {});
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.data).not.toHaveProperty('leaseToken');
  return body.data;
}
const SHA = 'a'.repeat(40);
function evidence(role: RoleEvidence['role']): RoleEvidence {
  return { role, threadId: randomUUID(), turnId: randomUUID(), candidateSha: role === 'PM' ? null : SHA,
    completedAt: new Date().toISOString(), usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 }, output: {
      summaryKo: '검증된 결과', specEn: 'Implement addition.', acceptanceCriteria: [{ id: 'AC-1', description: 'Returns the sum.' }],
      files: role === 'DEVELOPER' ? [{ path: 'src/add.js', content: 'export const add = (a,b) => a+b;' }] : [], verdict: role === 'QA' ? 'PASS' : 'NA',
      candidateSha: role === 'PM' ? '' : SHA, issues: [],
    } };
}
function acceptedCheckpoint(): Checkpoint {
  return { ...initialCheckpoint(), stage: 'QA', roles: [evidence('PM'), evidence('DEVELOPER'), evidence('QA')],
    workspace: { files: [{ path: 'src/add.js', content: 'export const add = (a,b) => a+b;' }], diff: '+export const add = (a,b) => a+b;', sha: SHA },
    verification: { sha: SHA, test: { exitCode: 0, output: '1 passed' }, build: { exitCode: 0, output: 'ok' },
      sandbox: { networkDisabled: true, readOnlyRoot: true, resourceLimited: true }, verifiedAt: new Date().toISOString() } };
}
beforeAll(async () => { await migrateDatabase(database); secretHash = await hash(SECRET); });
beforeEach(async () => {
  await database.sql`truncate organizations,users cascade`;
  await initializeOwner(database);
  ready = true;
  app = createApp({ database, workflowProvider: provider, config: { appOrigin: ORIGIN, bootstrapSecretHash: secretHash, sessionTtlSeconds: 3600, cookieSecure: false,
    ssePollMs: 10, sseHeartbeatMs: 100, sseBatchSize: 1000, sseRetentionDays: 30, loginMaxAttempts: 100, loginWindowMs: 60_000 } });
  const login = await app.request('http://127.0.0.1:3001/api/v1/auth/session', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET }) });
  expect(login.status).toBe(200);
  csrf = (await login.json()).data.csrfToken;
  cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
});
afterAll(async () => { await database.close(); });

describe('Phase 1 durable subscription workflow', () => {
  test('subscription status is authenticated; readiness and bound fixture gate queue creation', async () => {
    expect((await request('/subscription', 'GET', undefined, { Cookie: '' })).status).toBe(401);
    expect((await (await request('/subscription')).json()).data.billingMode).toBe('CHATGPT_SUBSCRIPTION');
    const run = await createRun();
    ready = false;
    expect((await request(`/tasks/${run.taskId}/runs`, 'POST', { fixture: 'node-functions-v1' })).status).toBe(409);
    expect((await request(`/tasks/${run.taskId}/runs`, 'POST', { fixture: 'node-functions-v1', path: 'C:\\' })).status).toBe(400);
  });
  test('one active run per task; idempotent exact replay; safe list and private lease', async () => {
    const run = await createRun('phase1-create');
    const replay = await request(`/tasks/${run.taskId}/runs`, 'POST', { fixture: 'node-functions-v1' }, { 'Idempotency-Key': 'phase1-create' });
    expect((await replay.json()).data.id).toBe(run.id);
    expect((await request(`/tasks/${run.taskId}/runs`, 'POST', { fixture: 'node-functions-v1' })).status).toBe(409);
    expect((await (await request(`/tasks/${run.taskId}/runs`)).json()).data.items).toHaveLength(1);
    await repository.claim();
    expect((await (await request(`/runs/${run.id}`)).json()).data).not.toHaveProperty('leaseToken');
  });
  test('concurrent claimers acquire different leases and cannot double claim', async () => {
    await createRun(); await createRun();
    const results = await Promise.all([repository.claim(), repository.claim(), repository.claim()]);
    const claims = results.filter((run) => run !== null);
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((run) => run.id)).size).toBe(2);
    expect(new Set(claims.map((run) => run.leaseToken)).size).toBe(2);
    expect((await database.sql`select 1 from tasks where status='PLANNING'`)).toHaveLength(2);
  });
  test('lease tokens fence stale writes; expired work recovers durably without blind replay', async () => {
    const run = await createRun();
    const claimed = await repository.claim();
    if (!claimed?.leaseToken) throw new Error('Expected lease');
    expect(await repository.save(run.id, randomUUID(), { checkpoint: initialCheckpoint() })).toBe(false);
    await database.sql`update workflow_runs set lease_expires_at=now()-interval '1 second' where id=${run.id}`;
    expect(await repository.heartbeat(run.id, claimed.leaseToken)).toBe(false);
    expect(await repository.save(run.id, claimed.leaseToken, { status: 'WAITING_APPROVAL' })).toBe(false);
    const restarted = new WorkflowRepository(database);
    expect(await restarted.recover()).toBe(1);
    const recovered = await restarted.get(run.id);
    expect(recovered?.status).toBe('BLOCKED');
    expect(recovered?.checkpoint.stopReason).toBe('RECOVERY_REQUIRED');
    expect(await restarted.claim()).toBeNull();
    expect((await request(`/runs/${run.id}/control`, 'POST', { action: 'resume', expectedVersion: recovered?.version })).status).toBe(409);
    expect(await restarted.recover()).toBe(0);
  });
  test('pause and resume preserve checkpoint, cancellation rejects worker and stale version', async () => {
    const run = await createRun();
    const paused = await (await request(`/runs/${run.id}/control`, 'POST', { action: 'pause', expectedVersion: run.version })).json();
    expect(paused.data.status).toBe('PAUSED');
    expect(await repository.claim()).toBeNull();
    expect((await request(`/runs/${run.id}/control`, 'POST', { action: 'resume', expectedVersion: run.version })).status).toBe(409);
    const resumed = await (await request(`/runs/${run.id}/control`, 'POST', { action: 'resume', expectedVersion: paused.data.version })).json();
    expect(resumed.data.status).toBe('QUEUED');
    const claimed = await repository.claim();
    if (!claimed?.leaseToken) throw new Error('Expected lease');
    const cancelled = await request(`/runs/${run.id}/control`, 'POST', { action: 'cancel', expectedVersion: claimed.version });
    expect(cancelled.status).toBe(200);
    expect(await repository.save(run.id, claimed.leaseToken, { status: 'WAITING_APPROVAL' })).toBe(false);
    expect(await repository.heartbeat(run.id, claimed.leaseToken)).toBe(false);
    expect((await database.sql`select status from tasks where id=${run.taskId}`)[0].status).toBe('CANCELLED');
  });
  test('owner acceptance requires same SHA, executed checks, QA, and single consumption', async () => {
    const run = await createRun();
    const claimed = await repository.claim();
    if (!claimed?.leaseToken) throw new Error('Expected lease');
    expect(await repository.save(run.id, claimed.leaseToken, { status: 'WAITING_APPROVAL', checkpoint: acceptedCheckpoint() })).toBe(true);
    const waiting = await repository.get(run.id);
    expect((await database.sql`select status from tasks where id=${run.taskId}`)[0].status).toBe('APPROVAL_REQUIRED');
    expect((await request(`/runs/${run.id}/accept`, 'POST', { expectedVersion: waiting?.version, candidateSha: 'b'.repeat(40) })).status).toBe(409);
    const body = { expectedVersion: waiting?.version, candidateSha: SHA };
    expect((await request(`/runs/${run.id}/accept`, 'POST', body, { 'X-CSRF-Token': '' })).status).toBe(403);
    const results = await Promise.all([request(`/runs/${run.id}/accept`, 'POST', body), request(`/runs/${run.id}/accept`, 'POST', body)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await database.sql`select 1 from workflow_acceptances where run_id=${run.id}`)).toHaveLength(1);
    expect((await repository.get(run.id))?.status).toBe('SUCCEEDED');
    expect((await database.sql`select status from tasks where id=${run.taskId}`)[0].status).toBe('COMPLETED');
    const events = await database.sql`select type from agent_events where workflow_run_id=${run.id}`;
    expect(events.filter((event) => event.type === 'agent.completed')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'approval.resolved')).toHaveLength(1);
  });
  test('cancellation after QA fences acceptance and preserves validated artifacts', async () => {
    const run = await createRun(); const claimed = await repository.claim();
    if (!claimed?.leaseToken) throw new Error('Expected lease');
    await repository.save(run.id, claimed.leaseToken, { status: 'WAITING_APPROVAL', checkpoint: acceptedCheckpoint() });
    const waiting = await repository.get(run.id);
    const cancelled = await (await request(`/runs/${run.id}/control`, 'POST', { action: 'cancel', expectedVersion: waiting?.version })).json();
    expect(cancelled.data.status).toBe('CANCELLED');
    expect(cancelled.data.checkpoint.verification.sha).toBe(SHA);
    expect((await request(`/runs/${run.id}/accept`, 'POST', { candidateSha: SHA, expectedVersion: cancelled.data.version })).status).toBe(409);
    expect(await repository.save(run.id, claimed.leaseToken, { status: 'WAITING_APPROVAL' })).toBe(false);
    expect((await database.sql`select 1 from workflow_acceptances where run_id=${run.id}`)).toHaveLength(0);
  });
  test('revoked owner session cannot accept a valid candidate', async () => {
    const run = await createRun(); const claimed = await repository.claim();
    if (!claimed?.leaseToken) throw new Error('Expected lease');
    await repository.save(run.id, claimed.leaseToken, { status: 'WAITING_APPROVAL', checkpoint: acceptedCheckpoint() });
    const waiting = await repository.get(run.id);
    await database.sql`update sessions set revoked_at=now() where organization_id=${ORG}`;
    expect((await request(`/runs/${run.id}/accept`, 'POST', { candidateSha: SHA, expectedVersion: waiting?.version })).status).toBe(401);
    expect((await repository.get(run.id))?.status).toBe('WAITING_APPROVAL');
  });
  test('stage and failure updates are durably mapped to task status with original Korean retained', async () => {
    const run = await createRun(); const claimed = await repository.claim();
    if (!claimed?.leaseToken) throw new Error('Expected lease');
    const checkpoint = { ...initialCheckpoint(), roles: [evidence('PM')], stage: 'DEVELOPER' as const };
    await repository.save(run.id, claimed.leaseToken, { checkpoint });
    let task = (await database.sql`select status,spec_en,command_original_ko from tasks where id=${run.taskId}`)[0];
    expect(task.status).toBe('IN_PROGRESS'); expect(task.spec_en).toBe('Implement addition.'); expect(task.command_original_ko).toBe(run.commandOriginalKo);
    await repository.save(run.id, claimed.leaseToken, { checkpoint: { ...checkpoint, stage: 'QA' } });
    task = (await database.sql`select status from tasks where id=${run.taskId}`)[0]; expect(task.status).toBe('REVIEW');
    await repository.save(run.id, claimed.leaseToken, { status: 'FAILED', checkpoint: { ...checkpoint, stopReason: 'REWORK_LIMIT' } });
    task = (await database.sql`select status from tasks where id=${run.taskId}`)[0]; expect(task.status).toBe('FAILED');
    expect((await repository.get(run.id))?.leaseToken).toBeNull();
  });
  test('active pause resumes only after exact worker stop acknowledgement; cancellation remains terminal', async () => {
    const run = await createRun(); const claimed = await repository.claim();
    if (!claimed?.leaseToken) throw new Error('Expected lease');
    const checkpoint = { ...initialCheckpoint(), activeThreadId: 'thread-active', activeTurnId: 'turn-active' };
    await repository.save(run.id, claimed.leaseToken, { checkpoint });
    const active = await repository.get(run.id);
    expect((await request(`/runs/${run.id}/control`, 'POST', { action: 'pause', expectedVersion: active?.version })).status).toBe(200);
    const paused = await repository.get(run.id);
    expect((await request(`/runs/${run.id}/control`, 'POST', { action: 'resume', expectedVersion: paused?.version })).status).toBe(409);
    expect(await repository.acknowledgeStop(run.id, randomUUID())).toBe(false);
    expect(await repository.acknowledgeStop(run.id, claimed.leaseToken)).toBe(true);
    expect(await repository.acknowledgeStop(run.id, claimed.leaseToken)).toBe(false);
    const acknowledged = await repository.get(run.id);
    expect(acknowledged?.status).toBe('PAUSED');
    expect(acknowledged?.checkpoint.activeTurnId).toBeNull();
    expect((await request(`/runs/${run.id}/control`, 'POST', { action: 'resume', expectedVersion: paused?.version })).status).toBe(409);
    expect((await request(`/runs/${run.id}/control`, 'POST', { action: 'resume', expectedVersion: acknowledged?.version })).status).toBe(200);
    const next = await repository.claim();
    if (!next?.leaseToken) throw new Error('Expected next lease');
    await request(`/runs/${run.id}/control`, 'POST', { action: 'cancel', expectedVersion: next.version });
    expect(await repository.acknowledgeStop(run.id, claimed.leaseToken)).toBe(false);
    expect(await repository.acknowledgeStop(run.id, next.leaseToken)).toBe(true);
    expect((await repository.get(run.id))?.status).toBe('CANCELLED');
  });
  test.each(['test', 'build', 'sandbox', 'qa', 'developer', 'pm'] as const)('acceptance rejects missing or failed %s evidence', async (broken) => {
    const run = await createRun(); const claimed = await repository.claim();
    if (!claimed?.leaseToken) throw new Error('Expected lease');
    const checkpoint = acceptedCheckpoint();
    if (broken === 'test' && checkpoint.verification) checkpoint.verification.test.exitCode = 1;
    if (broken === 'build' && checkpoint.verification) checkpoint.verification.build.exitCode = 1;
    if (broken === 'sandbox' && checkpoint.verification) checkpoint.verification.sandbox.networkDisabled = false;
    if (broken === 'qa') checkpoint.roles[2].output.verdict = 'FAIL';
    if (broken === 'developer') checkpoint.roles = checkpoint.roles.filter((role) => role.role !== 'DEVELOPER');
    if (broken === 'pm') checkpoint.roles = checkpoint.roles.filter((role) => role.role !== 'PM');
    await repository.save(run.id, claimed.leaseToken, { checkpoint, status: 'WAITING_APPROVAL' });
    const waiting = await repository.get(run.id);
    expect((await request(`/runs/${run.id}/accept`, 'POST', { candidateSha: SHA, expectedVersion: waiting?.version })).status).toBe(409);
    expect((await repository.get(run.id))?.status).toBe('WAITING_APPROVAL');
  });
  test('unconfirmed stop with null thread IDs blocks resume and all new claims', async () => {
    const run = await createRun();
    const claimed = await repository.claim();
    if (!claimed?.leaseToken) throw new Error('Expected lease');
    expect(await repository.save(run.id, claimed.leaseToken, { status: 'BLOCKED', checkpoint: { ...claimed.checkpoint, stopReason: 'STOP_UNVERIFIABLE', activeThreadId: null, activeTurnId: null } })).toBe(true);
    const blocked = await repository.get(run.id);
    if (!blocked) throw new Error('Expected run');
    const visible = await (await request(`/runs/${run.id}`)).json();
    expect(visible.data.resumable).toBe(false);
    expect((await request(`/runs/${run.id}/control`, 'POST', { action: 'resume', expectedVersion: blocked.version })).status).toBe(409);
    await createRun();
    expect(await repository.claim()).toBeNull();
    expect((await request(`/runs/${run.id}/control`, 'POST', { action: 'cancel', expectedVersion: blocked.version })).status).toBe(200);
    expect((await repository.get(run.id))?.checkpoint.stopReason).toBe('STOP_UNVERIFIABLE');
    expect(await new WorkflowRepository(database).claim()).toBeNull();
  });
  test('organization scope applies to reads and controls', async () => {
    const run = await createRun();
    const foreignOrg = randomUUID(), foreignUser = randomUUID(), token = Buffer.from(randomUUID() + randomUUID()).toString('base64url').slice(0, 43), csrfToken = 's'.repeat(43);
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    await database.sql`insert into organizations (id,name) values (${foreignOrg},'Other')`;
    await database.sql`insert into users (id,external_subject,display_name) values (${foreignUser},${foreignUser},'Other owner')`;
    await database.sql`insert into memberships (id,organization_id,user_id,role) values (${randomUUID()},${foreignOrg},${foreignUser},'OWNER')`;
    await database.sql`insert into sessions (id,organization_id,user_id,token_hash,csrf_hash,expires_at) values (${randomUUID()},${foreignOrg},${foreignUser},${digest(token)},${digest(csrfToken)},now()+interval '1 hour')`;
    const headers = { Cookie: `pixel_session=${token}; pixel_csrf=${csrfToken}`, 'X-CSRF-Token': csrfToken };
    expect((await request(`/runs/${run.id}`, 'GET', undefined, headers)).status).toBe(404);
    expect((await request(`/tasks/${run.taskId}/runs`, 'GET', undefined, headers)).status).toBe(404);
    expect((await request(`/runs/${run.id}/control`, 'POST', { action: 'cancel', expectedVersion: run.version }, headers)).status).toBe(404);
  });
});
