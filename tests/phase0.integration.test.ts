import { createHash, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { createDatabase, migrateDatabase } from '@ai-pixel/db';
import { eventEnvelopeSchema, snapshotSchema, taskSchema } from '@ai-pixel/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp, initializeOwner, transitionTaskForVerification } from '../apps/api/src/app.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'http://127.0.0.1:3000';
const TEST_SECRET = 'integration-fixture-secret-only-never-a-local-owner-key';
const databaseUrl = process.env.TEST_DATABASE_URL;

// Never silently skip integration verification or erase the development database.
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must name a dedicated test database. Integration verification cannot be skipped.');
const parsedUrl = new URL(databaseUrl);
if (!/(?:^|[_-])test(?:$|[_-])/.test(decodeURIComponent(parsedUrl.pathname.slice(1)))) {
  throw new Error('Refusing destructive integration fixtures: database name must contain a separate test segment.');
}
if (process.env.DATABASE_URL === databaseUrl) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL.');

const database = createDatabase(databaseUrl);
let app: ReturnType<typeof createApp>;
let bootstrapSecretHash: string;
let session: { cookie: string; csrfToken: string };

const config = () => ({
  appOrigin: ORIGIN,
  bootstrapSecretHash,
  sessionTtlSeconds: 3600,
  cookieSecure: false,
  ssePollMs: 25,
  sseHeartbeatMs: 100,
  sseBatchSize: 1000,
  sseRetentionDays: 30,
  loginMaxAttempts: 100,
  loginWindowMs: 60_000,
});

async function request(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; authenticated?: boolean; key?: string } = {}) {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.authenticated === false ? {} : { Cookie: session.cookie });
  if (method !== 'GET') {
    headers.set('Origin', ORIGIN);
    headers.set('X-CSRF-Token', session?.csrfToken ?? '');
    headers.set('Idempotency-Key', options.key ?? randomUUID());
  }
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
  return app.request(`http://127.0.0.1:4000/api/v1${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function login(targetApp = app) {
  const response = await targetApp.request('http://127.0.0.1:4000/api/v1/auth/session', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: TEST_SECRET }),
  });
  expect(response.status).toBe(200);
  const json = await response.json();
  const cookies = response.headers.getSetCookie();
  const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
  expect(cookie).toContain('pixel_session=');
  expect(cookie).toContain('pixel_csrf=');
  expect(cookies.find((value) => value.startsWith('pixel_session='))).toMatch(/HttpOnly/i);
  expect(cookies.find((value) => value.startsWith('pixel_session='))).toMatch(/SameSite=Strict/i);
  expect(json.data.user.id).toBe(USER);
  expect(json.data.organization.id).toBe(ORG);
  expect(json.data.csrfToken).toBeTypeOf('string');
  return { cookie, csrfToken: json.data.csrfToken as string };
}

async function project(name = '통합 검증 프로젝트') {
  const response = await request('/projects', {
    method: 'POST', body: { name, repositoryUrl: 'https://github.com/Ina-dang/ai-pixel-company.git', defaultBranch: 'main' },
  });
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

const originalKo = '  헴의 원문: 공백 두 칸  유지\r\n한글 조합 가 / 가 & <script>alert(1)</script>  ';
const taskBody = (title = '한국어 원문 보존') => ({
  title, commandOriginalKo: originalKo, source: 'TEXT',
  acceptanceCriteria: [{ id: 'AC-1', descriptionKo: '원문을 정확히 저장한다', method: 'integration-test', required: true }],
});

async function task(projectId: string, title?: string) {
  const response = await request(`/projects/${projectId}/tasks`, { method: 'POST', body: taskBody(title) });
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

async function snapshot(projectId: string) {
  const response = await request(`/projects/${projectId}/snapshot`);
  expect(response.status).toBe(200);
  return snapshotSchema.parse((await response.json()).data);
}

interface Frame { event: string; id?: string; data?: unknown; comment?: string }
class EventStream {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = '';
  private decoder = new TextDecoder();
  constructor(response: Response) {
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(response.headers.get('Cache-Control')).toContain('no-cache');
    if (!response.body) throw new Error('SSE body is required');
    this.reader = response.body.getReader();
    streams.push(this);
  }
  async next(timeout = 4000): Promise<Frame | null> {
    const deadline = Date.now() + timeout;
    while (true) {
      const boundary = this.buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const raw = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 2);
        if (!raw) continue;
        const frame: Frame = { event: 'message' };
        const data: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith(':')) frame.comment = line.slice(1).trim();
          else if (line.startsWith('event:')) frame.event = line.slice(6).trim();
          else if (line.startsWith('id:')) frame.id = line.slice(3).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length) frame.data = JSON.parse(data.join('\n'));
        return frame;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('SSE frame deadline elapsed');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const chunk = await Promise.race([
          this.reader.read(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('SSE frame deadline elapsed')), remaining); }),
        ]);
        if (chunk.done) return null;
        this.buffer += this.decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n');
      } finally { clearTimeout(timer); }
    }
  }
  async until(event: string): Promise<Frame> {
    for (let index = 0; index < 100; index++) {
      const frame = await this.next();
      if (!frame) throw new Error(`Stream closed before ${event}`);
      if (frame.event === event) return frame;
    }
    throw new Error(`Stream did not emit ${event}`);
  }
  async close() { await this.reader.cancel(); }
}
let streams: EventStream[] = [];
async function stream(projectId: string, after: string, headers?: Record<string, string>) {
  return new EventStream(await request(`/events/stream?projectId=${projectId}&after=${after}`, { ...(headers ? { headers } : {}) }));
}

beforeAll(async () => {
  await migrateDatabase(database);
  bootstrapSecretHash = await hash(TEST_SECRET);
});
beforeEach(async () => {
  await database.sql`TRUNCATE organizations, users CASCADE`;
  await initializeOwner(database);
  app = createApp({ database, config: config() });
  session = await login();
});
afterEach(async () => {
  await Promise.all(streams.map((item) => item.close()));
  streams = [];
});
afterAll(async () => { await database.close(); });

describe('Phase 0 list pagination preserves all durable records', () => {
  test('project 101 remains reachable and microsecond cursors lose no rows', async () => {
    const records = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(), organization_id: ORG, name: `페이지 ${index}`,
      repository_url: 'https://github.com/Ina-dang/ai-pixel-company.git', default_branch: 'main',
    }));
    await database.sql`insert into projects ${database.sql(records)}`;
    await database.sql`update projects set created_at='2026-10-19T00:00:00.123456Z',updated_at='2026-10-19T00:00:00.123456Z' where organization_id=${ORG}`;
    const first = await (await request('/projects?limit=100')).json();
    expect(first.data).toHaveLength(100);
    expect(first.pagination.nextCursor).toBeTypeOf('string');
    const second = await (await request(`/projects?limit=100&cursor=${encodeURIComponent(first.pagination.nextCursor)}`)).json();
    expect(second.data).toHaveLength(1);
    expect(second.pagination.nextCursor).toBeNull();
    expect(new Set([...first.data, ...second.data].map((item: { id: string }) => item.id)).size).toBe(101);
    expect((await request('/projects?cursor=not-a-cursor')).status).toBe(400);
    expect((await request('/projects?limit=101')).status).toBe(400);
  });

  test('task listing exposes the next page instead of silently truncating', async () => {
    const createdProject = await project();
    for (let index = 0; index < 4; index++) await task(createdProject.id, `업무 페이지 ${index}`);
    const first = await (await request(`/projects/${createdProject.id}/tasks?limit=2`)).json();
    const second = await (await request(`/projects/${createdProject.id}/tasks?limit=2&cursor=${encodeURIComponent(first.pagination.nextCursor)}`)).json();
    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(2);
    expect(second.pagination.nextCursor).toBeNull();
    expect(new Set([...first.data, ...second.data].map((item: { id: string }) => item.id)).size).toBe(4);
  });
});

describe('Phase 0 authentication and request boundaries', () => {
  test('opaque cookies are hashed at rest; unauthenticated requests fail in Korean', async () => {
    const response = await request('/me', { authenticated: false });
    expect(response.status).toBe(401);
    const error = await response.json();
    expect(error.requestId).toBeTypeOf('string');
    expect(error.error.messageKo).toMatch(/[가-힣]/);
    const rawToken = session.cookie.match(/pixel_session=([^;]+)/)?.[1];
    expect(rawToken).toBeTruthy();
    const rows = await database.sql`SELECT token_hash, csrf_hash FROM sessions`;
    expect(rows).toHaveLength(1);
    if (!rawToken) throw new Error('Missing session cookie');
    expect(rows[0]?.token_hash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(rows[0]?.csrf_hash).not.toBe(session.csrfToken);
  });

  test('login rejects wrong credentials, foreign Origin, and missing Origin', async () => {
    const bad = await request('/auth/session', { method: 'POST', authenticated: false, body: { secret: 'incorrect-fixture-secret' } });
    expect(bad.status).toBe(401);
    const foreign = await request('/auth/session', { method: 'POST', authenticated: false, headers: { Origin: 'https://attacker.invalid' }, body: { secret: TEST_SECRET } });
    expect(foreign.status).toBe(403);
    const missing = await app.request('http://127.0.0.1:4000/api/v1/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: TEST_SECRET }) });
    expect(missing.status).toBe(403);
  });

  test('write requires matching CSRF, Origin, and idempotency key', async () => {
    const body = { name: '차단 대상', repositoryUrl: 'https://github.com/example/repo.git', defaultBranch: 'main' };
    const csrf = await request('/projects', { method: 'POST', body, headers: { 'X-CSRF-Token': 'wrong' } });
    expect(csrf.status).toBe(403);
    const origin = await request('/projects', { method: 'POST', body, headers: { Origin: 'https://attacker.invalid' } });
    expect(origin.status).toBe(403);
    const noKey = await app.request('http://127.0.0.1:4000/api/v1/projects', { method: 'POST', headers: { Cookie: session.cookie, Origin: ORIGIN, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(noKey.status).toBe(400);
    expect(await database.sql`SELECT id FROM projects`).toHaveLength(0);
  });

  test('logout revokes server session and expiry remains authoritative', async () => {
    const loggedOut = await request('/auth/session', { method: 'DELETE' });
    expect(loggedOut.status).toBe(200);
    expect((await request('/me')).status).toBe(401);
    session = await login();
    await database.sql`UPDATE sessions SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE revoked_at IS NULL`;
    expect((await request('/me')).status).toBe(401);
  });

  test('revoked membership invalidates existing session', async () => {
    await database.sql`UPDATE memberships SET status = 'REVOKED' WHERE organization_id = ${ORG} AND user_id = ${USER}`;
    expect((await request('/me')).status).toBe(401);
  });

  test('login rate limit applies before repeated credential verification', async () => {
    const limited = createApp({ database, config: { ...config(), loginMaxAttempts: 2 } });
    const attempt = () => limited.request('http://127.0.0.1:4000/api/v1/auth/session', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'wrong-fixture-secret' }) });
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });
});

describe('Phase 0 durable project/task API and domain invariants', () => {
  test('idempotent creates return the same ID once; changed body under same key conflicts', async () => {
    const key = randomUUID();
    const body = { name: '멱등 프로젝트', repositoryUrl: 'https://github.com/example/repo.git', defaultBranch: 'main' };
    const first = await request('/projects', { method: 'POST', body, key });
    const second = await request('/projects', { method: 'POST', body, key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await first.json()).data.id).toBe((await second.json()).data.id);
    const changed = await request('/projects', { method: 'POST', body: { ...body, name: '다른 본문' }, key });
    expect(changed.status).toBe(409);
    expect(await database.sql`SELECT id FROM projects`).toHaveLength(1);
    expect(await database.sql`SELECT id FROM agent_events WHERE type = 'project.created'`).toHaveLength(1);
  });

  test('Korean original and criteria persist exactly across a fresh API instance', async () => {
    const createdProject = await project();
    const created = await task(createdProject.id);
    app = createApp({ database, config: config() });
    const response = await request(`/tasks/${created.id}`);
    expect(response.status).toBe(200);
    const result = (await response.json()).data;
    const parsed = taskSchema.parse(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'events')));
    expect(parsed.commandOriginalKo).toBe(originalKo);
    expect(parsed.commandHash).toBe(createHash('sha256').update(originalKo).digest('hex'));
    expect(parsed.acceptanceCriteria).toEqual(taskBody().acceptanceCriteria);
    expect(parsed.status).toBe('TODO');
    expect(parsed.statusLabelKo).toBe('할 일');
    expect(result.events).toHaveLength(1);
    eventEnvelopeSchema.parse(result.events[0]);
    expect((await snapshot(createdProject.id)).tasks[0]?.commandOriginalKo).toBe(originalKo);
  });

  test('cross-organization IDs never expose projects, tasks, snapshots, or streams', async () => {
    const otherOrg = randomUUID();
    const otherProject = randomUUID();
    const otherTask = randomUUID();
    const otherUser = randomUUID();
    await database.sql`INSERT INTO organizations (id, name) VALUES (${otherOrg}, '다른 조직')`;
    await database.sql`INSERT INTO users (id, external_subject, display_name) VALUES (${otherUser}, ${`test:${otherUser}`}, '다른 사용자')`;
    await database.sql`INSERT INTO memberships (id, organization_id, user_id, role) VALUES (${randomUUID()}, ${otherOrg}, ${otherUser}, 'OWNER')`;
    await database.sql`INSERT INTO projects (id, organization_id, name, repository_url) VALUES (${otherProject}, ${otherOrg}, '비공개 프로젝트', 'https://github.com/example/private.git')`;
    await database.sql`INSERT INTO tasks (id, organization_id, project_id, title, command_original_ko, command_hash, acceptance_criteria, created_by) VALUES (${otherTask}, ${otherOrg}, ${otherProject}, '비공개 업무', '비공개 원문', ${'a'.repeat(64)}, ${database.sql.json(taskBody().acceptanceCriteria)}, ${otherUser})`;
    for (const path of [`/projects/${otherProject}`, `/projects/${otherProject}/tasks`, `/tasks/${otherTask}`, `/projects/${otherProject}/snapshot`, `/events/stream?projectId=${otherProject}&after=0`]) {
      expect((await request(path)).status, path).toBe(404);
    }
    const write = await request(`/projects/${otherProject}/tasks`, { method: 'POST', body: taskBody() });
    expect(write.status).toBe(404);
    const list = await request('/projects');
    expect(JSON.stringify(await list.json())).not.toContain(otherProject);
  });

  test('optimistic task updates produce one success and one conflict; status injection is rejected', async () => {
    const createdProject = await project();
    const created = await task(createdProject.id);
    const results = await Promise.all([
      request(`/tasks/${created.id}`, { method: 'PATCH', body: { expectedVersion: 1, title: '첫 변경' } }),
      request(`/tasks/${created.id}`, { method: 'PATCH', body: { expectedVersion: 1, title: '두 번째 변경' } }),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 409]);
    const injected = await request(`/tasks/${created.id}`, { method: 'PATCH', body: { expectedVersion: 2, title: '우회 시도', status: 'COMPLETED' } });
    expect(injected.status).toBe(400);
    const result = (await (await request(`/tasks/${created.id}`)).json()).data;
    expect(result.version).toBe(2);
    expect(result.status).toBe('TODO');
  });

  test('private service persists legal transitions, rejects illegal completion and immutable original edits', async () => {
    const createdProject = await project();
    const created = await task(createdProject.id);
    await expect(transitionTaskForVerification(database, { organizationId: ORG, taskId: created.id, expectedVersion: 1, to: 'COMPLETED' })).rejects.toThrow();
    await transitionTaskForVerification(database, { organizationId: ORG, taskId: created.id, expectedVersion: 1, to: 'PLANNING' });
    await transitionTaskForVerification(database, { organizationId: ORG, taskId: created.id, expectedVersion: 2, to: 'IN_PROGRESS' });
    await transitionTaskForVerification(database, { organizationId: ORG, taskId: created.id, expectedVersion: 3, to: 'REVIEW' });
    await transitionTaskForVerification(database, { organizationId: ORG, taskId: created.id, expectedVersion: 4, to: 'APPROVAL_REQUIRED' });
    await expect(transitionTaskForVerification(database, { organizationId: ORG, taskId: created.id, expectedVersion: 5, to: 'COMPLETED' })).rejects.toThrow();
    const originalEdit = await request(`/tasks/${created.id}`, { method: 'PATCH', body: { expectedVersion: 5, title: '변조 시도', commandOriginalKo: '변조 원문' } });
    expect(originalEdit.status).toBe(400);
    const state = await snapshot(createdProject.id);
    expect(state.tasks[0]?.status).toBe('APPROVAL_REQUIRED');
    expect(state.tasks[0]?.version).toBe(5);
    expect(state.tasks[0]?.commandOriginalKo).toBe(originalKo);
    expect((await request(`/tasks/${created.id}/start`, { method: 'POST', body: { expectedVersion: 5 } })).status).toBe(404);
  });
});

describe('Phase 0 snapshot/SSE recovery against committed PostgreSQL events', () => {
  test('concurrent creates have contiguous commit-ordered sequences and replay exactly once after snapshot', async () => {
    const createdProject = await project();
    const before = await snapshot(createdProject.id);
    const connection = await stream(createdProject.id, before.cursor);
    const created = await Promise.all(Array.from({ length: 8 }, (_, index) => task(createdProject.id, `동시 업무 ${index}`)));
    const received = [];
    for (let index = 0; index < created.length; index++) received.push(eventEnvelopeSchema.parse((await connection.until('task.created')).data));
    const sequences = received.map((item) => BigInt(item.sequence));
    expect(sequences).toEqual(Array.from({ length: 8 }, (_, index) => BigInt(before.cursor) + BigInt(index + 1)));
    expect(new Set(received.map((item) => item.eventId)).size).toBe(8);
    expect(new Set(received.map((item) => item.taskId))).toEqual(new Set(created.map((item) => item.id)));
    const current = await snapshot(createdProject.id);
    expect(current.tasks).toHaveLength(8);
    expect(current.cursor).toBe(received.at(-1)?.sequence);
    await connection.close();
    const resumeEvent = received[3];
    if (!resumeEvent) throw new Error('Missing replay boundary event');
    const resumed = await stream(createdProject.id, resumeEvent.sequence);
    const replay = [];
    for (let index = 0; index < 4; index++) replay.push(eventEnvelopeSchema.parse((await resumed.until('task.created')).data));
    expect(replay.map((item) => item.eventId)).toEqual(received.slice(4).map((item) => item.eventId));
  });

  test('Last-Event-ID takes precedence over query cursor, heartbeats do not advance the cursor, and cancellation closes', async () => {
    const createdProject = await project();
    const before = await snapshot(createdProject.id);
    const created = await task(createdProject.id);
    const connection = await stream(createdProject.id, '0', { 'Last-Event-ID': before.cursor });
    const event = await connection.until('task.created');
    expect(eventEnvelopeSchema.parse(event.data).taskId).toBe(created.id);
    const cursor = await connection.until('stream.cursor');
    expect(cursor.id).toBe(event.id);
    let heartbeat: Frame | null = null;
    for (let index = 0; index < 10; index++) {
      const next = await connection.next();
      if (next?.comment !== undefined) { heartbeat = next; break; }
      expect(next?.event).not.toBe('project.created');
    }
    expect(heartbeat?.comment).toBeDefined();
    expect(heartbeat?.id).toBeUndefined();
    await connection.close();
    expect(await connection.reader.read()).toEqual({ done: true, value: undefined });
  });

  test('old retention cursor requires reset and stream closure', async () => {
    const createdProject = await project();
    await task(createdProject.id);
    await database.sql`UPDATE agent_events SET occurred_at = now() - interval '31 days' WHERE organization_id = ${ORG}`;
    const connection = await stream(createdProject.id, '0');
    await connection.until('stream.reset');
    expect(await connection.next()).toBeNull();
  });

  test('session revocation terminates an already open stream', async () => {
    const createdProject = await project();
    const state = await snapshot(createdProject.id);
    const connection = await stream(createdProject.id, state.cursor);
    await database.sql`UPDATE sessions SET revoked_at = now() WHERE organization_id = ${ORG}`;
    await connection.until('stream.auth-error');
    expect(await connection.next()).toBeNull();
  });
});
