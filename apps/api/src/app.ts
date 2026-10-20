import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AgentProvider } from '@ai-pixel/agents';
import {
  createProjectSchema, createTaskSchema, idSchema, loginSchema,
  patchProjectSchema, patchTaskSchema, sequenceSchema,
} from '@ai-pixel/contracts';
import type { Database } from '@ai-pixel/db';
import { verify } from '@node-rs/argon2';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import type { z } from 'zod';
import {
  audit, emit, type EventRow, eventView, mutate, OWNER_ORGANIZATION_ID,
  OWNER_USER_ID, type ProjectRow, projectView, type TaskRow, taskView,
} from './repository.js';
import {
  type ApiConfig, type ApiEnv, ApiError, authenticate, checkCsrf,
  checkOrigin, csrfToken, digest, randomToken,
} from './security.js';
import { workflowRoutes } from './workflow-routes.js';
import { loadOfficeApprovals, projectOffice } from './office.js';
import { ensureDefaultStaffing, staffingRoutes } from './staffing.js';
import { IntegrationService } from './integrations.js';
import { createTaskCommand } from './task-commands.js';
import { projectOperationsRoutes } from './project-operations.js';
import { ReviewService } from './reviews.js';
import {OperationsService} from './operations.js';
import {maintenanceReason} from './maintenance.js';
import {routeLabel} from './operations-model.js';
import { VoiceService } from './voice.js';

export { initializeOwner, transitionTaskForVerification } from './repository.js';
export type { ApiConfig } from './security.js';

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError(400, 'INVALID_INPUT', '입력 내용을 확인하세요.', { fields: result.error.issues.map((issue) => issue.path.join('.')) });
  }
  return result.data;
}
function validId(value: string) {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new ApiError(404, 'NOT_FOUND', '대상을 찾을 수 없습니다.');
  return result.data;
}
async function jsonBody(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(400, 'INVALID_INPUT', 'JSON 형식으로 요청하세요.');
  }
  try { return await request.json(); }
  catch { throw new ApiError(400, 'INVALID_INPUT', 'JSON 요청을 읽을 수 없습니다.'); }
}

const pageCursorSchema = zCursor();
function zCursor() {
  // Reuse the contract UUID validator without introducing a second wire format.
  return { parse(value: unknown) {
    if (!value || typeof value !== 'object' || !('id' in value) || !('createdAt' in value)) throw new Error('Invalid cursor');
    const record = value as { id: unknown; createdAt: unknown };
    const id = idSchema.parse(record.id);
    if (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) throw new Error('Invalid cursor date');
    return { id, createdAt: record.createdAt };
  } };
}
function pagination(c: Context<ApiEnv>) {
  const limitText = c.req.query('limit') ?? '100';
  if (!/^[1-9][0-9]{0,2}$/.test(limitText) || Number(limitText) > 100) throw new ApiError(400, 'INVALID_INPUT', '페이지 크기는 1~100이어야 합니다.');
  const encoded = c.req.query('cursor');
  let cursor: { id: string; createdAt: string } | null = null;
  if (encoded) {
    try {
      if (encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid cursor');
      cursor = pageCursorSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
    } catch { throw new ApiError(400, 'INVALID_INPUT', '목록 커서를 확인하세요.'); }
  }
  return { limit: Number(limitText), cursor };
}
function nextPage(row: { id: string; cursor_time: string } | undefined) {
  return row ? Buffer.from(JSON.stringify({ id: row.id, createdAt: row.cursor_time })).toString('base64url') : null;
}

export function createApp({ database, config, workflowProvider, integrations, reviews, operations,voice,structuredLogs=false }: { database: Database; config: ApiConfig; workflowProvider?: AgentProvider; integrations?: IntegrationService; reviews?: ReviewService; operations?:OperationsService;voice?:VoiceService;structuredLogs?:boolean }) {
  const app = new Hono<ApiEnv>();
  const integrationService = integrations ?? new IntegrationService(database, fileURLToPath(new URL('../../../', import.meta.url)));
  const operationService=operations??new OperationsService(database,fileURLToPath(new URL('../../../',import.meta.url)));
  const loginAttempts: number[] = [];
  const cookieOptions = {
    path: '/', httpOnly: true, secure: config.cookieSecure,
    sameSite: 'Strict' as const, maxAge: config.sessionTtlSeconds,
  };
  app.use('*', secureHeaders({ strictTransportSecurity: false }));
  app.use('*', async (c, next) => {
    const started=performance.now();
    c.set('requestId', randomUUID());
    c.header('X-Request-ID', c.get('requestId'));
    c.header('Cache-Control', 'no-store');
    await next();
    const ms=performance.now()-started;operationService.metrics.record(c.req.path,c.res.status,ms);
    if(structuredLogs)console.log(JSON.stringify({level:'info',requestId:c.get('requestId'),method:c.req.method,route:routeLabel(c.req.path),status:c.res.status,durationMs:Math.round(ms)}));
  });
  app.use('/api/*', async (c, next) => bodyLimit({ maxSize: c.req.method === 'POST' && /^\/api\/v1\/projects\/[a-f0-9-]{36}\/voice\/candidates$/.test(c.req.path) ? 960_044 : 65_536, onError: () => { throw new ApiError(413, 'INVALID_INPUT', '요청 크기가 너무 큽니다.'); } })(c, next));

  app.onError((error, c) => {
    const known = error instanceof ApiError;
    const status = known ? error.status : 503;
    if (!known) console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), code: 'DEPENDENCY_UNAVAILABLE' }));
    return c.json({ error: {
      code: known ? error.code : 'DEPENDENCY_UNAVAILABLE',
      messageKo: known ? error.messageKo : '요청을 처리할 수 없습니다. 잠시 후 다시 시도하세요.',
      retryable: status >= 500 || status === 429,
      ...(known && error.details ? { details: error.details } : {}),
    }, requestId: c.get('requestId') }, status);
  });
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', messageKo: '경로를 찾을 수 없습니다.', retryable: false }, requestId: c.get('requestId') }, 404));
  app.get('/health/live',c=>c.json({status:'ok',phase:4}));
  const readiness=async(c:Context<ApiEnv>)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{const paused=await Promise.race([(async()=>{await database.sql`select 1`;return maintenanceReason(database.sql);})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('READINESS_TIMEOUT')),2000);})]);return c.json({status:paused?'maintenance':'ok',phase:4,agentWorkerConfigured:Boolean(workflowProvider),subscriptionReadiness:'/api/v1/subscription'},paused?503:200);}catch{return c.json({status:'unavailable',phase:4},503);}finally{if(timer)clearTimeout(timer);}};
  app.get('/health',readiness);app.get('/health/ready',readiness);

  app.post('/api/v1/auth/session', async (c) => {
    checkOrigin(c, config);
    const body = parse(loginSchema, await jsonBody(c.req.raw));
    const now = Date.now();
    while (loginAttempts[0] !== undefined && loginAttempts[0] <= now - config.loginWindowMs) loginAttempts.shift();
    if (loginAttempts.length >= config.loginMaxAttempts) {
      c.header('Retry-After', String(Math.ceil(config.loginWindowMs / 1000)));
      throw new ApiError(429, 'RATE_LIMITED', '로그인 시도가 많습니다. 잠시 후 다시 시도하세요.');
    }
    loginAttempts.push(now);
    if (!(await verify(config.bootstrapSecretHash, body.secret))) {
      await database.sql`insert into audit_logs (id,organization_id,actor_type,actor_id,action,target_type,target_id,request_id,outcome)
        values (${randomUUID()},${OWNER_ORGANIZATION_ID},'SYSTEM','local-login','auth.login','session','unknown',${c.get('requestId')},'DENIED')`;
      throw new ApiError(401, 'AUTH_REQUIRED', 'Owner 비밀키를 확인하세요.');
    }
    const eligible = await database.sql`select 1 from memberships m join organizations o on o.id=m.organization_id
      where m.organization_id=${OWNER_ORGANIZATION_ID} and m.user_id=${OWNER_USER_ID} and m.role='OWNER' and m.status='ACTIVE' and o.status='ACTIVE'`;
    if (!eligible.length) throw new ApiError(403, 'FORBIDDEN', '계정 권한이 비활성화되어 있습니다.');
    const token = randomToken();
    const csrf = randomToken();
    await database.sql.begin(async (tx) => {
      await tx`insert into sessions (id,user_id,organization_id,token_hash,csrf_hash,expires_at)
        values (${randomUUID()},${OWNER_USER_ID},${OWNER_ORGANIZATION_ID},${digest(token)},${digest(csrf)},${new Date(Date.now() + config.sessionTtlSeconds * 1000)})`;
      await tx`insert into audit_logs (id,organization_id,actor_type,actor_id,action,target_type,target_id,request_id,outcome)
        values (${randomUUID()},${OWNER_ORGANIZATION_ID},'USER',${OWNER_USER_ID},'auth.login','user',${OWNER_USER_ID},${c.get('requestId')},'SUCCESS')`;
    });
    setCookie(c, 'pixel_session', token, cookieOptions);
    setCookie(c, 'pixel_csrf', csrf, { ...cookieOptions, httpOnly: false });
    return c.json({ data: {
      user: { id: OWNER_USER_ID, displayName: '헴' },
      organization: { id: OWNER_ORGANIZATION_ID, name: 'AI Pixel Company' }, csrfToken: csrf,
    }, requestId: c.get('requestId') });
  });

  app.route('/api/webhooks', integrationService.webhooks());
  app.use('/api/v1/*', async (c, next) => {
    const auth = await authenticate(database, getCookie(c, 'pixel_session'));
    if (!auth) throw new ApiError(401, 'AUTH_REQUIRED', '로그인이 필요합니다.');
    c.set('auth', auth);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      checkOrigin(c, config);
      checkCsrf(c);
    }
    await next();
  });
  app.get('/api/v1/me', (c) => {
    const auth = c.get('auth');
    return c.json({ data: {
      user: { id: auth.userId, displayName: auth.displayName },
      organization: { id: auth.organizationId, name: auth.organizationName }, csrfToken: csrfToken(c),
    }, requestId: c.get('requestId') });
  });
  app.route('/api/v1', workflowRoutes(database, workflowProvider));
  app.route('/api/v1', staffingRoutes(database));
  app.route('/api/v1', integrationService.routes());
  app.route('/api/v1', projectOperationsRoutes(database, workflowProvider));
  app.route('/api/v1', (reviews ?? new ReviewService(database, workflowProvider)).routes());
  app.route('/api/v1',operationService.routes());
  app.route('/api/v1',(voice ?? new VoiceService(database, fileURLToPath(new URL('../../../', import.meta.url)))).routes());
  app.delete('/api/v1/auth/session', async (c) => {
    const auth = c.get('auth');
    await database.sql.begin(async (tx) => {
      await tx`update sessions set revoked_at=now() where id=${auth.sessionId}`;
      await audit(tx, c, 'auth.logout', 'session', auth.sessionId);
    });
    deleteCookie(c, 'pixel_session', { path: '/', secure: config.cookieSecure, sameSite: 'Strict' });
    deleteCookie(c, 'pixel_csrf', { path: '/', secure: config.cookieSecure, sameSite: 'Strict' });
    return c.json({ data: { loggedOut: true }, requestId: c.get('requestId') });
  });

  app.get('/api/v1/projects', async (c) => {
    const page = pagination(c);
    // Preserve PostgreSQL microseconds in opaque cursors; JavaScript Date loses them.
    const whereCursor = page.cursor ? database.sql`and (created_at,id)<(${page.cursor.createdAt}::text::timestamptz,${page.cursor.id}::uuid)` : database.sql``;
    const rows = await database.sql<(ProjectRow & { cursor_time: string })[]>`select *,created_at::text as cursor_time from projects where organization_id=${c.get('auth').organizationId} ${whereCursor} order by created_at desc,id desc limit ${page.limit + 1}`;
    const visible = rows.slice(0, page.limit);
    return c.json({ data: visible.map(projectView), pagination: { nextCursor: rows.length > page.limit ? nextPage(visible.at(-1)) : null }, requestId: c.get('requestId') });
  });
  app.post('/api/v1/projects', async (c) => {
    const input = parse(createProjectSchema, await jsonBody(c.req.raw));
    if (new URL(input.repositoryUrl).hostname !== 'github.com') throw new ApiError(400, 'INVALID_INPUT', 'Phase 0에서는 GitHub HTTPS 저장소 URL을 사용하세요.');
    return mutate(database, c, input, async (tx) => {
      const rows = await tx<ProjectRow[]>`insert into projects (id,organization_id,name,repository_url,default_branch)
        values (${randomUUID()},${c.get('auth').organizationId},${input.name},${input.repositoryUrl},${input.defaultBranch}) returning *`;
      const project = rows[0];
      await ensureDefaultStaffing(tx, project.organization_id, project.id);
      await emit(tx, { organizationId: project.organization_id, projectId: project.id,
        type: 'project.created', aggregateVersion: 1, payload: { id: project.id, name: project.name } });
      await audit(tx, c, 'project.created', 'project', project.id, project.id);
      return { data: projectView(project), status: 201 };
    });
  });
  app.get('/api/v1/projects/:id', async (c) => {
    const id = validId(c.req.param('id'));
    const row = await database.db.query.projects.findFirst({ where: (projects, { eq, and }) => and(eq(projects.id, id), eq(projects.organizationId, c.get('auth').organizationId)) });
    if (!row) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    return c.json({ data: { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }, requestId: c.get('requestId') });
  });
  app.patch('/api/v1/projects/:id', async (c) => {
    const id = validId(c.req.param('id'));
    const input = parse(patchProjectSchema, await jsonBody(c.req.raw));
    if (input.repositoryUrl && new URL(input.repositoryUrl).hostname !== 'github.com') throw new ApiError(400, 'INVALID_INPUT', 'GitHub HTTPS 저장소 URL을 사용하세요.');
    return mutate(database, c, input, async (tx) => {
      const rows = await tx<ProjectRow[]>`select * from projects where id=${id} and organization_id=${c.get('auth').organizationId} for update`;
      const project = rows[0];
      if (!project) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
      if (project.version !== input.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', '프로젝트가 변경됐습니다. 새로고침하세요.');
      const updated = await tx<ProjectRow[]>`update projects set name=${input.name ?? project.name},repository_url=${input.repositoryUrl ?? project.repository_url},default_branch=${input.defaultBranch ?? project.default_branch},version=version+1,updated_at=now() where id=${id} and organization_id=${project.organization_id} returning *`;
      await emit(tx, { organizationId: project.organization_id, projectId: id, type: 'project.updated', aggregateVersion: updated[0].version, payload: { id } });
      await audit(tx, c, 'project.updated', 'project', id, id);
      return { status: 200, data: projectView(updated[0]) };
    });
  });
  app.get('/api/v1/projects/:id/tasks', async (c) => {
    const id = validId(c.req.param('id'));
    const org = c.get('auth').organizationId;
    const project = await database.sql`select 1 from projects where id=${id} and organization_id=${org}`;
    if (!project.length) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    const page = pagination(c);
    const whereCursor = page.cursor ? database.sql`and (created_at,id)<(${page.cursor.createdAt}::text::timestamptz,${page.cursor.id}::uuid)` : database.sql``;
    const rows = await database.sql<(TaskRow & { cursor_time: string })[]>`select *,created_at::text as cursor_time from tasks where project_id=${id} and organization_id=${org} ${whereCursor} order by created_at desc,id desc limit ${page.limit + 1}`;
    const visible = rows.slice(0, page.limit);
    const last = visible.at(-1);
    return c.json({ data: visible.map(taskView), pagination: { nextCursor: rows.length > page.limit ? nextPage(last) : null }, requestId: c.get('requestId') });
  });
  app.post('/api/v1/projects/:id/tasks', async (c) => {
    const projectId = validId(c.req.param('id'));
    const input = parse(createTaskSchema, await jsonBody(c.req.raw));
    if (input.source !== 'TEXT') throw new ApiError(400, 'INVALID_INPUT', 'Phase 0은 텍스트 업무 입력만 지원합니다.');
    return mutate(database, c, input, async (tx) => {
      const task = await createTaskCommand(tx, c.get('auth'), projectId, input);
      await audit(tx, c, 'task.created', 'task', task.id, projectId);
      return { status: 201, data: taskView(task) };
    });
  });
  app.get('/api/v1/tasks/:id', async (c) => {
    const id = validId(c.req.param('id'));
    const org = c.get('auth').organizationId;
    const rows = await database.sql<TaskRow[]>`select * from tasks where id=${id} and organization_id=${org}`;
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', '업무를 찾을 수 없습니다.');
    const events = await database.sql<EventRow[]>`select * from agent_events where task_id=${id} and organization_id=${org} order by sequence desc limit 100`;
    return c.json({ data: { ...taskView(rows[0]), events: events.reverse().map(eventView) }, requestId: c.get('requestId') });
  });
  app.patch('/api/v1/tasks/:id', async (c) => {
    const id = validId(c.req.param('id'));
    const input = parse(patchTaskSchema, await jsonBody(c.req.raw));
    return mutate(database, c, input, async (tx) => {
      const rows = await tx<TaskRow[]>`select * from tasks where id=${id} and organization_id=${c.get('auth').organizationId} for update`;
      const task = rows[0];
      if (!task) throw new ApiError(404, 'NOT_FOUND', '업무를 찾을 수 없습니다.');
      if (task.version !== input.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', '업무가 변경됐습니다. 새로고침하세요.');
      if (task.status !== 'TODO') throw new ApiError(409, 'INVALID_TRANSITION', '시작 전 업무만 수정할 수 있습니다.');
      const updated = await tx<TaskRow[]>`update tasks set title=${input.title ?? task.title},priority=${input.priority ?? task.priority},version=version+1,updated_at=now() where id=${id} and organization_id=${task.organization_id} returning *`;
      await emit(tx, { organizationId: task.organization_id, projectId: task.project_id, taskId: id,
        type: 'task.updated', aggregateVersion: updated[0].version, payload: { id, title: updated[0].title, priority: updated[0].priority } });
      await audit(tx, c, 'task.updated', 'task', id, task.project_id);
      return { status: 200, data: taskView(updated[0]) };
    });
  });
  app.get('/api/v1/projects/:id/snapshot', async (c) => {
    const projectId = validId(c.req.param('id'));
    const org = c.get('auth').organizationId;
    const snapshot = await database.sql.begin('isolation level repeatable read read only', async (tx) => {
      const project = await tx`select 1 from projects where id=${projectId} and organization_id=${org}`;
      if (!project.length) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
      const rows = await tx<TaskRow[]>`select * from tasks where project_id=${projectId} and organization_id=${org} order by created_at desc,id desc`;
      const counters = await tx<{ last_sequence: string }[]>`select last_sequence from organization_event_counters where organization_id=${org}`;
      const agents = await projectOffice(tx, org, projectId);
      const approvals = await loadOfficeApprovals(tx, org, projectId);
      const time = await tx<{ synced_at: Date }[]>`select transaction_timestamp() as synced_at`;
      return { projectId, cursor: String(counters[0]?.last_sequence ?? '0'), tasks: rows.map(taskView), agents, approvals, syncedAt: time[0].synced_at.toISOString() };
    });
    return c.json({ data: snapshot, requestId: c.get('requestId') });
  });

  app.get('/api/v1/events/stream', async (c) => {
    const organizationId = c.get('auth').organizationId;
    const projectId = validId(c.req.query('projectId') ?? '');
    const suppliedCursor = c.req.header('Last-Event-ID') ?? c.req.query('after') ?? '0';
    let cursor = parse(sequenceSchema, suppliedCursor);
    const projects = await database.sql`select 1 from projects where id=${projectId} and organization_id=${organizationId}`;
    if (!projects.length) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    const token = getCookie(c, 'pixel_session');
    if(!operationService.metrics.openStream())throw new ApiError(429,'SSE_CONNECTION_LIMIT','동시 실시간 연결 상한에 도달했습니다. 기존 연결을 닫고 다시 확인하세요.');
    c.header('X-Accel-Buffering', 'no');
    c.header('Content-Encoding', 'identity');
    c.header('Cache-Control', 'no-cache, no-transform');
    return streamSSE(c, async (stream) => {
      let aborted = false;
      let heartbeatAt = 0;
      stream.onAbort(() => { aborted = true; });
      const bounded=async(work:Promise<unknown>)=>{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{operationService.metrics.slowStream();aborted=true;stream.abort();reject(new Error('SSE_SLOW_CONSUMER'));},5000);})]);}finally{if(timer)clearTimeout(timer);}};
      try {
        while (!aborted && !c.req.raw.signal.aborted) {
          if (!(await authenticate(database, token))) {
            await bounded(stream.writeSSE({ event: 'stream.auth-error', data: JSON.stringify({ messageKo: '세션이 만료되었습니다. 다시 로그인하세요.' }) }));
            break;
          }
          const since = new Date(Date.now() - config.sseRetentionDays * 86_400_000);
          const range = await database.sql<{ latest: string; earliest: string | null }[]>`
            select c.last_sequence as latest,
              (select min(sequence) from agent_events where organization_id=${organizationId} and occurred_at>=${since}) as earliest
            from organization_event_counters c where c.organization_id=${organizationId}`;
          const latest = BigInt(range[0]?.latest ?? '0');
          const earliest = range[0]?.earliest === null || range[0]?.earliest === undefined ? latest + 1n : BigInt(range[0].earliest);
          if (BigInt(cursor) > latest || BigInt(cursor) < earliest - 1n) {
            await bounded(stream.writeSSE({ event: 'stream.reset', data: JSON.stringify({ reason: 'CURSOR_EXPIRED', messageKo: '최신 상태를 다시 불러오세요.' }) }));
            break;
          }
          const rows = await database.sql<EventRow[]>`select * from agent_events where organization_id=${organizationId} and sequence>${cursor} order by sequence limit ${config.sseBatchSize + 1}`;
          if (rows.length > config.sseBatchSize) {
            await bounded(stream.writeSSE({ event: 'stream.reset', data: JSON.stringify({ reason: 'BACKLOG_LIMIT', messageKo: '최신 상태를 다시 불러오세요.' }) }));
            break;
          }
          for (const row of rows) {
            if (aborted) break;
            if (row.project_id === projectId) await bounded(stream.writeSSE({ id: String(row.sequence), event: row.type, data: JSON.stringify(eventView(row)) }));
            cursor = String(row.sequence);
          }
          if (rows.length) await bounded(stream.writeSSE({ id: cursor, event: 'stream.cursor', data: JSON.stringify({ cursor }) }));
          if (Date.now() - heartbeatAt >= config.sseHeartbeatMs) {
            await bounded(stream.write(': heartbeat\n\n'));
            heartbeatAt = Date.now();
          }
          await stream.sleep(config.ssePollMs);
        }
      } catch {
        if (!aborted && !c.req.raw.signal.aborted) {
          await bounded(stream.writeSSE({ event: 'stream.reset', data: JSON.stringify({ reason: 'STREAM_UNAVAILABLE', messageKo: '연결을 복구하고 있습니다.' }) })).catch(() => undefined);
        }
      }finally{operationService.metrics.closeStream();}
    });
  });
  return app;
}
