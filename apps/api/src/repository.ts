import { randomUUID } from 'node:crypto';
import { taskLabels, type TaskStatus } from '@ai-pixel/contracts';
import { appendEvent, type Database, type Transaction } from '@ai-pixel/db';
import type { Context } from 'hono';
import type postgres from 'postgres';
import { ApiError, type ApiEnv, canonical, digest } from './security.js';

export const OWNER_ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
export const OWNER_USER_ID = '22222222-2222-4222-8222-222222222222';
export type ProjectRow = {
  id: string; organization_id: string; name: string; repository_url: string; default_branch: string;
  status: string; version: number; created_at: Date; updated_at: Date;
};
export type TaskRow = {
  id: string; organization_id: string; project_id: string; title: string;
  command_original_ko: string; command_hash: string; source: string; spec_en: string | null;
  spec_version: number; acceptance_criteria: unknown; priority: string; status: TaskStatus;
  blocked_reason: string | null; version: number; created_by: string; created_at: Date; updated_at: Date;
};
export type EventRow = {
  id: string; organization_id: string; project_id: string | null; workflow_run_id: string | null;
  task_id: string | null; agent_id: string | null; sequence: string; schema_version: 1;
  type: string; aggregate_version: number; payload: Record<string, unknown>; occurred_at: Date;
};

export function projectView(row: ProjectRow) {
  return {
    id: row.id, organizationId: row.organization_id, name: row.name,
    repositoryUrl: row.repository_url, defaultBranch: row.default_branch, status: row.status,
    version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}
export function taskView(row: TaskRow) {
  return {
    id: row.id, organizationId: row.organization_id, projectId: row.project_id,
    title: row.title, commandOriginalKo: row.command_original_ko, commandHash: row.command_hash,
    source: row.source, specEn: row.spec_en, specVersion: row.spec_version,
    acceptanceCriteria: row.acceptance_criteria, priority: row.priority, status: row.status,
    statusLabelKo: taskLabels[row.status], blockedReason: row.blocked_reason,
    version: row.version, createdBy: row.created_by,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), latestRunId: null,
  };
}
export function eventView(row: EventRow) {
  return {
    schemaVersion: row.schema_version, eventId: row.id, organizationId: row.organization_id,
    projectId: row.project_id, runId: row.workflow_run_id, taskId: row.task_id,
    agentId: row.agent_id, sequence: String(row.sequence), timestamp: row.occurred_at.toISOString(),
    type: row.type, aggregateVersion: row.aggregate_version, payload: row.payload,
  };
}

export async function initializeOwner(database: Database) {
  await database.sql.begin(async (tx) => {
    await tx`insert into organizations (id,name,status) values (${OWNER_ORGANIZATION_ID},'AI Pixel Company','ACTIVE') on conflict do nothing`;
    await tx`insert into users (id,external_subject,display_name) values (${OWNER_USER_ID},'local:owner','헴') on conflict do nothing`;
    await tx`insert into memberships (id,organization_id,user_id,role,status) values (${randomUUID()},${OWNER_ORGANIZATION_ID},${OWNER_USER_ID},'OWNER','ACTIVE') on conflict do nothing`;
    await tx`insert into organization_event_counters (organization_id) values (${OWNER_ORGANIZATION_ID}) on conflict do nothing`;
  });
}

export async function lockOrganization(tx: Transaction, organizationId: string) {
  await tx`insert into organization_event_counters (organization_id) values (${organizationId}) on conflict do nothing`;
  await tx`select last_sequence from organization_event_counters where organization_id = ${organizationId} for update`;
}
export async function emit(
  tx: Transaction,
  input: Omit<Parameters<typeof appendEvent>[1], 'sequence'>,
) {
  const rows = await tx<{ last_sequence: string }[]>`update organization_event_counters set last_sequence = last_sequence + 1 where organization_id = ${input.organizationId} returning last_sequence`;
  return appendEvent(tx, { ...input, sequence: BigInt(rows[0].last_sequence) });
}

export async function audit(tx: Transaction, c: Context<ApiEnv>, action: string, targetType: string, targetId: string, projectId: string | null = null) {
  const auth = c.get('auth');
  await tx`insert into audit_logs (id,organization_id,project_id,actor_type,actor_id,action,target_type,target_id,request_id,outcome)
    values (${randomUUID()},${auth.organizationId},${projectId},'USER',${auth.userId},${action},${targetType},${targetId},${c.get('requestId')},'SUCCESS')`;
}

type MutationResult = { status: 200 | 201 | 202; data: unknown };
export async function mutate(
  database: Database,
  c: Context<ApiEnv>,
  input: unknown,
  work: (tx: Transaction) => Promise<MutationResult>,
) {
  const auth = c.get('auth');
  const key = c.req.header('Idempotency-Key');
  if (!key || key.length > 128 || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '중복 요청 방지 키가 필요합니다.');
  }
  const route = `${c.req.method} ${c.req.path}`;
  const requestHash = digest(canonical(input));
  const result = await database.sql.begin(async (tx) => {
    await lockOrganization(tx, auth.organizationId);
    const active = await tx`select 1 from sessions s join memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
      where s.id=${auth.sessionId} and s.revoked_at is null and s.expires_at>now() and m.status='ACTIVE' and m.role='OWNER'`;
    if (!active.length) throw new ApiError(401, 'AUTH_REQUIRED', '다시 로그인하세요.');
    const previous = await tx<{ request_hash: string; response_ref: { status: 200 | 201 | 202; body: object } }[]>`
      select request_hash,response_ref from idempotency_keys where organization_id=${auth.organizationId} and actor_id=${auth.userId}
        and route=${route} and key=${key} and expires_at>now()`;
    if (previous[0]) {
      if (previous[0].request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_MISMATCH', '같은 요청 키에 다른 내용이 전달됐습니다.');
      return previous[0].response_ref;
    }
    await tx`delete from idempotency_keys where organization_id=${auth.organizationId} and actor_id=${auth.userId} and route=${route} and key=${key} and expires_at<=now()`;
    const response = await work(tx);
    const body = { data: response.data, requestId: c.get('requestId') };
    const stored = { status: response.status, body };
    await tx`insert into idempotency_keys (organization_id,actor_id,route,key,request_hash,response_ref,expires_at)
      values (${auth.organizationId},${auth.userId},${route},${key},${requestHash},${tx.json(JSON.parse(JSON.stringify(stored)) as postgres.JSONValue)},now()+interval '24 hours')`;
    return stored;
  });
  return c.json(result.body, result.status);
}

const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
  TODO: ['PLANNING', 'CANCELLED'], PLANNING: ['IN_PROGRESS', 'FAILED', 'CANCELLED'],
  IN_PROGRESS: ['REVIEW', 'FAILED', 'CANCELLED'],
  REVIEW: ['IN_PROGRESS', 'APPROVAL_REQUIRED', 'FAILED', 'CANCELLED'],
  APPROVAL_REQUIRED: ['IN_PROGRESS', 'FAILED', 'CANCELLED'],
  COMPLETED: [], FAILED: [], CANCELLED: [],
};

/** Private verification seam, never exposed as an HTTP route. AI execution arrives in Phase 1. */
export async function transitionTaskForVerification(database: Database, input: {
  organizationId: string; taskId: string; expectedVersion: number; to: TaskStatus;
}) {
  return database.sql.begin(async (tx) => {
    await lockOrganization(tx, input.organizationId);
    const tasks = await tx<TaskRow[]>`select * from tasks where id=${input.taskId} and organization_id=${input.organizationId} for update`;
    const task = tasks[0];
    if (!task) throw new ApiError(404, 'NOT_FOUND', '업무를 찾을 수 없습니다.');
    if (task.version !== input.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', '업무가 변경됐습니다.');
    if (input.to === 'COMPLETED') throw new ApiError(412, 'EVIDENCE_REQUIRED', '실행·검증·승인 근거가 없어 완료 처리할 수 없습니다.');
    if (!allowedTransitions[task.status].includes(input.to)) throw new ApiError(409, 'INVALID_TRANSITION', '허용되지 않은 상태 변경입니다.');
    const rows = await tx<TaskRow[]>`update tasks set status=${input.to},version=version+1,updated_at=now() where id=${task.id} and organization_id=${input.organizationId} returning *`;
    await emit(tx, { organizationId: input.organizationId, projectId: task.project_id, taskId: task.id,
      type: 'task.status.changed', aggregateVersion: rows[0].version,
      payload: { from: task.status, to: input.to, labelKo: taskLabels[input.to] } });
    await tx`insert into audit_logs (id,organization_id,project_id,actor_type,actor_id,action,target_type,target_id,request_id,outcome)
      values (${randomUUID()},${input.organizationId},${task.project_id},'SYSTEM','verification','task.status.changed','task',${task.id},${randomUUID()},'SUCCESS')`;
    return taskView(rows[0]);
  });
}
