import { randomUUID } from 'node:crypto';
import type { AgentProvider, Checkpoint } from '@ai-pixel/agents';
import { idSchema } from '@ai-pixel/contracts';
import type { Database, Transaction } from '@ai-pixel/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit, emit, mutate } from './repository.js';
import { type ApiEnv, ApiError } from './security.js';
import { checkpointSchema, initialCheckpoint, jsonValue, publicWorkflow, recordWorkflow, type WorkflowRow, updateTaskForRun } from './workflows.js';

const createSchema = z.strictObject({ fixture: z.literal('node-functions-v1') });
const controlSchema = z.strictObject({ action: z.enum(['pause', 'resume', 'cancel']), expectedVersion: z.number().int().positive() });
const acceptSchema = z.strictObject({ candidateSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), expectedVersion: z.number().int().positive() });
function validId(value: string) {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new ApiError(404, 'NOT_FOUND', '대상을 찾을 수 없습니다.');
  return result.data;
}
async function input<T>(request: Request, schema: z.ZodType<T>) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(400, 'INVALID_INPUT', 'JSON 형식으로 요청하세요.');
  let body: unknown;
  try { body = await request.json(); } catch { throw new ApiError(400, 'INVALID_INPUT', 'JSON 요청을 읽을 수 없습니다.'); }
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(400, 'INVALID_INPUT', '입력 내용을 확인하세요.');
  return result.data;
}
async function lockedRun(tx: Transaction, organizationId: string, id: string, version: number) {
  const rows = await tx<WorkflowRow[]>`select * from workflow_runs where organization_id=${organizationId} and id=${id} for update`;
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', '실행을 찾을 수 없습니다.');
  if (rows[0].version !== version) throw new ApiError(409, 'VERSION_CONFLICT', '실행이 변경됐습니다. 새로고침하세요.');
  return rows[0];
}
function acceptable(checkpoint: Checkpoint, sha: string) {
  const verified = checkpoint.verification;
  const pm = checkpoint.roles.find((role) => role.role === 'PM');
  const developer = [...checkpoint.roles].reverse().find((role) => role.role === 'DEVELOPER');
  const qa = [...checkpoint.roles].reverse().find((role) => role.role === 'QA');
  return checkpointSchema.safeParse(checkpoint).success && !checkpoint.activeTurnId && checkpoint.workspace?.sha === sha
    && checkpoint.workspace.diff.trim().length > 0 && checkpoint.workspace.files.length > 0
    && verified?.sha === sha && verified.test.exitCode === 0 && verified.build.exitCode === 0
    && verified.sandbox.networkDisabled && verified.sandbox.readOnlyRoot && verified.sandbox.resourceLimited
    && !!pm?.output.specEn.trim() && pm.output.acceptanceCriteria.length > 0
    && developer?.candidateSha === sha && developer.output.files.length > 0
    && qa?.candidateSha === sha && qa.output.candidateSha === sha && qa.output.verdict === 'PASS' && qa.output.issues.length === 0;
}

export function workflowRoutes(database: Database, provider?: AgentProvider) {
  const routes = new Hono<ApiEnv>();
  routes.get('/subscription', async (c) => c.json({ data: provider ? await provider.status() : {
    ready: false, reason: 'WORKER_NOT_CONFIGURED', authMode: 'unknown', billingMode: 'CHATGPT_SUBSCRIPTION', windows: [], checkedAt: new Date().toISOString(),
  }, requestId: c.get('requestId') }));
  routes.get('/tasks/:id/runs', async (c) => {
    const id = validId(c.req.param('id'));
    const organizationId = c.get('auth').organizationId;
    const task = await database.sql`select 1 from tasks where organization_id=${organizationId} and id=${id}`;
    if (!task.length) throw new ApiError(404, 'NOT_FOUND', '업무를 찾을 수 없습니다.');
    const rows = await database.sql<WorkflowRow[]>`select * from workflow_runs where organization_id=${organizationId} and task_id=${id} order by created_at desc,id desc limit 100`;
    return c.json({ data: { items: rows.map(publicWorkflow) }, requestId: c.get('requestId') });
  });
  routes.post('/tasks/:id/runs', async (c) => {
    const id = validId(c.req.param('id'));
    const body = await input(c.req.raw, createSchema);
    const readiness = await provider?.status();
    if (!readiness?.ready) throw new ApiError(409, 'SUBSCRIPTION_UNAVAILABLE', 'Codex 구독 상태와 잔여 한도를 확인하세요.', { reason: readiness?.reason ?? 'WORKER_NOT_CONFIGURED' });
    return mutate(database, c, body, async (tx) => {
      const organizationId = c.get('auth').organizationId;
      const tasks = await tx<{ project_id: string; command_original_ko: string; status: string }[]>`select project_id,command_original_ko,status from tasks where organization_id=${organizationId} and id=${id} for update`;
      const task = tasks[0];
      if (!task) throw new ApiError(404, 'NOT_FOUND', '업무를 찾을 수 없습니다.');
      if (!['TODO', 'FAILED'].includes(task.status)) throw new ApiError(409, 'INVALID_TRANSITION', '대기 또는 실패한 업무만 새 실행을 시작할 수 있습니다.');
      const active = await tx`select 1 from workflow_runs where organization_id=${organizationId} and task_id=${id} and status in ('QUEUED','RUNNING','PAUSED','BLOCKED','WAITING_APPROVAL')`;
      if (active.length) throw new ApiError(409, 'ACTIVE_RUN_EXISTS', '이미 진행 중인 실행이 있습니다.');
      const created = await tx<WorkflowRow[]>`insert into workflow_runs (id,organization_id,project_id,task_id,command_original_ko,fixture,checkpoint)
        values (${randomUUID()},${organizationId},${task.project_id},${id},${task.command_original_ko},${body.fixture},${tx.json(jsonValue(initialCheckpoint()))}) returning *`;
      await recordWorkflow(tx, created[0], undefined, 'workflow.run.created');
      await audit(tx, c, 'workflow.run.created', 'workflow_run', created[0].id, task.project_id);
      return { status: 201, data: publicWorkflow(created[0]) };
    });
  });
  routes.get('/runs/:id', async (c) => {
    const rows = await database.sql<WorkflowRow[]>`select * from workflow_runs where organization_id=${c.get('auth').organizationId} and id=${validId(c.req.param('id'))}`;
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', '실행을 찾을 수 없습니다.');
    return c.json({ data: publicWorkflow(rows[0]), requestId: c.get('requestId') });
  });
  routes.post('/runs/:id/control', async (c) => {
    const id = validId(c.req.param('id'));
    const body = await input(c.req.raw, controlSchema);
    return mutate(database, c, body, async (tx) => {
      const row = await lockedRun(tx, c.get('auth').organizationId, id, body.expectedVersion);
      const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(row.status);
      let status = row.status;
      const checkpoint = { ...row.checkpoint };
      if (body.action === 'cancel' && !terminal) { status = 'CANCELLED';
        if (checkpoint.stopReason !== 'STOP_UNVERIFIABLE') checkpoint.stopReason = 'OWNER_CANCELLED'; }
      else if (body.action === 'pause' && ['QUEUED', 'RUNNING'].includes(row.status)) { status = 'PAUSED'; checkpoint.stopReason = 'OWNER_PAUSED'; }
      else if (body.action === 'resume' && ['PAUSED', 'BLOCKED'].includes(row.status) && !checkpoint.activeTurnId && !checkpoint.activeThreadId && !row.stop_lease_token && !['RECOVERY_REQUIRED', 'STOP_UNVERIFIABLE'].includes(checkpoint.stopReason ?? '')) {
        status = 'QUEUED'; checkpoint.stopReason = null;
      } else throw new ApiError(409, 'INVALID_TRANSITION', '현재 상태에서는 이 제어를 실행할 수 없습니다.');
      const updated = await tx<WorkflowRow[]>`update workflow_runs set status=${status},checkpoint=${tx.json(jsonValue(checkpoint))},
        stop_lease_token=${row.lease_token ?? row.stop_lease_token}::uuid,lease_token=null,lease_expires_at=null,version=version+1,updated_at=now() where id=${id} returning *`;
      await updateTaskForRun(tx, updated[0]);
      await recordWorkflow(tx, updated[0]);
      await audit(tx, c, `workflow.run.${body.action}`, 'workflow_run', id, row.project_id);
      return { status: 200, data: publicWorkflow(updated[0]) };
    });
  });
  routes.post('/runs/:id/accept', async (c) => {
    const id = validId(c.req.param('id'));
    const body = await input(c.req.raw, acceptSchema);
    return mutate(database, c, body, async (tx) => {
      const auth = c.get('auth');
      const row = await lockedRun(tx, auth.organizationId, id, body.expectedVersion);
      if (row.status !== 'WAITING_APPROVAL' || !acceptable(row.checkpoint, body.candidateSha)) throw new ApiError(409, 'EVIDENCE_REQUIRED', '동일 SHA의 코드 변경·테스트·빌드·QA 통과 근거를 확인하세요.');
      await tx`insert into workflow_acceptances (id,organization_id,run_id,candidate_sha,accepted_by,session_id)
        values (${randomUUID()},${auth.organizationId},${id},${body.candidateSha},${auth.userId},${auth.sessionId})`;
      const updated = await tx<WorkflowRow[]>`update workflow_runs set status='SUCCEEDED',version=version+1,updated_at=now() where id=${id} returning *`;
      await updateTaskForRun(tx, updated[0]);
      await recordWorkflow(tx, updated[0]);
      await emit(tx, { organizationId: auth.organizationId, projectId: row.project_id, taskId: row.task_id, runId: id,
        type: 'approval.resolved', aggregateVersion: updated[0].version, payload: { runId: id, candidateSha: body.candidateSha, status: 'CONSUMED', action: 'ACCEPT_LOCAL_RESULT' } });
      await audit(tx, c, 'workflow.run.accepted', 'workflow_run', id, row.project_id);
      return { status: 200, data: publicWorkflow(updated[0]) };
    });
  });
  return routes;
}
