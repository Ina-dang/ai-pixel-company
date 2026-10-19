import { type OfficeAgent, type OfficeApproval, officeAgentSchema, officeApprovalSchema, officeRoles, taskStatusSchema } from '@ai-pixel/contracts';
import type { Transaction } from '@ai-pixel/db';

type Role = OfficeAgent['role'];
type ProjectionRow = {
  role: Role; run_id: string | null; run_status: OfficeAgent['runStatus']; run_version: number | null;
  stage: string | null; stop_reason: string | null; task_id: string | null; task_title: string | null;
  task_status: string | null; current_role: Role | null; evidence: unknown; active_assignments: number;
};
const names: Record<Role, string> = { PM: 'PM', DEVELOPER: '개발자', QA: 'QA' };
const desks: Record<Role, OfficeAgent['location']> = { PM: 'pmDesk', DEVELOPER: 'developerDesk', QA: 'qaDesk' };
const activeStatuses = new Set(['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED', 'WAITING_APPROVAL']);
const stages = new Set(['PM', 'DEVELOPER', 'VERIFY', 'QA']);
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function evidence(value: unknown) {
  if (!value || typeof value !== 'object') return { sha: null, completedAt: null, usage: null };
  const row = value as Record<string, unknown>;
  const validThread = typeof row.threadId === 'string' && row.threadId.length > 0;
  const validDate = typeof row.completedAt === 'string' && Number.isFinite(Date.parse(row.completedAt));
  const usage = row.usage && typeof row.usage === 'object' ? row.usage as Record<string, unknown> : null;
  const validUsage = usage && ['inputTokens', 'cachedInputTokens', 'outputTokens'].every((key) => typeof usage[key] === 'number' && Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0);
  return {
    sha: validThread && typeof row.candidateSha === 'string' && shaPattern.test(row.candidateSha) ? row.candidateSha : null,
    completedAt: validThread && validDate ? new Date(row.completedAt as string).toISOString() : null,
    usage: validThread && validUsage ? { inputTokens: Number(usage.inputTokens), cachedInputTokens: Number(usage.cachedInputTokens), outputTokens: Number(usage.outputTokens) } : null,
  };
}
function view(row: ProjectionRow): OfficeAgent {
  const completed = evidence(row.evidence);
  const taskStatus = taskStatusSchema.safeParse(row.task_status);
  const agent: OfficeAgent = {
    id: row.role, role: row.role, nameKo: names[row.role], state: 'IDLE', activityKo: '할당된 작업을 기다려요.', location: 'lounge',
    taskId: row.task_id, taskTitle: row.task_title, taskStatus: taskStatus.success ? taskStatus.data : null, runId: row.run_id,
    runStatus: row.run_status, stage: stages.has(row.stage ?? '') ? row.stage as OfficeAgent['stage'] : null,
    blockedReason: null, version: row.run_version ?? 1, evidenceSha: completed.sha, lastCompletedAt: completed.completedAt,
    usage: completed.usage, activeAssignments: Number(row.active_assignments),
  };
  if (!row.run_id) return officeAgentSchema.parse(agent);
  if (activeStatuses.has(row.run_status ?? '') && !stages.has(row.stage ?? '')) {
    agent.state = 'ERROR'; agent.activityKo = '실행 상태를 확인할 수 없어요.'; agent.blockedReason = 'STATE_UNVERIFIABLE'; agent.location = desks[row.role];
    return officeAgentSchema.parse(agent);
  }
  if (row.current_role !== row.role || row.run_status === 'SUCCEEDED') {
    agent.activityKo = row.run_status === 'SUCCEEDED' ? 'Owner가 수락한 결과의 작업을 마쳤어요.' : '역할 작업을 마치고 다음 단계를 기다려요.';
    return officeAgentSchema.parse(agent);
  }
  agent.location = desks[row.role];
  if (row.run_status === 'CANCELLED') {
    agent.location = 'lounge'; agent.activityKo = '실행이 취소되어 대기해요.';
  } else if (row.run_status === 'FAILED') {
    agent.state = 'ERROR'; agent.activityKo = '실행에 실패해 확인이 필요해요.'; agent.blockedReason = row.stop_reason;
  } else if (row.run_status === 'BLOCKED') {
    agent.state = 'BLOCKED'; agent.activityKo = '실행이 차단되어 확인을 기다려요.'; agent.blockedReason = row.stop_reason;
  } else if (row.run_status === 'PAUSED') {
    agent.state = 'WAITING'; agent.location = 'lounge'; agent.activityKo = 'Owner가 작업을 일시 중지했어요.';
  } else if (row.run_status === 'QUEUED') {
    agent.state = 'WAITING'; agent.activityKo = '실행 순서를 기다려요.';
  } else if (row.run_status === 'WAITING_APPROVAL') {
    agent.state = 'WAITING'; agent.location = 'owner'; agent.activityKo = '검증된 결과의 Owner 승인을 기다려요.';
  } else if (row.run_status === 'RUNNING' && row.role === 'QA') {
    agent.state = 'REVIEWING'; agent.activityKo = row.stage === 'VERIFY' ? '테스트와 빌드를 검증하고 있어요.' : '검증 근거와 코드를 검토하고 있어요.';
  } else if (row.run_status === 'RUNNING') {
    agent.state = 'RUNNING'; agent.activityKo = row.role === 'PM' ? '요구사항과 작업 계획을 정리해요.' : '코드를 수정하고 있어요.';
  }
  return officeAgentSchema.parse(agent);
}

/** Read inside the same REPEATABLE READ transaction as tasks and the event cursor. */
export async function projectOffice(tx: Transaction, organizationId: string, projectId: string): Promise<OfficeAgent[]> {
  const rows = await tx<ProjectionRow[]>`
    with scoped_runs as (
      select r.id,r.status,r.version,r.updated_at,r.checkpoint->>'stage' as stage,r.checkpoint->>'stopReason' as stop_reason,
        case when r.status='WAITING_APPROVAL' then 'PM'
          when r.checkpoint->>'stage'='PM' then 'PM'
          when r.checkpoint->>'stage'='DEVELOPER' then 'DEVELOPER'
          when r.checkpoint->>'stage' in ('VERIFY','QA') then 'QA' else null end as current_role,
        case when jsonb_typeof(r.checkpoint->'roles')='array' then r.checkpoint->'roles' else '[]'::jsonb end as roles,
        t.id as task_id,t.title as task_title,t.status as task_status,t.priority as task_priority
      from workflow_runs r join tasks t on t.organization_id=r.organization_id and t.project_id=r.project_id and t.id=r.task_id
      where r.organization_id=${organizationId} and r.project_id=${projectId}
    ), candidates as (
      select role.role,r.id as run_id,r.status as run_status,r.version as run_version,r.stage,r.stop_reason,r.current_role,
        r.task_id,r.task_title,r.task_status,e.evidence,
        coalesce(((r.current_role=role.role or (r.current_role is null and role.role='PM')) and r.status in ('QUEUED','RUNNING','PAUSED','BLOCKED','WAITING_APPROVAL')),false) as active,
        r.updated_at,r.task_priority,
        case when r.current_role=role.role and r.status<>'SUCCEEDED' then r.updated_at
          when pg_input_is_valid(e.evidence->>'completedAt','timestamp with time zone') then (e.evidence->>'completedAt')::timestamptz
          else r.updated_at end as role_updated_at
      from unnest(array['PM','DEVELOPER','QA']) as role(role) cross join scoped_runs r
      join project_staffing assigned on assigned.organization_id=${organizationId} and assigned.project_id=${projectId} and assigned.role=role.role
      join employees worker on worker.organization_id=assigned.organization_id and worker.id=assigned.employee_id and worker.employment_status='ACTIVE'
      left join workflow_staffing_snapshots pinned on pinned.organization_id=assigned.organization_id and pinned.run_id=r.id and pinned.role=role.role
      left join lateral (
        select jsonb_build_object('role',v->>'role','threadId',v->>'threadId','completedAt',v->>'completedAt','candidateSha',v->>'candidateSha',
          'usage',jsonb_build_object('inputTokens',v->'usage'->'inputTokens','cachedInputTokens',v->'usage'->'cachedInputTokens','outputTokens',v->'usage'->'outputTokens')) as evidence
        from jsonb_array_elements(r.roles) with ordinality as entries(v,position)
        where v->>'role'=role.role and jsonb_typeof(v->'threadId')='string' and length(v->>'threadId')>0
        order by position desc limit 1
      ) e on true
      where (r.current_role=role.role or e.evidence is not null
        or (r.current_role is null and role.role='PM' and r.status in ('QUEUED','RUNNING','PAUSED','BLOCKED','WAITING_APPROVAL')))
        and (pinned.employee_id=worker.id or (pinned.employee_id is null and worker.is_baseline))
    ), ranked as (
      select *,count(*) filter (where active) over(partition by role)::integer as active_assignments,
        row_number() over(partition by role order by active desc,
          case when active then case run_status when 'RUNNING' then 0 when 'BLOCKED' then 1 when 'WAITING_APPROVAL' then 2 when 'PAUSED' then 3 else 4 end else 0 end,
          case when active then case task_priority when 'URGENT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end else 0 end,role_updated_at desc,updated_at desc,run_id desc) as rank
      from candidates
    )
    select role.role,r.run_id,r.run_status,r.run_version,r.stage,r.stop_reason,r.task_id,r.task_title,r.task_status,r.current_role,r.evidence,
      coalesce(r.active_assignments,0)::integer as active_assignments
    from unnest(array['PM','DEVELOPER','QA']) as role(role) left join ranked r on r.role=role.role and r.rank=1
    order by array_position(array['PM','DEVELOPER','QA'],role.role)`;
  const byRole = new Map(rows.map((row) => [row.role, row]));
  const assignments = await tx<{ role: OfficeAgent['role']; employee_id: string; name_ko: string; employment_status: 'ACTIVE' | 'SUSPENDED' | 'RETIRED'; is_baseline: boolean }[]>`
    select a.role,e.id as employee_id,e.name_ko,e.employment_status,e.is_baseline from project_staffing a
    join employees e on e.organization_id=a.organization_id and e.id=a.employee_id
    where a.organization_id=${organizationId} and a.project_id=${projectId}`;
  const pinned = await tx<{ run_id: string; role: OfficeAgent['role']; employee_id: string; profile_version: number; name_ko: string }[]>`
    select s.run_id,s.role,s.employee_id,s.profile_version,s.profile->>'nameKo' as name_ko from workflow_staffing_snapshots s
    join workflow_runs r on r.organization_id=s.organization_id and r.id=s.run_id
    where r.organization_id=${organizationId} and r.project_id=${projectId}
      and r.id=any(${rows.map((row) => row.run_id).filter((id): id is string => !!id)})`;
  return officeRoles.map((role) => {
    const row = byRole.get(role);
    if (!row) throw new Error('Office projection is incomplete.');
    const agent = view(row);
    const assignment = assignments.find((item) => item.role === role);
    const profile = pinned.find((item) => item.role === role && item.run_id === row.run_id);
    const active = assignment?.employment_status === 'ACTIVE';
    const sameEmployee = !!assignment && (profile ? profile.employee_id === assignment.employee_id : assignment.is_baseline);
    const clearEvidence = !active || !sameEmployee;
    return officeAgentSchema.parse({ ...agent,
      employeeId: assignment?.employee_id ?? null, profileVersion: sameEmployee ? profile?.profile_version ?? null : null,
      assignmentStatus: assignment?.employment_status ?? 'UNASSIGNED',
      nameKo: assignment ? (sameEmployee && profile ? profile.name_ko : assignment.name_ko) : `${role} 미배정`,
      ...(clearEvidence ? { state: active ? 'IDLE' : 'BLOCKED', location: 'lounge',
        activityKo: active ? '배정된 업무를 기다려요.' : assignment ? '현재 업무 배정이 중지되어 있어요.' : '배정된 직원이 없어요.',
        taskId: null, taskTitle: null, taskStatus: null, runId: null, runStatus: null, stage: null,
        blockedReason: active ? null : 'STAFFING_PERMISSION_REVOKED', evidenceSha: null, lastCompletedAt: null, usage: null, activeAssignments: 0 } : {}),
    });
  });
}

/** Approval cards summarize actual pending runs without exporting checkpoints. */
export async function loadOfficeApprovals(tx: Transaction, organizationId: string, projectId: string): Promise<OfficeApproval[]> {
  const rows = await tx<{ id: string; task_id: string; candidate_sha: string | null; version: number }[]>`
    select id,task_id,checkpoint->'workspace'->>'sha' as candidate_sha,version from workflow_runs
    where organization_id=${organizationId} and project_id=${projectId} and status='WAITING_APPROVAL'
    order by created_at,id`;
  return rows.map((row) => officeApprovalSchema.parse({ id: row.id, runId: row.id, taskId: row.task_id,
    candidateSha: row.candidate_sha && shaPattern.test(row.candidate_sha) ? row.candidate_sha : null,
    status: 'WAITING_APPROVAL', version: row.version }));
}
