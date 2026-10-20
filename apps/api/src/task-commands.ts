import { randomUUID } from 'node:crypto';
import { createTaskSchema } from '@ai-pixel/contracts';
import type { Transaction } from '@ai-pixel/db';
import type postgres from 'postgres';
import { emit, type TaskRow } from './repository.js';
import { ApiError, digest } from './security.js';

/** Shared task command. Only the confirmed voice route can enable VOICE. */
export async function createTaskCommand(tx: Transaction, actor: { organizationId: string; userId: string }, projectId: string, value: unknown, confirmedVoice = false) {
  const parsed = createTaskSchema.safeParse(value);
  if (!parsed.success || !['TEXT', 'SLACK', ...(confirmedVoice ? ['VOICE'] : [])].includes(parsed.data.source)) throw new ApiError(400, 'INVALID_INPUT', '업무 입력 내용을 확인하세요.');
  const input = parsed.data;
  const exists = await tx`select 1 from projects where id=${projectId} and organization_id=${actor.organizationId} and status='ACTIVE'`;
  if (!exists.length) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
  const project = await tx`select 1 from projects p join organizations o on o.id=p.organization_id
    join memberships m on m.organization_id=p.organization_id and m.user_id=${actor.userId}
    where p.id=${projectId} and p.organization_id=${actor.organizationId} and p.status='ACTIVE' and o.status='ACTIVE' and m.role='OWNER' and m.status='ACTIVE'`;
  if (!project.length) throw new ApiError(403, 'TASK_SCOPE_DENIED', '프로젝트와 Owner 권한을 확인하세요.');
  const rows = await tx<TaskRow[]>`insert into tasks(id,organization_id,project_id,title,command_original_ko,command_hash,source,acceptance_criteria,priority,created_by)
    values(${randomUUID()},${actor.organizationId},${projectId},${input.title},${input.commandOriginalKo},${digest(input.commandOriginalKo)},${input.source},${tx.json(input.acceptanceCriteria as postgres.JSONValue)},${input.priority},${actor.userId}) returning *`;
  const task = rows[0];
  await emit(tx, { organizationId: actor.organizationId, projectId, taskId: task.id, type: 'task.created', aggregateVersion: 1,
    payload: { id: task.id, title: task.title, status: task.status, labelKo: '할 일' } });
  return task;
}
