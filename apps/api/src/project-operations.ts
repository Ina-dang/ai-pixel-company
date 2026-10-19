import { randomUUID } from 'node:crypto';
import type { Database, Transaction } from '@ai-pixel/db';
import type { AgentProvider, StaffingProfile } from '@ai-pixel/agents';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit, emit, mutate } from './repository.js';
import { ApiError, type ApiEnv } from './security.js';
import { budgetMonth, dependencyBlock, executionDefaults, readExecutionPolicy } from './execution-policy.js';
import { jsonValue } from './workflows.js';

const uuid = z.uuid(), version = z.number().int().nonnegative();
const policySchema = z.strictObject({ expectedVersion: version, monthlyTokens: z.number().int().min(1000).max(1000000000), runTokens: z.number().int().min(1000).max(500000) });
const edgeSchema = z.strictObject({ taskId: uuid, prerequisiteId: uuid, expectedTaskVersion: version });
async function body<T>(request: Request, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', '입력 값과 버전을 확인하세요.');
  return parsed.data;
}
export async function requireProject(tx: Transaction, org: string, project: string, active = false) {
  if (!uuid.safeParse(project).success) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
  const rows = await tx`select * from projects where organization_id=${org} and id=${project}`;
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
  if (active && rows[0].status !== 'ACTIVE') throw new ApiError(409, 'PROJECT_INACTIVE', '보관한 프로젝트는 신규 작업을 시작할 수 없습니다.');
  return rows[0];
}
export function projectOperationsRoutes(database: Database, provider?: AgentProvider) {
  const routes = new Hono<ApiEnv>();
  routes.get('/company', async c => {
    const org = c.get('auth').organizationId;
    const data = await database.sql.begin('isolation level repeatable read read only', async tx => {
      const projects = await tx`select p.id,p.name,p.status,p.version,p.repository_url as "repositoryUrl",p.default_branch as "defaultBranch",
        (select count(*)::int from tasks t where t.organization_id=p.organization_id and t.project_id=p.id) as "taskCount",
        (select count(*)::int from workflow_runs r where r.organization_id=p.organization_id and r.project_id=p.id and r.status='RUNNING') as "runningCount",
        (select count(*)::int from workflow_runs r where r.organization_id=p.organization_id and r.project_id=p.id and r.status='QUEUED') as "queuedCount",
        (select count(*)::int from workflow_runs r where r.organization_id=p.organization_id and r.project_id=p.id and r.status='WAITING_APPROVAL') as "approvalCount"
        from projects p where p.organization_id=${org} order by p.created_at desc,p.id limit 100`;
      const usage = await tx`select project_id as "projectId",sum(spent_tokens)::text as "spentTokens",
        sum(case when status in ('HELD','UNKNOWN') then greatest(reserved_tokens-spent_tokens,0) else 0 end)::text as "heldTokens"
        from execution_allowances where organization_id=${org} and period_start=${budgetMonth()}::date group by project_id`;
      const policy = await readExecutionPolicy(tx, org, projects[0]?.id ?? '00000000-0000-4000-8000-000000000000');
      const departments = await tx`select d.*, (select count(*)::int from employee_departments a where a.organization_id=d.organization_id and a.department_id=d.id) as "employeeCount" from departments d where organization_id=${org} order by name_ko,id`;
      const placements = await tx`select employee_id as "employeeId",department_id as "departmentId",version from employee_departments where organization_id=${org}`;
      const queue = await tx`select r.id,r.project_id as "projectId",r.task_id as "taskId",r.status,t.title,t.priority,r.checkpoint->>'stopReason' as reason,r.created_at as "createdAt"
        from workflow_runs r join tasks t on t.organization_id=r.organization_id and t.id=r.task_id where r.organization_id=${org}
        and r.status in ('QUEUED','RUNNING','BLOCKED','PAUSED','WAITING_APPROVAL') order by r.created_at,r.id limit 100`;
      return { projects, usage, queue, departments, placements, policy: policy.company, periodStart: budgetMonth(), providerSlots: executionDefaults.providerSlots,
        billingMode: 'CHATGPT_SUBSCRIPTION', actualCost: null, usageBasis: 'COMPLETED_RESPONSES_ONLY' };
    });
    return c.json({ data, requestId: c.get('requestId') });
  });
  routes.get('/projects/:id/operations', async c => {
    const project = c.req.param('id'), org = c.get('auth').organizationId;
    if (!uuid.safeParse(project).success) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    const data = await database.sql.begin('isolation level repeatable read read only', async tx => {
      await requireProject(tx, org, project);
      const dependencies = await tx`select task_id as "taskId",prerequisite_id as "prerequisiteId" from task_dependencies where organization_id=${org} and project_id=${project} order by task_id,prerequisite_id`;
      const schedules = await tx`select task_id as "taskId",enabled,version,run_id as "runId",reason from task_schedules where organization_id=${org} and project_id=${project}`;
      const tasks = await tx`select t.id,t.title,t.status,t.priority,t.version,
        case when exists(select 1 from task_dependencies d join tasks p on p.organization_id=d.organization_id and p.id=d.prerequisite_id
          where d.organization_id=t.organization_id and d.task_id=t.id and p.status<>'COMPLETED') then 'DEPENDENCY' else t.blocked_reason end as "blockedReason"
        from tasks t where organization_id=${org} and project_id=${project} order by created_at desc,id desc limit 100`;
      const usage = await tx`select coalesce(sum(spent_tokens),0)::text as "spentTokens",coalesce(sum(case when status in ('HELD','UNKNOWN') then greatest(reserved_tokens-spent_tokens,0) else 0 end),0)::text as "heldTokens"
        from execution_allowances where organization_id=${org} and project_id=${project} and period_start=${budgetMonth()}::date`;
      return { policy: await readExecutionPolicy(tx, org, project), dependencies, schedules, tasks, usage: usage[0], providerSlots: 1, scheduler: 'PRIORITY_THEN_FIFO_V1', periodStart: budgetMonth() };
    });
    return c.json({ data, requestId: c.get('requestId') });
  });
  for (const scope of ['company','project'] as const) routes.post(scope === 'company' ? '/company/policy' : '/projects/:id/execution-policy', async c => {
    const input = await body(c.req.raw, policySchema), org = c.get('auth').organizationId;
    return mutate(database, c, input, async tx => {
      const project = scope === 'project' ? c.req.param('id') : null;
      if (project) { if (!uuid.safeParse(project).success) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.'); await requireProject(tx, org, project); }
      const current = await readExecutionPolicy(tx, org, project ?? '00000000-0000-4000-8000-000000000000');
      if (current[scope].version !== input.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', '예산 정책이 변경됐습니다.');
      if (project) await tx`insert into project_execution_policies(organization_id,project_id,monthly_tokens,run_tokens) values(${org},${project},${input.monthlyTokens},${input.runTokens})
        on conflict(organization_id,project_id) do update set monthly_tokens=excluded.monthly_tokens,run_tokens=excluded.run_tokens,version=project_execution_policies.version+1`;
      else await tx`insert into company_execution_policies(organization_id,monthly_tokens,run_tokens) values(${org},${input.monthlyTokens},${input.runTokens})
        on conflict(organization_id) do update set monthly_tokens=excluded.monthly_tokens,run_tokens=excluded.run_tokens,version=company_execution_policies.version+1`;
      await emit(tx, { organizationId: org, projectId: project, type: 'company.updated', aggregateVersion: input.expectedVersion+1, payload: { scope, kind: 'TOKEN_POLICY' } });
      await audit(tx, c, 'company.token-policy.updated', 'execution_policy', project ?? org, project);
      return { status: 200, data: { ...input, version: input.expectedVersion+1, unit: 'COMPLETED_RESPONSE_TOKENS', actualCost: null } };
    });
  });
  for (const action of ['add','remove'] as const) routes.post(`/projects/:id/dependencies/${action}`, async c => {
    const input = await body(c.req.raw, edgeSchema), org = c.get('auth').organizationId, project = c.req.param('id');
    return mutate(database, c, input, async tx => {
      await requireProject(tx, org, project, true); await tx`select 1 from projects where organization_id=${org} and id=${project} for update`;
      const tasks = await tx`select id,status,version from tasks where organization_id=${org} and project_id=${project} and id in (${input.taskId},${input.prerequisiteId})`;
      const task = tasks.find(t => t.id === input.taskId);
      if (!task || !tasks.some(t => t.id === input.prerequisiteId)) throw new ApiError(404, 'DEPENDENCY_SCOPE', '같은 프로젝트의 서로 다른 업무를 선택하세요.');
      if (input.taskId === input.prerequisiteId) throw new ApiError(409, 'DEPENDENCY_CYCLE', '자기 자신을 선행 업무로 지정할 수 없습니다.');
      if (task.version !== input.expectedTaskVersion) throw new ApiError(409, 'VERSION_CONFLICT', '업무 버전이 변경됐습니다.');
      const active = await tx`select 1 from workflow_runs where organization_id=${org} and task_id=${input.taskId} and status in ('QUEUED','RUNNING','PAUSED','BLOCKED','WAITING_APPROVAL')`;
      if (active.length || !['TODO','FAILED'].includes(task.status)) throw new ApiError(409, 'DEPENDENCY_PLAN_FROZEN', '실행 계획이 있는 업무의 의존성은 수정할 수 없습니다.');
      if (action === 'add') {
        const cycle = await tx`with recursive paths(id) as (select ${input.prerequisiteId}::uuid union select d.prerequisite_id from task_dependencies d join paths p on d.task_id=p.id where d.organization_id=${org} and d.project_id=${project}) select 1 from paths where id=${input.taskId}`;
        if (cycle.length) throw new ApiError(409, 'DEPENDENCY_CYCLE', '순환 의존성은 허용하지 않습니다.');
        await tx`insert into task_dependencies(organization_id,project_id,task_id,prerequisite_id,created_by) values(${org},${project},${input.taskId},${input.prerequisiteId},${c.get('auth').userId}) on conflict do nothing`;
      } else await tx`delete from task_dependencies where organization_id=${org} and task_id=${input.taskId} and prerequisite_id=${input.prerequisiteId}`;
      const reason = await dependencyBlock(tx, org, project, input.taskId);
      await tx`update tasks set blocked_reason=${reason},version=version+1,updated_at=now() where organization_id=${org} and id=${input.taskId}`;
      await emit(tx, { organizationId: org, projectId: project, taskId: input.taskId, type: 'task.updated', aggregateVersion: Number(task.version)+1, payload: { dependency: action, blockedReason: reason } });
      await audit(tx, c, `task.dependency.${action}`, 'task', input.taskId, project);
      return { status: 200, data: { taskId: input.taskId, blockedReason: reason, version: Number(task.version)+1 } };
    });
  });
  routes.post('/projects/:id/tasks/:taskId/schedule', async c => {
    const input = await body(c.req.raw, z.strictObject({ enabled: z.boolean(), expectedTaskVersion: version })), org = c.get('auth').organizationId, project = c.req.param('id'), taskId = c.req.param('taskId');
    if (!uuid.safeParse(taskId).success) throw new ApiError(404, 'NOT_FOUND', '업무를 찾을 수 없습니다.');
    if (input.enabled && !((await provider?.status())?.ready)) throw new ApiError(409, 'SUBSCRIPTION_UNAVAILABLE', '구독 한도를 확인한 뒤 예약하세요.');
    return mutate(database, c, input, async tx => {
      await requireProject(tx, org, project, true);
      const tasks = await tx`select status,version from tasks where organization_id=${org} and project_id=${project} and id=${taskId} for update`;
      if (!tasks[0]) throw new ApiError(404, 'NOT_FOUND', '업무를 찾을 수 없습니다.');
      if (tasks[0].version !== input.expectedTaskVersion) throw new ApiError(409, 'VERSION_CONFLICT', '업무가 변경됐습니다.');
      const active = await tx`select 1 from workflow_runs where organization_id=${org} and task_id=${taskId} and status in ('QUEUED','RUNNING','PAUSED','BLOCKED','WAITING_APPROVAL')`;
      if (input.enabled && (active.length || !['TODO','FAILED'].includes(tasks[0].status))) throw new ApiError(409, 'SCHEDULE_UNAVAILABLE', '새 실행이 가능한 업무만 예약할 수 있습니다.');
      const reason = await dependencyBlock(tx, org, project, taskId);
      const rows = await tx`insert into task_schedules(organization_id,project_id,task_id,requested_by,enabled,reason) values(${org},${project},${taskId},${c.get('auth').userId},${input.enabled},${reason})
        on conflict(organization_id,task_id) do update set enabled=excluded.enabled,reason=excluded.reason,requested_by=excluded.requested_by,version=task_schedules.version+1,updated_at=now() returning *`;
      await tx`update tasks set version=version+1,blocked_reason=${reason},updated_at=now() where organization_id=${org} and id=${taskId}`;
      await emit(tx, { organizationId: org, projectId: project, taskId, type: 'project.schedule.updated', aggregateVersion: Number(rows[0].version), payload: { taskId, enabled: input.enabled, reason } });
      await audit(tx, c, 'task.schedule.updated', 'task', taskId, project);
      return { status: 200, data: rows[0] };
    });
  });
  routes.post('/projects/:id/lifecycle', async c => {
    const input = await body(c.req.raw, z.strictObject({ action: z.enum(['archive','restore']), expectedVersion: version })), org = c.get('auth').organizationId, project = c.req.param('id');
    return mutate(database, c, input, async tx => {
      const current = await requireProject(tx, org, project);
      if (current.version !== input.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', '프로젝트가 변경됐습니다.');
      if (input.action === 'archive') {
        const active = await tx`select 1 from workflow_runs where organization_id=${org} and project_id=${project} and status in ('QUEUED','RUNNING','PAUSED','BLOCKED','WAITING_APPROVAL')
          union all select 1 from performance_review_jobs where organization_id=${org} and project_id=${project} and status in ('QUEUED','RUNNING','UNKNOWN')
          union all select 1 from integration_merge_requests where organization_id=${org} and project_id=${project} and (status in ('QUEUED','RUNNING','UNKNOWN') or status in ('REQUESTED','APPROVED') and expires_at>now()) limit 1`;
        if (active.length) throw new ApiError(409, 'PROJECT_HAS_ACTIVE_WORK', '진행 실행·승인을 먼저 명시적으로 정리하세요.');
      }
      const rows = await tx`update projects set status=${input.action === 'archive' ? 'ARCHIVED' : 'ACTIVE'},version=version+1,updated_at=now() where organization_id=${org} and id=${project} returning id,status,version`;
      await emit(tx, { organizationId: org, projectId: project, type: 'project.updated', aggregateVersion: Number(rows[0].version), payload: { status: rows[0].status } });
      await audit(tx, c, `project.${input.action}`, 'project', project, project); return { status: 200, data: rows[0] };
    });
  });
  routes.post('/departments', async c => {
    const input = await body(c.req.raw, z.strictObject({ nameKo: z.string().trim().min(1).max(80) }));
    return mutate(database, c, input, async tx => {
      const org = c.get('auth').organizationId, existing = await tx`select 1 from departments where organization_id=${org} and name_ko=${input.nameKo}`;
      if (existing.length) throw new ApiError(409, 'DEPARTMENT_EXISTS', '같은 이름의 부서가 있습니다.');
      const id = randomUUID(); await tx`insert into departments(id,organization_id,name_ko) values(${id},${org},${input.nameKo})`;
      await audit(tx,c,'department.created','department',id); await emit(tx,{organizationId:org,type:'company.updated',aggregateVersion:1,payload:{departmentId:id}});
      return { status: 201, data: { id, nameKo: input.nameKo, status: 'ACTIVE', version: 1 } };
    });
  });
  routes.post('/departments/:id/archive', async c => {
    const input=await body(c.req.raw,z.strictObject({expectedVersion:version})), org=c.get('auth').organizationId, id=c.req.param('id');
    if(!uuid.safeParse(id).success)throw new ApiError(404,'NOT_FOUND','부서를 찾을 수 없습니다.');
    return mutate(database,c,input,async tx=>{
      const rows=await tx`select * from departments where organization_id=${org} and id=${id}`;
      if(!rows[0]) throw new ApiError(404,'NOT_FOUND','부서를 찾을 수 없습니다.');
      if(rows[0].version!==input.expectedVersion) throw new ApiError(409,'VERSION_CONFLICT','부서가 변경됐습니다.');
      if((await tx`select 1 from employee_departments where organization_id=${org} and department_id=${id}`).length) throw new ApiError(409,'DEPARTMENT_NOT_EMPTY','직원을 재배치한 뒤 보관하세요.');
      await tx`update departments set status='ARCHIVED',version=version+1 where id=${id}`;
      await audit(tx,c,'department.archived','department',id);await emit(tx,{organizationId:org,type:'company.updated',aggregateVersion:input.expectedVersion+1,payload:{departmentId:id}});
      return{status:200,data:{id,status:'ARCHIVED',version:input.expectedVersion+1}};
    });
  });
  routes.post('/employees/:id/department',async c=>{
    const input=await body(c.req.raw,z.strictObject({departmentId:uuid.nullable(),expectedVersion:version})),org=c.get('auth').organizationId,id=c.req.param('id');
    if(!uuid.safeParse(id).success)throw new ApiError(404,'NOT_FOUND','직원을 찾을 수 없습니다.');
    return mutate(database,c,input,async tx=>{
      const employees=await tx`select e.*,p.config from employees e join employee_profiles p on p.organization_id=e.organization_id and p.employee_id=e.id and p.version=e.current_profile_version where e.organization_id=${org} and e.id=${id}`;
      const employee=employees[0];if(!employee)throw new ApiError(404,'NOT_FOUND','직원을 찾을 수 없습니다.');
      if(employee.version!==input.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT','직원이 변경됐습니다.');
      let name='미배정';
      if(input.departmentId){const department=await tx`select name_ko from departments where organization_id=${org} and id=${input.departmentId} and status='ACTIVE'`;if(!department[0])throw new ApiError(404,'NOT_FOUND','활성 부서를 찾을 수 없습니다.');name=department[0].name_ko;
        await tx`insert into employee_departments(organization_id,employee_id,department_id) values(${org},${id},${input.departmentId}) on conflict(organization_id,employee_id) do update set department_id=excluded.department_id,version=employee_departments.version+1`;
      }else await tx`delete from employee_departments where organization_id=${org} and employee_id=${id}`;
      const profile={...(employee.config as StaffingProfile),profileVersion:Number(employee.current_profile_version)+1,departmentKo:name};
      await tx`insert into employee_profiles(organization_id,employee_id,version,config) values(${org},${id},${profile.profileVersion},${tx.json(jsonValue(profile))})`;
      await tx`update employees set current_profile_version=${profile.profileVersion},version=version+1,updated_at=now() where id=${id}`;
      await tx`insert into employee_department_events(id,organization_id,employee_id,department_id,actor_id) values(${randomUUID()},${org},${id},${input.departmentId},${c.get('auth').userId})`;
      await emit(tx,{organizationId:org,type:'employee.profile.updated',aggregateVersion:Number(employee.version)+1,payload:{employeeId:id,departmentId:input.departmentId}});
      await audit(tx,c,'employee.department.updated','employee',id);return{status:200,data:{id,departmentId:input.departmentId,profileVersion:profile.profileVersion,version:Number(employee.version)+1}};
    });
  });
  return routes;
}
