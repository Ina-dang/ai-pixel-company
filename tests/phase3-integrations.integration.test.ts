import { createHash, createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createDatabase, migrateDatabase } from '@ai-pixel/db';
import { hash as passwordHash } from '@node-rs/argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp, initializeOwner } from '../apps/api/src/app.js';
import { IntegrationService } from '../apps/api/src/integrations.js';
import { initialCheckpoint } from '../packages/agents/src/types.js';

const ORG = '11111111-1111-4111-8111-111111111111', USER = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'http://127.0.0.1:3000', SECRET = 'phase3-integration-login-fixture', SIGNING = 'phase3-signing-fixture';
const FILES = [
  { path: 'package.json', content: '{"name":"owned-fixture","type":"module"}\n' },
  { path: 'build.mjs', content: 'console.log("trusted fixture build");\n' },
  { path: 'test/math.test.mjs', content: 'import assert from "node:assert/strict";\n' },
  { path: 'src/math.mjs', content: 'export const add=(a,b)=>a+b;\nexport const sum=(xs)=>xs.reduce(add,0);\n' },
].sort((a, b) => a.path.localeCompare(b.path, 'en'));
const MANIFEST = createHash('sha256').update(JSON.stringify(FILES)).digest('hex'), BASE = '1'.repeat(40), COMMIT = '3'.repeat(40);
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/(?:^|[_-])test(?:$|[_-])/.test(decodeURIComponent(new URL(databaseUrl).pathname.slice(1))) || databaseUrl === process.env.DATABASE_URL) throw new Error('Phase 3 integrations require a separate test database.');
const database = createDatabase(databaseUrl);
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const originalEnvironment = { key: process.env.AI_PIXEL_GITHUB_PRIVATE_KEY, hook: process.env.AI_PIXEL_GITHUB_WEBHOOK_SECRET, token: process.env.AI_PIXEL_SLACK_BOT_TOKEN, signing: process.env.AI_PIXEL_SLACK_SIGNING_SECRET };
let app: ReturnType<typeof createApp>, service: IntegrationService, projectId: string, runId: string, githubId: string, slackId: string, cookie = '', csrf = '', secretHash = '';
let mode: 'success' | 'unknown' | 'rate' | 'revoked' | 'base-mismatch' | 'revoke-during-push' | 'confirm-unavailable' = 'success';
let confirmationFails = false;
let remoteHead = BASE;
let baseHead = BASE, mergeDraft = true, mergeable = true, ciPass = true, merged = false, mergeTimeout = false, protectedBranch = false, ciEvidenceId = 1, rules: unknown[] = [];
let calls: Array<{ path: string; method: string }> = [];
let issues: Array<Record<string, unknown>> = [];
let slackMessages: Array<{ channel: string; text: string; client_msg_id: string; unfurl_links: boolean; parse: string; link_names: boolean }> = [];
const respond = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const fetcher: typeof fetch = async (url, init = {}) => {
  const parsed = new URL(String(url)), path = parsed.pathname + parsed.search, method = init.method ?? 'GET';
  expect(['https://api.github.com', 'https://slack.com']).toContain(parsed.origin);
  calls.push({ path, method });
  if (path.endsWith('/access_tokens')) return respond({ token: 'test-installation-token' });
  if (path === '/repos/Ina-dang/ai-pixel-company') return respond({ id: 34, full_name: 'Ina-dang/ai-pixel-company' });
  if (path === '/api/auth.test') return respond({ ok: true, team_id: 'T123', user_id: 'U456' });
  if (mode === 'rate') return respond({}, 429, { 'retry-after': '90' });
  if (mode === 'revoked') return respond({ message: 'not exposed provider detail' }, 403);
  const body = init.body ? JSON.parse(String(init.body)) : {};
  if (path === '/repos/Ina-dang/ai-pixel-company/branches/main') return respond({ commit: { sha: baseHead }, protected: protectedBranch });
  if (path === '/repos/Ina-dang/ai-pixel-company/rules/branches/main') return respond(rules);
  if (path === '/repos/Ina-dang/ai-pixel-company/pulls/9' && method === 'GET') return respond({ number: 9, state: merged ? 'closed' : 'open', merged, merge_commit_sha: merged ? '9'.repeat(40) : null,
    draft: mergeDraft, mergeable, mergeable_state: mergeable ? 'clean' : 'blocked', head: { ref: `ai-pixel/${runId}`, sha: remoteHead, repo: { id: 34 } }, base: { ref: 'main', sha: baseHead, repo: { id: 34 } } });
  if (path === '/repos/Ina-dang/ai-pixel-company/pulls/9/merge') {
    expect(method).toBe('PUT'); expect(body).toEqual({ sha: COMMIT, merge_method: 'squash' });
    merged = true; if (mergeTimeout) throw new Error('controlled merge timeout after remote effect');
    return respond({ merged: true, sha: '9'.repeat(40) });
  }
  if (path.endsWith('/issues') && method === 'POST') {
    const result = { number: 8, html_url: 'https://github.com/Ina-dang/ai-pixel-company/issues/8', body: body.body }; issues.push(result);
    if (mode === 'unknown') throw new Error('simulated timeout after remote creation');
    return respond(result);
  }
  if (path.includes('/issues?')) return respond(issues);
  if (path.includes('/git/ref/heads/main')) return respond({ object: { sha: BASE } });
  if (path.includes('/git/ref/heads/ai-pixel/')) { if (confirmationFails) throw new Error('simulated confirmation timeout'); return respond({ object: { sha: remoteHead } }); }
  if (path.includes('/contents/')) { const file = FILES.find(item => path.includes(`/contents/${item.path}?`)); return respond({ encoding: 'base64', content: Buffer.from(mode === 'base-mismatch' ? 'different immutable base' : file?.content ?? '').toString('base64') }); }
  if (path.endsWith('/git/refs') && method === 'POST') return respond({ object: { sha: BASE } });
  if (path.endsWith('/git/blobs')) return respond({ sha: 'b'.repeat(40) });
  if (path.endsWith('/git/trees')) { if (mode === 'revoke-during-push') await database.sql`update workflow_runs set version=version+1,status='PAUSED' where id=${runId}`; return respond({ sha: 'c'.repeat(40) }); }
  if (path.endsWith('/git/commits') && method === 'POST') return respond({ sha: COMMIT });
  if (path.includes('/git/commits/')) return respond({ tree: { sha: 'c'.repeat(40) }, message: 'remote commit', parents: [{ sha: BASE }] });
  if (path.includes('/git/refs/heads/ai-pixel/') && method === 'PATCH') { remoteHead = body.sha; if (mode === 'confirm-unavailable') confirmationFails = true; expect(body.force).toBe(false); return respond({ object: { sha: remoteHead } }); }
  if (path.endsWith('/pulls') && method === 'POST') { expect(body.draft).toBe(true); return respond({ number: 9, html_url: 'https://github.com/Ina-dang/ai-pixel-company/pull/9', head: { sha: remoteHead }, base: { ref: 'main' } }); }
  if (path.includes('/check-runs?')) return respond({ check_runs: [{ id: ciEvidenceId, name: 'unit', head_sha: remoteHead, status: 'completed', conclusion: ciPass ? 'success' : 'failure' }] });
  if (path.includes('/status?')) return respond({ statuses: [] });
  if (path === '/api/chat.postMessage') { slackMessages.push(body); if (mode === 'unknown') throw new Error('unknown Slack send'); return respond({ ok: true, channel: 'C123', ts: '1234567890.000001' }); }
  throw new Error(`Unexpected controlled transport path: ${method} ${path}`);
};
async function request(path: string, body?: unknown) {
  return app.request(`http://127.0.0.1:3001/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: ORIGIN, 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function operation(kind: string, expected = 202) {
  const response = await request(`/projects/${projectId}/integrations/operations`, { kind, runId, expectedRunVersion: 1 });
  expect(response.status).toBe(expected); return response.json();
}
async function status() { const response = await request(`/projects/${projectId}/integrations`); expect(response.status).toBe(200); return (await response.json()).data; }
async function processed(kind: string) { const result = await operation(kind); await service.processOnce(); return (await status()).operations.find((row: { id: string }) => row.id === result.data.id); }
async function githubHook(delivery: string, head = COMMIT, signature = true, repositoryId = 34) {
  const raw = JSON.stringify({ action: 'completed', installation: { id: 12 }, repository: { id: repositoryId }, check_run: { head_sha: head } });
  return app.request(`http://127.0.0.1:3001/api/webhooks/github/${githubId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'check_run', 'X-GitHub-Delivery': delivery,
    'X-Hub-Signature-256': signature ? `sha256=${createHmac('sha256', SIGNING).update(raw).digest('hex')}` : 'sha256=invalid' }, body: raw });
}
beforeAll(async () => {
  await migrateDatabase(database); secretHash = await passwordHash(SECRET);
  process.env.AI_PIXEL_GITHUB_PRIVATE_KEY = privateKey; process.env.AI_PIXEL_GITHUB_WEBHOOK_SECRET = SIGNING;
  process.env.AI_PIXEL_SLACK_BOT_TOKEN = 'test-bot-token'; process.env.AI_PIXEL_SLACK_SIGNING_SECRET = SIGNING;
});
beforeEach(async () => {
  await database.sql`truncate organizations,users cascade`; await initializeOwner(database);
  projectId = randomUUID(); runId = randomUUID(); githubId = randomUUID(); slackId = randomUUID(); const taskId = randomUUID();
  remoteHead = BASE; baseHead = BASE; mergeDraft = true; mergeable = true; ciPass = true; merged = false; mergeTimeout = false; protectedBranch = false; ciEvidenceId = 1; rules = [];
  calls = []; issues = []; slackMessages = []; mode = 'success'; confirmationFails = false;
  const checkpoint = { ...initialCheckpoint(), stage: 'QA', workspace: { sha: MANIFEST, diff: '+fixed addition', files: FILES },
    verification: { sha: MANIFEST, test: { exitCode: 0, output: 'passed' }, build: { exitCode: 0, output: '' }, sandbox: { networkDisabled: true, readOnlyRoot: true, resourceLimited: true }, verifiedAt: new Date().toISOString() },
    roles: [{ role: 'QA', threadId: 'controlled-role-evidence', turnId: null, candidateSha: MANIFEST, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, completedAt: new Date().toISOString(), output: { summaryKo: '검토 완료', specEn: '', acceptanceCriteria: [], files: [], verdict: 'PASS', candidateSha: MANIFEST, issues: [] } }] };
  await database.sql.begin(async tx => {
    await tx`insert into projects(id,organization_id,name,repository_url) values(${projectId},${ORG},'연동 검증','https://github.com/Ina-dang/ai-pixel-company.git')`;
    await tx`insert into tasks(id,organization_id,project_id,title,command_original_ko,command_hash,acceptance_criteria,status,created_by)
      values(${taskId},${ORG},${projectId},'실제 결과 보고','코드를 검증해 주세요.',${createHash('sha256').update('코드를 검증해 주세요.').digest('hex')},${tx.json([{ id: 'AC-1', descriptionKo: '검증된 결과만 게시한다', method: 'integration-test', required: true }])},'APPROVAL_REQUIRED',${USER})`;
    await tx`insert into workflow_runs(id,organization_id,project_id,task_id,command_original_ko,status,checkpoint)
      values(${runId},${ORG},${projectId},${taskId},'코드를 검증해 주세요.','WAITING_APPROVAL',${tx.json(JSON.parse(JSON.stringify(checkpoint)))})`;
    await tx`insert into integration_connections(id,organization_id,project_id,provider,config,secret_refs) values
      (${githubId},${ORG},${projectId},'GITHUB',${tx.json({ appId: '123', installationId: 12, repositoryId: 34, owner: 'Ina-dang', repo: 'ai-pixel-company', baseBranch: 'main', requiredChecks: ['unit'], policyVersion: 'v1' })},${tx.json({ privateKey: 'env:AI_PIXEL_GITHUB_PRIVATE_KEY', webhookSecret: 'env:AI_PIXEL_GITHUB_WEBHOOK_SECRET' })}),
      (${slackId},${ORG},${projectId},'SLACK',${tx.json({ teamId: 'T123', channelId: 'C123', userMappings: { U123: USER } })},${tx.json({ botToken: 'env:AI_PIXEL_SLACK_BOT_TOKEN', signingSecret: 'env:AI_PIXEL_SLACK_SIGNING_SECRET' })})`;
  });
  service = new IntegrationService(database, process.cwd(), fetcher);
  app = createApp({ database, integrations: service, config: { appOrigin: ORIGIN, bootstrapSecretHash: secretHash, sessionTtlSeconds: 3600, cookieSecure: false, ssePollMs: 10, sseHeartbeatMs: 100, sseBatchSize: 1000, sseRetentionDays: 30, loginMaxAttempts: 100, loginWindowMs: 60_000 } });
  const login = await app.request('http://127.0.0.1:3001/api/v1/auth/session', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET }) });
  expect(login.status).toBe(200); const payload = await login.json(); csrf = payload.data.csrfToken; cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
});
afterAll(async () => {
  for (const [name, value] of Object.entries({ AI_PIXEL_GITHUB_PRIVATE_KEY: originalEnvironment.key, AI_PIXEL_GITHUB_WEBHOOK_SECRET: originalEnvironment.hook, AI_PIXEL_SLACK_BOT_TOKEN: originalEnvironment.token, AI_PIXEL_SLACK_SIGNING_SECRET: originalEnvironment.signing })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  await database.close();
});

describe('Phase 3 durable integration boundaries', () => {
  test('honest unconfigured status does not expose secret refs, keys or ambient credentials', async () => {
    delete process.env.AI_PIXEL_GITHUB_PRIVATE_KEY;
    try { const result = await status(); expect(result.connections.find((c: { provider: string }) => c.provider === 'GITHUB')).toMatchObject({ configured: false, reason: 'CREDENTIAL_UNCONFIGURED' });
      expect(JSON.stringify(result)).not.toContain('secret_refs'); expect(JSON.stringify(result)).not.toContain(privateKey); expect(calls).toEqual([]);
    } finally { process.env.AI_PIXEL_GITHUB_PRIVATE_KEY = privateKey; }
  });
  test('requires exact run version, verified evidence, CSRF and project scope before dispatch', async () => {
    const noCsrf = await app.request(`http://127.0.0.1:3001/api/v1/projects/${projectId}/integrations/operations`, { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ kind: 'ISSUE_CREATE', runId, expectedRunVersion: 1 }) }); expect(noCsrf.status).toBe(403);
    const stale = await request(`/projects/${projectId}/integrations/operations`, { kind: 'ISSUE_CREATE', runId, expectedRunVersion: 2 }); expect(stale.status).toBe(409);
    const other = await request(`/projects/${randomUUID()}/integrations/operations`, { kind: 'ISSUE_CREATE', runId, expectedRunVersion: 1 }); expect(other.status).toBe(409);
    await database.sql`update workflow_runs set checkpoint=jsonb_set(checkpoint,'{verification,test,exitCode}','1'::jsonb) where id=${runId}`;
    await operation('ISSUE_CREATE', 409); expect(calls).toEqual([]);
  });
  test('outbound readiness remains available without accepting unsigned inbound webhooks', async () => {
    delete process.env.AI_PIXEL_GITHUB_WEBHOOK_SECRET;
    try {
      const result = await status();
      expect(result.connections.find((c: { provider: string }) => c.provider === 'GITHUB')).toMatchObject({ configured: true, webhookConfigured: false, reason: null });
      expect((await githubHook(randomUUID(), COMMIT)).status).toBe(409);
      expect(calls).toEqual([]);
    } finally { process.env.AI_PIXEL_GITHUB_WEBHOOK_SECRET = SIGNING; }
  });
  test('accepts real App ping shape only with valid signature and the configured hook App ID', async () => {
    async function ping(appId: number, signed = true) {
      const raw = JSON.stringify({ zen: 'test', hook_id: 1, hook: { app_id: appId } });
      return app.request(`http://127.0.0.1:3001/api/webhooks/github/${githubId}`, { method: 'POST', body: raw,
        headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'ping', 'X-GitHub-Delivery': randomUUID(),
          'X-Hub-Signature-256': signed ? `sha256=${createHmac('sha256', SIGNING).update(raw).digest('hex')}` : 'sha256=invalid' } });
    }
    expect((await ping(123, false)).status).toBe(403);
    expect((await ping(999)).status).toBe(403);
    expect((await ping(123)).status).toBe(202);
    const records = await database.sql`select event_type from integration_inbox where connection_id=${githubId}`;
    expect(records).toHaveLength(1); expect(records[0].event_type).toBe('ping');
    expect(calls).toEqual([]);
  });
  test('authenticates raw webhook bytes, scopes installation/repository and durably deduplicates deliveries', async () => {
    const delivery = randomUUID(); expect((await githubHook(delivery, COMMIT, false)).status).toBe(403);
    expect((await githubHook(delivery, COMMIT, true, 999)).status).toBe(403);
    expect((await githubHook(delivery)).status).toBe(202);
    expect(await (await githubHook(delivery)).json()).toMatchObject({ duplicate: true });
    expect((await githubHook(delivery, BASE)).status).toBe(409);
    const receipts = await database.sql`select * from integration_inbox`; expect(receipts).toHaveLength(1); expect(receipts[0].status).toBe('RECEIVED');
    expect(calls).toEqual([]);
  });
  test('checks Slack freshness plus exact team/channel and current Owner mapping', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const send = (channel = 'C123', time = timestamp) => {
      const raw = new URLSearchParams({ team_id: 'T123', user_id: 'U123', channel_id: channel, command: '/ai-pixel', text: '상태' }).toString();
      return app.request(`http://127.0.0.1:3001/api/webhooks/slack/${slackId}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Slack-Request-Timestamp': time,
        'X-Slack-Signature': `v0=${createHmac('sha256', SIGNING).update(`v0:${time}:${raw}`).digest('hex')}` }, body: raw });
    };
    expect((await send('C999')).status).toBe(403); expect((await send('C123', String(Number(timestamp) - 301))).status).toBe(403);
    expect((await send()).status).toBe(200); expect(await (await send()).json()).toMatchObject({ duplicate: true });
    await database.sql`update memberships set status='REVOKED' where organization_id=${ORG} and user_id=${USER}`;
    expect((await send()).status).toBe(403); expect(calls).toEqual([]);
  });
  test('a timeout remains UNKNOWN, never auto-reposts, and resolves only by a remote operation marker', async () => {
    mode = 'unknown'; const created = await processed('ISSUE_CREATE'); expect(created.status).toBe('UNKNOWN');
    expect(await service.processOnce()).toBe(false); expect(calls.filter(call => call.path.endsWith('/issues') && call.method === 'POST')).toHaveLength(1);
    await operation('ISSUE_CREATE', 409);
    mode = 'success'; const reconciled = await request(`/projects/${projectId}/integrations/operations/${created.id}/reconcile`, {});
    expect(reconciled.status).toBe(200); expect((await reconciled.json()).data).toMatchObject({ status: 'SUCCEEDED', externalRef: { number: 8 } });
    expect(calls.filter(call => call.path.endsWith('/issues') && call.method === 'POST')).toHaveLength(1);
  });
  test('429 is deferred with bounded retries; credential revocation disables the connection without failing the run', async () => {
    mode = 'rate'; const created = await processed('ISSUE_CREATE'); expect(created).toMatchObject({ status: 'DEFERRED', attempts: 1, errorCode: 'RATE_LIMITED' });
    expect(await service.processOnce()).toBe(false);
    await database.sql`update integration_operations set next_attempt_at=now()-interval '1 second' where id=${created.id}`;
    mode = 'revoked'; await service.processOnce(); const result = await status(); expect(result.operations[0]).toMatchObject({ status: 'FAILED', errorCode: 'CREDENTIAL_REVOKED', attempts: 2 });
    expect(result.connections.find((c: { provider: string }) => c.provider === 'GITHUB').enabled).toBe(false);
    expect((await database.sql`select status from workflow_runs where id=${runId}`)[0].status).toBe('WAITING_APPROVAL');
  });
  test('publishes an isolated non-force branch/commit/draft PR and records a head-bound merge request without executing merge', async () => {
    expect((await processed('BRANCH_CREATE')).status).toBe('SUCCEEDED');
    const pushed = await processed('PUSH_CANDIDATE'); expect(pushed).toMatchObject({ status: 'SUCCEEDED', candidateSha: MANIFEST, externalRef: { candidateSha: MANIFEST, headSha: COMMIT } });
    expect((await processed('DRAFT_PR_CREATE')).externalRef).toMatchObject({ number: 9, headSha: COMMIT });
    expect((await processed('CI_REFRESH')).externalRef.status).toBe('PASS');
    const merge = await processed('MERGE_REQUEST'); expect(merge).toMatchObject({ status: 'SUCCEEDED', externalRef: { requiresOwnerApproval: true, remoteMergeExecuted: false, headSha: COMMIT, candidateSha: MANIFEST, runVersion: 1 } });
    expect(await database.sql`select id from integration_merge_requests`).toHaveLength(1);
    expect(calls.some(call => call.path.includes('/merge'))).toBe(false);
    remoteHead = '4'.repeat(40); expect(await processed('CI_REFRESH')).toMatchObject({ status: 'FAILED', errorCode: 'REMOTE_HEAD_CHANGED' });
  }, 60_000);
  test('rejects scope version changes before remote dispatch and signed reverse webhooks cannot downgrade head evidence', async () => {
    const pending = await operation('ISSUE_CREATE'); await database.sql`update integration_connections set version=2 where id=${githubId}`; await service.processOnce();
    expect((await status()).operations.find((row: { id: string }) => row.id === pending.data.id)).toMatchObject({ status: 'FAILED', errorCode: 'CONNECTION_VERSION_CHANGED' }); expect(calls).toEqual([]);
    await database.sql`update integration_connections set version=1 where id=${githubId}`;
    await processed('BRANCH_CREATE'); await processed('PUSH_CANDIDATE'); await githubHook(randomUUID(), COMMIT); await service.processOnce();
    const push = (await status()).operations.find((row: { kind: string }) => row.kind === 'PUSH_CANDIDATE'); expect(push.externalRef.ci.headSha).toBe(COMMIT);
    remoteHead = '4'.repeat(40); await githubHook(randomUUID(), COMMIT); await service.processOnce();
    const after = (await status()).operations.find((row: { kind: string }) => row.kind === 'PUSH_CANDIDATE'); expect(after.externalRef.ci.headSha).toBe(COMMIT);
    expect((await database.sql`select status from integration_inbox order by created_at desc limit 1`)[0].status).toBe('FAILED');
  });
  test('Slack send failures remain in the outbox without changing task/run completion', async () => {
    mode = 'unknown'; const report = await processed('SLACK_REPORT'); expect(report).toMatchObject({ status: 'UNKNOWN', errorCode: 'EFFECT_UNKNOWN' });
    expect(await service.processOnce()).toBe(false); expect(calls.filter(call => call.path === '/api/chat.postMessage')).toHaveLength(1);
    expect((await database.sql`select status from workflow_runs where id=${runId}`)[0].status).toBe('WAITING_APPROVAL');
    expect(JSON.stringify(await status())).not.toContain('test-bot-token');
  });
  test('Slack report uses the stored task name, evidence and detail link instead of a request title', async () => {
    const response = await request(`/projects/${projectId}/integrations/operations`, { kind: 'SLACK_REPORT', runId, expectedRunVersion: 1, title: 'Override is not the task name' });
    expect(response.status).toBe(202); await service.processOnce();
    expect(slackMessages).toHaveLength(1);
    const message = slackMessages[0]; expect(message).toMatchObject({ channel: 'C123', unfurl_links: false, parse: 'none', link_names: false });
    expect(message.text).toContain('업무명* · 실제 결과 보고'); expect(message.text).not.toContain('Override is not');
    for (const label of ['변경 요약', '검증 결과', '다음 할 일', '상세 화면']) expect(message.text).toContain(label);
    expect(message.text).toContain('테스트 통과 · 빌드 통과 · QA PASS'); expect(message.text).toContain(`project=${projectId}&task=`);
    expect((await database.sql`select status,version from workflow_runs where id=${runId}`)[0]).toMatchObject({ status: 'WAITING_APPROVAL', version: 1 });
    expect(await service.processOnce()).toBe(false); expect(slackMessages).toHaveLength(1);
  });
  test('Slack repository reporting never broadens GitHub fixture writes and requires a real admitted snapshot', async () => {
    const files = [{ path: 'src/app/page.tsx', content: 'export default function Page() { return null; }' }];
    const repositoryRunId = randomUUID();
    await database.sql`insert into workflow_runs(id,organization_id,project_id,task_id,command_original_ko,status,fixture,repository_source,checkpoint)
      select ${repositoryRunId},organization_id,project_id,task_id,command_original_ko,'SUCCEEDED','how-to-trash-v1',${database.sql.json({ profile: 'how-to-trash-v1', repositoryUrl: 'https://github.com/Ina-dang/how-to-trash.git', baseSha: BASE, admissionSha: MANIFEST, imageId: `sha256:${MANIFEST}` })},jsonb_set(checkpoint,'{workspace,files}',${database.sql.json(files)}) from workflow_runs where id=${runId}`;
    runId = repositoryRunId;
    expect((await operation('ISSUE_CREATE', 409)).error.code).toBe('CANDIDATE_MANIFEST_INVALID');
    expect((await operation('SLACK_REPORT', 409)).error.code).toBe('REPORT_MANIFEST_UNAVAILABLE');
    expect(calls).toEqual([]); expect(slackMessages).toHaveLength(0);
  });
  test('a forged candidate or changed project repository is rejected before any external request', async () => {
    await database.sql`update workflow_runs set checkpoint=jsonb_set(checkpoint,'{workspace,files,0,content}','"changed after QA"'::jsonb) where id=${runId}`;
    const forged = await operation('ISSUE_CREATE', 409); expect(forged.error.code).toBe('CANDIDATE_MANIFEST_CHANGED'); expect(calls).toEqual([]);
    await database.sql`update workflow_runs set checkpoint=jsonb_set(checkpoint,'{workspace,files}',${database.sql.json(FILES)}) where id=${runId}`;
    await database.sql`update projects set repository_url='https://github.com/Ina-dang/other-repository.git' where id=${projectId}`;
    const changed = await operation('ISSUE_CREATE', 409); expect(changed.error.code).toBe('PROJECT_REPOSITORY_CHANGED'); expect(calls).toEqual([]);
  });
  test('different remote fixture harness is never overwritten or used as matching candidate evidence', async () => {
    await processed('BRANCH_CREATE'); calls = []; mode = 'base-mismatch';
    const pushed = await processed('PUSH_CANDIDATE'); expect(pushed).toMatchObject({ status: 'FAILED', errorCode: 'REMOTE_FIXTURE_BASE_MISMATCH' });
    expect(calls.filter(call => call.method !== 'GET' && !call.path.endsWith('/access_tokens'))).toHaveLength(0);
  });
  test('mid-push workflow revocation blocks commit/ref writes and preserves an unknown multi-step outcome', async () => {
    await processed('BRANCH_CREATE'); calls = []; mode = 'revoke-during-push';
    const pushed = await processed('PUSH_CANDIDATE'); expect(pushed).toMatchObject({ status: 'UNKNOWN', errorCode: 'EFFECT_UNKNOWN' });
    expect(calls.some(call => call.path.endsWith('/git/commits') && call.method === 'POST')).toBe(false);
    expect(calls.some(call => call.method === 'PATCH')).toBe(false); expect(remoteHead).toBe(BASE);
  });
  test('a successful ref update followed by a failed read stays UNKNOWN and cannot be blindly reissued', async () => {
    await processed('BRANCH_CREATE'); mode = 'confirm-unavailable';
    const pushed = await processed('PUSH_CANDIDATE'); expect(pushed).toMatchObject({ status: 'UNKNOWN', errorCode: 'EFFECT_UNKNOWN' }); expect(remoteHead).toBe(COMMIT);
    confirmationFails = false; mode = 'success'; await operation('PUSH_CANDIDATE', 409);
    expect(calls.filter(call => call.method === 'PATCH')).toHaveLength(1);
  });
});

async function slackCommand(text: string, trigger = randomUUID()) {
  const raw = new URLSearchParams({ team_id: 'T123', user_id: 'U123', channel_id: 'C123', command: '/ai-pixel', text, trigger_id: trigger,
    response_url: 'https://hooks.slack.com/commands/private-response-secret' }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  return app.request(`http://127.0.0.1:3001/api/webhooks/slack/${slackId}`, { method: 'POST', body: raw, headers: {
    'Content-Type': 'application/x-www-form-urlencoded', 'X-Slack-Request-Timestamp': timestamp,
    'X-Slack-Signature': `v0=${createHmac('sha256', SIGNING).update(`v0:${timestamp}:${raw}`).digest('hex')}`,
  } });
}
async function mergeFixture() {
  mergeDraft = false;
  await database.sql`update workflow_runs set status='SUCCEEDED' where id=${runId}`;
  for (const kind of ['BRANCH_CREATE', 'PUSH_CANDIDATE', 'DRAFT_PR_CREATE', 'MERGE_REQUEST']) expect((await processed(kind)).status).toBe('SUCCEEDED');
  return (await status()).mergeRequests[0];
}
async function mergeAction(row: { id: string; version: number; scopeHash: string }, action: string) {
  const response = await request(`/projects/${projectId}/integrations/merges/${row.id}/${action}`, { expectedVersion: row.version, scopeHash: row.scopeHash });
  return { status: response.status, ...(await response.json()) };
}
describe('Phase 3 Slack commands and explicit merge execution', () => {
  test('preserves Korean original and creates one TODO through the shared command, never auto-starting work', async () => {
    const original = '  실제 업무 원문\n공백과 줄바꿈을 보존해 주세요.  ', trigger = randomUUID();
    expect((await slackCommand(`업무 ${original}`, trigger)).status).toBe(200);
    expect((await (await slackCommand(`업무 ${original}`, trigger)).json()).duplicate).toBe(true);
    expect(calls).toEqual([]); // ACK does not wait on Slack or a model.
    await service.processOnce(); await service.processOnce();
    const tasks = await database.sql`select * from tasks where source='SLACK'`;
    expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ command_original_ko: original, title: '실제 업무 원문', status: 'TODO', created_by: USER });
    expect(await database.sql`select id from workflow_runs`).toHaveLength(1);
    const receipts = await database.sql`select * from integration_inbox where provider='SLACK'`;
    expect(receipts[0]).toMatchObject({ status: 'PROCESSED', reply_status: 'SENT', result: { taskId: tasks[0].id } });
    expect(JSON.stringify(receipts)).not.toContain('response-secret'); expect(JSON.stringify(receipts)).not.toContain('hooks.slack.com');
    expect(calls.filter(call => call.path === '/api/chat.postMessage')).toHaveLength(1);
    expect(slackMessages[0].text).toContain('업무명* · 실제 업무 원문');
    expect(slackMessages[0].text).toContain('검증 결과* · 미실행');
    expect(slackMessages[0].text).toContain(`task=${tasks[0].id}#task-inspector`);
    expect((await status()).commands[0].result.taskId).toBe(tasks[0].id);
  });
  test('rechecks queued Slack mapping version and current Owner membership before creating a task', async () => {
    await slackCommand('task 연결 변경 후 실행하면 안 됨');
    await database.sql`update integration_connections set version=version+1 where id=${slackId}`;
    await service.processOnce();
    expect(await database.sql`select id from tasks where source='SLACK'`).toHaveLength(0);
    expect((await status()).commands[0]).toMatchObject({ status: 'FAILED', errorCode: 'SLACK_MAPPING_CHANGED' });
    expect(calls).toEqual([]);
  });
  test('unsupported approval commands and secrets are rejected, while help/status use the durable reply path', async () => {
    expect((await slackCommand('merge approve all')).status).toBe(400);
    expect((await slackCommand(`업무 xoxb-${'a'.repeat(30)}`)).status).toBe(400);
    for (const text of ['도움말', '상태']) { expect((await slackCommand(text)).status).toBe(200); await service.processOnce(); await service.processOnce(); }
    expect((await status()).commands).toHaveLength(2);
    expect(calls.filter(call => call.path === '/api/chat.postMessage')).toHaveLength(2);
    expect(calls.some(call => call.path.includes('/merge'))).toBe(false);
    expect(slackMessages[1].text).toContain('업무명* · 실제 결과 보고');
    expect(slackMessages[1].text).toContain('검증 결과* · 테스트 통과 · 빌드 통과 · QA PASS');
    expect(slackMessages[1].text).toContain('다음 할 일'); expect(slackMessages[1].text).toContain('#task-inspector');
  });
  test('a queued Slack task loses authority when its mapped Owner membership is revoked', async () => {
    await slackCommand('업무 권한 철회 후 등록 금지');
    await database.sql`update memberships set status='REVOKED' where organization_id=${ORG} and user_id=${USER}`;
    await service.processOnce();
    expect(await database.sql`select id from tasks where source='SLACK'`).toHaveLength(0);
    expect((await database.sql`select status,error_code from integration_inbox where provider='SLACK'`)[0]).toMatchObject({ status: 'FAILED', error_code: 'SLACK_MAPPING_DENIED' });
    expect(calls).toEqual([]);
  });
  test('a possibly delivered command reply stays UNKNOWN without repeating task creation or Slack send', async () => {
    await slackCommand('업무 알림 결과 불명 시험'); await service.processOnce(); mode = 'unknown'; await service.processOnce();
    expect((await status()).commands[0]).toMatchObject({ status: 'PROCESSED', replyStatus: 'UNKNOWN' });
    expect(await service.processOnce()).toBe(false);
    expect(await database.sql`select id from tasks where source='SLACK'`).toHaveLength(1);
    expect(calls.filter(call => call.path === '/api/chat.postMessage')).toHaveLength(1);
  });
  test('requires separate Owner approval and execution; a validated scope alone never merges', async () => {
    const row = await mergeFixture();
    expect((await mergeAction(row, 'validate')).data).toMatchObject({ ready: true, remoteMergeExecuted: false });
    expect((await mergeAction(row, 'execute')).status).toBe(403);
    const approved = await mergeAction(row, 'approve'); expect(approved.status).toBe(200); expect(approved.data.status).toBe('APPROVED');
    expect(await service.processOnce()).toBe(false); expect(merged).toBe(false);
    const queued = await mergeAction(approved.data, 'execute'); expect(queued.status).toBe(202);
    await service.processOnce();
    const result = (await status()).mergeRequests[0]; expect(result).toMatchObject({ status: 'SUCCEEDED', result: { merged: true, mergeSha: '9'.repeat(40) } });
    expect(calls.filter(call => call.path.endsWith('/merge'))).toHaveLength(1);
    expect((await mergeAction(queued.data, 'execute')).status).toBe(409);
    expect(await database.sql`select id from audit_logs where action='integration.merge.executed' and actor_id=${USER}`).toHaveLength(1);
  });
  test.each(['head','base','rules','ci','ci-run','protection'] as const)('invalidates an approved scope when remote %s changes before dispatch', async kind => {
    const row = await mergeFixture(), approved = (await mergeAction(row, 'approve')).data;
    const queued = await mergeAction(approved, 'execute'); expect(queued.status).toBe(202);
    if (kind === 'head') remoteHead = '5'.repeat(40);
    if (kind === 'base') baseHead = '6'.repeat(40);
    if (kind === 'rules') rules = [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true } }];
    if (kind === 'ci') ciPass = false;
    if (kind === 'ci-run') ciEvidenceId++;
    if (kind === 'protection') protectedBranch = true;
    await service.processOnce(); expect((await status()).mergeRequests[0].status).toBe('FAILED');
    expect(calls.some(call => call.path.endsWith('/merge'))).toBe(false);
  });
  test('draft or locally unaccepted results cannot be approved and accepting a result does not grant merge authority', async () => {
    mergeDraft = true;
    for (const kind of ['BRANCH_CREATE','PUSH_CANDIDATE','DRAFT_PR_CREATE','MERGE_REQUEST']) await processed(kind);
    const row = (await status()).mergeRequests[0];
    expect((await mergeAction(row, 'validate')).data.blockers).toEqual(['RESULT_ACCEPTANCE_REQUIRED','DRAFT_PULL_REQUEST']);
    expect((await mergeAction(row, 'approve')).status).toBe(409);
    expect((await status()).mergeRequests[0].status).toBe('REQUESTED'); expect(merged).toBe(false);
  });
  test('expires or revokes approval and refuses a revoked approver session at the execution boundary', async () => {
    const row = await mergeFixture(), approved = (await mergeAction(row, 'approve')).data;
    await mergeAction(approved, 'execute');
    await database.sql`update sessions set revoked_at=now() where user_id=${USER}`;
    await service.processOnce();
    const result = (await database.sql`select status,error_code from integration_merge_requests where id=${row.id}`)[0];
    expect(result).toMatchObject({ status: 'FAILED', error_code: 'MERGE_APPROVER_REVOKED' }); expect(merged).toBe(false);
  });
  test('a cancelled or expired request cannot execute and exposes no cross-project authority', async () => {
    const row = await mergeFixture();
    const cross = await request(`/projects/${randomUUID()}/integrations/merges/${row.id}/validate`, { expectedVersion: row.version, scopeHash: row.scopeHash }); expect(cross.status).toBe(404);
    const revoked = await mergeAction(row, 'revoke'); expect(revoked.data.status).toBe('REVOKED');
    expect((await mergeAction(revoked.data, 'approve')).status).toBe(409);
    await processed('MERGE_REQUEST'); const replacement = (await status()).mergeRequests[0];
    await database.sql`update integration_merge_requests set expires_at=now()-interval '1 second' where id=${replacement.id}`;
    expect((await mergeAction(replacement, 'approve')).error.code).toBe('MERGE_APPROVAL_EXPIRED');
    expect((await status()).mergeRequests[0].status).toBe('EXPIRED'); expect(merged).toBe(false);
  });
  test('recovers an interrupted dispatch as UNKNOWN and only reads remote state for reconciliation', async () => {
    const row = await mergeFixture(), approved = (await mergeAction(row, 'approve')).data;
    await mergeAction(approved, 'execute');
    await database.sql`update integration_merge_requests set status='RUNNING' where id=${row.id}`;
    await service.merges.recover();
    const interrupted = (await status()).mergeRequests[0]; expect(interrupted.status).toBe('UNKNOWN');
    expect((await mergeAction(interrupted, 'reconcile')).data.status).toBe('UNKNOWN');
    expect(await service.processOnce()).toBe(false); expect(calls.some(call => call.path.endsWith('/merge'))).toBe(false);
  });
  test('merge timeout is UNKNOWN, is never resent after restart, and leaves task/run acceptance separate', async () => {
    const row = await mergeFixture(), approved = (await mergeAction(row, 'approve')).data;
    await mergeAction(approved, 'execute'); mergeTimeout = true; await service.processOnce();
    expect((await status()).mergeRequests[0]).toMatchObject({ status: 'UNKNOWN', errorCode: 'EFFECT_UNKNOWN' });
    await service.start(); await service.stop(); expect(await service.processOnce()).toBe(false);
    expect(calls.filter(call => call.path.endsWith('/merge'))).toHaveLength(1);
    expect((await database.sql`select status from tasks where project_id=${projectId}`)[0].status).toBe('APPROVAL_REQUIRED');
    const uncertain = (await status()).mergeRequests[0];
    expect((await mergeAction(uncertain, 'reconcile')).data).toMatchObject({ status: 'SUCCEEDED', result: { observedRemote: true } });
    expect(calls.filter(call => call.path.endsWith('/merge'))).toHaveLength(1);
  });
});

async function enableSocket() {
  await database.sql`update integration_connections set config=config||${database.sql.json({ mode: 'SOCKET', appId: 'A123' })},secret_refs=secret_refs||${database.sql.json({ appToken: 'env:AI_PIXEL_SLACK_APP_TOKEN' })} where id=${slackId}`;
}
const socketBody = (changes: Record<string, unknown> = {}) => ({ api_app_id: 'A123', team_id: 'T123', channel_id: 'C123', user_id: 'U123', command: '/ai-pixel', text: '업무 소켓 원문  공백 보존', trigger_id: 'slack-trigger-12345678', response_url: 'https://hooks.slack.com/commands/response-secret', token: 'legacy-verification-secret', ...changes });
describe('Socket Mode durable intake', () => {
  test('empty arguments persist a marked STATUS and reply with project status without changing work', async () => {
    await enableSocket();
    const before = JSON.stringify({ tasks: await database.sql`select id,status,version from tasks order by id`, runs: await database.sql`select id,status,version from workflow_runs order by id` });
    await service.receiveSocketCommand(slackId, 1, 'envelope-12345678', socketBody({ text: '' }));
    const row = (await database.sql`select payload from integration_inbox where provider='SLACK'`)[0];
    expect(row.payload.command).toEqual({ kind: 'STATUS', defaulted: true });
    await service.processOnce(); await service.processOnce();
    expect(slackMessages).toHaveLength(1);
    expect(slackMessages[0].text).toContain('업무 현황');
    expect(slackMessages[0].text).toContain('추가 인수가 없어 기본 상태 조회');
    expect(JSON.stringify({ tasks: await database.sql`select id,status,version from tasks order by id`, runs: await database.sql`select id,status,version from workflow_runs order by id` })).toBe(before);
  });
  test('same Slack trigger retried in another envelope creates one TODO, never a run or a second reply', async () => {
    await enableSocket(); const first = await service.receiveSocketCommand(slackId, 1, 'envelope-12345678', socketBody());
    const retry = await service.receiveSocketCommand(slackId, 1, 'envelope-87654321', socketBody()); expect(first.duplicate).toBe(false); expect(retry.duplicate).toBe(true);
    const rows = await database.sql`select * from integration_inbox where provider='SLACK'`; expect(rows).toHaveLength(1); expect(rows[0].payload.transport).toBe('SOCKET');
    expect(JSON.stringify(rows)).not.toContain('response-secret'); expect(JSON.stringify(rows)).not.toContain('legacy-verification-secret');
    await service.processOnce(); await service.processOnce(); expect(await service.processOnce()).toBe(false);
    const tasks = await database.sql`select * from tasks where source='SLACK'`; expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ status: 'TODO', command_original_ko: '소켓 원문  공백 보존', project_id: projectId });
    expect(await database.sql`select id from workflow_runs`).toHaveLength(1); expect(slackMessages).toHaveLength(1);
    expect((await slackCommand('상태')).status).toBe(409); // Socket mode never accepts the parallel HTTP ingress.
  });
  test.each([{ team_id: 'T999' }, { channel_id: 'C999' }, { user_id: 'U999' }, { api_app_id: 'A999' }, { command: '/other' }])('rejects wrong socket scope %j before receipt creation', async changes => {
    await enableSocket(); await expect(service.receiveSocketCommand(slackId, 1, 'envelope-12345678', socketBody(changes))).rejects.toThrow();
    expect(await database.sql`select id from integration_inbox`).toHaveLength(0); expect(calls).toHaveLength(0);
  });
  test('conflicting retry, revoked Owner and changed connection version fail closed', async () => {
    await enableSocket(); await service.receiveSocketCommand(slackId, 1, 'envelope-12345678', socketBody());
    await expect(service.receiveSocketCommand(slackId, 1, 'envelope-87654321', socketBody({ text: '업무 다른 내용' }))).rejects.toThrow('DELIVERY_CONFLICT');
    await database.sql`update memberships set status='REVOKED' where organization_id=${ORG} and user_id=${USER}`;
    await expect(service.receiveSocketCommand(slackId, 1, 'envelope-12345678', socketBody())).rejects.toThrow('SLACK_MAPPING_DENIED');
    await database.sql`update integration_connections set version=2 where id=${slackId}`;
    await expect(service.receiveSocketCommand(slackId, 1, 'envelope-12345678', socketBody())).rejects.toThrow('SLACK_MAPPING_CHANGED');
    await service.processOnce(); expect(await database.sql`select id from tasks where source='SLACK'`).toHaveLength(0);
  });
  test('receiver lifecycle follows disabled connection and exposes no app token', async () => {
    await enableSocket(); const previous = process.env.AI_PIXEL_SLACK_APP_TOKEN; const token = `xapp-${'a'.repeat(30)}`; process.env.AI_PIXEL_SLACK_APP_TOKEN = token;
    const handlers = new Map<string, (value: unknown) => void>(); let stops = 0;
    const sockets = new IntegrationService(database, process.cwd(), fetcher, () => ({ on: (name, callback) => { handlers.set(name, callback); }, start: async () => { handlers.get('connected')?.(undefined); }, disconnect: async () => { stops += 1; handlers.get('disconnected')?.(undefined); } }));
    try {
      await sockets.refreshSocketReceivers(); const connected = await sockets.status(ORG, projectId); expect(connected.connections.find(row => row.provider === 'SLACK')?.receiver?.state).toBe('CONNECTED'); expect(JSON.stringify(connected)).not.toContain(token);
      await database.sql`update integration_connections set enabled=false,version=version+1 where id=${slackId}`; await sockets.refreshSocketReceivers();
      expect(stops).toBe(1); expect((await sockets.status(ORG, projectId)).connections.find(row => row.provider === 'SLACK')?.receiver?.state).toBe('STOPPED');
    } finally { await sockets.stop(); if (previous === undefined) delete process.env.AI_PIXEL_SLACK_APP_TOKEN; else process.env.AI_PIXEL_SLACK_APP_TOKEN = previous; }
  });
});
