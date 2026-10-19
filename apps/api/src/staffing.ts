import { randomUUID } from 'node:crypto';
import { ExecutionBlocked, type Role, type StaffingProfile, type StaffingTool } from '@ai-pixel/agents';
import { idSchema } from '@ai-pixel/contracts';
import type { Database, Transaction } from '@ai-pixel/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit, emit, mutate } from './repository.js';
import { type ApiEnv, ApiError } from './security.js';
import { jsonValue, recordWorkflow, type WorkflowRow, updateTaskForRun } from './workflows.js';

const roles = ['PM', 'DEVELOPER', 'QA'] as const;
const tools = ['PLAN', 'EDIT_FILES', 'VERIFY', 'REVIEW'] as const;
const roleTools: Record<Role, StaffingTool[]> = { PM: ['PLAN'], DEVELOPER: ['EDIT_FILES'], QA: ['VERIFY', 'REVIEW'] };
const defaultNames: Record<Role, string> = { PM: '기본 PM', DEVELOPER: '기본 개발자', QA: '기본 QA' };
const departments: Record<Role, string> = { PM: '기획', DEVELOPER: '개발', QA: '품질' };
const avatar: Record<Role, StaffingProfile['avatar']> = { PM: 'pm', DEVELOPER: 'developer', QA: 'qa' };
const limitsSchema = z.strictObject({ maxTurns: z.number().int().min(1).max(7), maxTokens: z.number().int().min(1000).max(500000), maxElapsedMs: z.number().int().min(1000).max(900000) });
const editable = {
  nameKo: z.string().trim().min(1).max(80), provider: z.literal('CHATGPT_SUBSCRIPTION'), model: z.literal('codex-default'),
  rolePrompt: z.string().min(1).max(4000), skills: z.array(z.string().trim().min(1).max(80)).max(10),
  departmentKo: z.string().trim().min(1).max(80), workStyleKo: z.string().trim().min(1).max(300),
  tools: z.array(z.enum(tools)).min(1).max(4).refine(value => new Set(value).size === value.length),
  limits: limitsSchema, avatar: z.enum(['pm', 'developer', 'qa']),
};
export const staffingProfileSchema = z.strictObject({ employeeId: idSchema, role: z.enum(roles), profileVersion: z.number().int().positive(), ...editable });
const createSchema = z.strictObject({ template: z.enum(roles), nameKo: editable.nameKo, provider: editable.provider.optional(), model: editable.model.optional(),
  rolePrompt: editable.rolePrompt.optional(), skills: editable.skills.optional(), departmentKo: editable.departmentKo.optional(), workStyleKo: editable.workStyleKo.optional(),
  tools: editable.tools.optional(), limits: limitsSchema.optional(), avatar: editable.avatar.optional() });
const patchSchema = z.strictObject(editable).partial().extend({ expectedVersion: z.number().int().positive() }).refine(value => Object.keys(value).length > 1, 'A profile field is required.');
const employmentSchema = z.strictObject({ expectedVersion: z.number().int().positive(), action: z.enum(['suspend', 'retire', 'rehire']) });
const assignmentSchema = z.strictObject({ role: z.enum(roles), employeeId: idSchema, expectedVersion: z.number().int().positive().optional() });
const versionSchema = z.strictObject({ expectedVersion: z.number().int().positive() });
type EmployeeRow = { id: string; organization_id: string; name_ko: string; role: Role; employment_status: 'ACTIVE' | 'SUSPENDED' | 'RETIRED'; version: number; current_profile_version: number; created_at: Date; updated_at: Date; config: StaffingProfile };
const employeeView = (row: EmployeeRow) => ({ id: row.id, organizationId: row.organization_id, nameKo: row.name_ko, role: row.role, employmentStatus: row.employment_status,
  version: row.version, currentProfileVersion: row.current_profile_version, profile: row.config, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const defaults = (employeeId: string, role: Role, nameKo: string): StaffingProfile => ({ employeeId, role, nameKo, profileVersion: 1, provider: 'CHATGPT_SUBSCRIPTION', model: 'codex-default',
  rolePrompt: 'Follow the bounded role contract and provide verifiable evidence.', skills: [], departmentKo: departments[role], workStyleKo: '근거를 확인하고 간결하게 보고합니다.',
  tools: roleTools[role], limits: { maxTurns: 7, maxTokens: 500000, maxElapsedMs: 900000 }, avatar: avatar[role] });
function validateProfile(value: unknown): StaffingProfile {
  const parsed = staffingProfileSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', '직원 프로필 입력을 확인하세요.');
  if (parsed.data.tools.some(tool => !roleTools[parsed.data.role].includes(tool))) throw new ApiError(400, 'UNSUPPORTED_CAPABILITY', '역할 템플릿에서 허용하지 않은 도구입니다.');
  return parsed.data;
}
function validId(value: string) {
  const parsed = idSchema.safeParse(value); if (!parsed.success) throw new ApiError(404, 'NOT_FOUND', '대상을 찾을 수 없습니다.'); return parsed.data;
}
async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(400, 'INVALID_INPUT', 'JSON 요청을 사용하세요.');
  let value: unknown; try { value = await request.json(); } catch { throw new ApiError(400, 'INVALID_INPUT', 'JSON 요청을 읽을 수 없습니다.'); }
  const parsed = schema.safeParse(value); if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', '입력 내용을 확인하세요.'); return parsed.data;
}
async function employee(tx: Transaction, organizationId: string, id: string, expectedVersion?: number) {
  const rows = await tx<EmployeeRow[]>`select e.*,p.config from employees e join employee_profiles p on p.organization_id=e.organization_id and p.employee_id=e.id and p.version=e.current_profile_version
    where e.organization_id=${organizationId} and e.id=${id} for update of e`;
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', '직원을 찾을 수 없습니다.');
  if (expectedVersion !== undefined && rows[0].version !== expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', '직원이 변경됐습니다. 새로고침하세요.');
  return rows[0];
}
async function requireProject(tx: Transaction, organizationId: string, projectId: string) {
  const found = await tx`select 1 from projects where organization_id=${organizationId} and id=${projectId}`;
  if (!found.length) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
}
async function fenceRuns(tx: Transaction, organizationId: string, employeeId: string, projectId?: string, role?: Role) {
  const candidates = await tx<WorkflowRow[]>`select r.* from workflow_runs r where r.organization_id=${organizationId}
    and r.status in ('QUEUED','RUNNING','PAUSED','BLOCKED','WAITING_APPROVAL') and exists (
      select 1 from workflow_staffing_snapshots s where s.organization_id=r.organization_id and s.run_id=r.id and s.employee_id=${employeeId}
        ${projectId ? tx`and r.project_id=${projectId}` : tx``} ${role ? tx`and s.role=${role}` : tx``}) for update`;
  for (const run of candidates) {
    const checkpoint = { ...run.checkpoint, stopReason: run.checkpoint.stopReason === 'STOP_UNVERIFIABLE' ? 'STOP_UNVERIFIABLE' : 'STAFFING_PERMISSION_REVOKED' };
    const updated = await tx<WorkflowRow[]>`update workflow_runs set status='PAUSED',checkpoint=${tx.json(jsonValue(checkpoint))},
      stop_lease_token=coalesce(lease_token,stop_lease_token),lease_token=null,lease_expires_at=null,version=version+1,updated_at=now() where id=${run.id} returning *`;
    await updateTaskForRun(tx, updated[0]); await recordWorkflow(tx, updated[0]);
  }
}

/** Project initialization only: its durable marker prevents silent reassignment. */
export async function ensureDefaultStaffing(tx: Transaction, organizationId: string, projectId: string) {
  await requireProject(tx, organizationId, projectId);
  const initialized = await tx`insert into project_staffing_initializations (organization_id,project_id) values (${organizationId},${projectId}) on conflict do nothing returning project_id`;
  if (!initialized.length) return;
  for (const role of roles) {
    const found = await tx<{ id: string }[]>`select id from employees where organization_id=${organizationId} and role=${role} and is_baseline`;
    let employeeId = found[0]?.id;
    if (!employeeId) {
      const id = randomUUID(); const config = defaults(id, role, defaultNames[role]);
      await tx`insert into employees (id,organization_id,name_ko,role,is_baseline) values (${id},${organizationId},${config.nameKo},${role},true)`;
      await tx`insert into employee_profiles (organization_id,employee_id,version,config) values (${organizationId},${id},1,${tx.json(jsonValue(config))})`;
      await tx`insert into employee_employment_events (id,organization_id,employee_id,to_status) values (${randomUUID()},${organizationId},${id},'ACTIVE')`;
      employeeId = id;
    }
    await tx`insert into project_staffing (organization_id,project_id,role,employee_id) values (${organizationId},${projectId},${role},${employeeId})`;
  }
}
export async function pinRunStaffing(tx: Transaction, organizationId: string, projectId: string, runId: string): Promise<StaffingProfile[]> {
  const target = await tx`select 1 from workflow_runs where organization_id=${organizationId} and project_id=${projectId} and id=${runId}`;
  if (!target.length) throw new ApiError(404, 'NOT_FOUND', '실행을 찾을 수 없습니다.');
  const rows = await tx<EmployeeRow[]>`select e.*,p.config from project_staffing a join employees e on e.organization_id=a.organization_id and e.id=a.employee_id and e.role=a.role
    join employee_profiles p on p.organization_id=e.organization_id and p.employee_id=e.id and p.version=e.current_profile_version
    where a.organization_id=${organizationId} and a.project_id=${projectId} order by e.role`;
  if (rows.length !== 3 || rows.some(row => row.employment_status !== 'ACTIVE')) throw new ApiError(409, 'STAFFING_UNAVAILABLE', 'PM·개발자·QA 배정과 재직 상태를 확인하세요.');
  const profiles = rows.map(row => validateProfile(row.config));
  if (profiles.some(profile => roleTools[profile.role].some(tool => !profile.tools.includes(tool)))) throw new ApiError(409, 'STAFFING_UNAVAILABLE', '실행에 필요한 역할 도구가 배정되지 않았습니다.');
  for (const profile of profiles) await tx`insert into workflow_staffing_snapshots (organization_id,run_id,role,employee_id,profile_version,profile)
    values (${organizationId},${runId},${profile.role},${profile.employeeId},${profile.profileVersion},${tx.json(jsonValue(profile))})`;
  return profiles;
}
export async function readRunStaffing(sql: Database['sql'] | Transaction, runId: string): Promise<StaffingProfile[]> {
  const rows = await sql<{ profile: StaffingProfile }[]>`select profile from workflow_staffing_snapshots where run_id=${runId} order by role`;
  return rows.map(row => staffingProfileSchema.parse(row.profile));
}
export async function authorizeStaffingRole(database: Database, runId: string, role: Role, requiredTools: StaffingTool[]): Promise<StaffingProfile> {
  const rows = await database.sql<{ profile: StaffingProfile; current_config: StaffingProfile }[]>`
    select s.profile,p.config as current_config from workflow_staffing_snapshots s
      join workflow_runs r on r.organization_id=s.organization_id and r.id=s.run_id
      join employees e on e.organization_id=s.organization_id and e.id=s.employee_id and e.role=s.role and e.employment_status='ACTIVE'
      join project_staffing a on a.organization_id=r.organization_id and a.project_id=r.project_id and a.role=s.role and a.employee_id=e.id
      join employee_profiles p on p.organization_id=e.organization_id and p.employee_id=e.id and p.version=e.current_profile_version
    where s.run_id=${runId} and s.role=${role} and r.status='RUNNING' and r.lease_expires_at>now()`;
  if (!rows[0]) throw new ExecutionBlocked('STAFFING_PERMISSION_REVOKED');
  const pinned = staffingProfileSchema.safeParse(rows[0].profile), current = staffingProfileSchema.safeParse(rows[0].current_config);
  if (!pinned.success || !current.success || pinned.data.role !== role || pinned.data.tools.some(tool => !roleTools[role].includes(tool))
    || requiredTools.some(tool => !pinned.data.tools.includes(tool) || !current.data.tools.includes(tool))) throw new ExecutionBlocked('STAFFING_PERMISSION_REVOKED');
  return { ...pinned.data, limits: { maxTurns: Math.min(pinned.data.limits.maxTurns, current.data.limits.maxTurns),
    maxTokens: Math.min(pinned.data.limits.maxTokens, current.data.limits.maxTokens), maxElapsedMs: Math.min(pinned.data.limits.maxElapsedMs, current.data.limits.maxElapsedMs) } };
}

export function staffingRoutes(database: Database) {
  const routes = new Hono<ApiEnv>();
  routes.get('/employees/templates', c => c.json({ data: { items: roles.map(role => {
    const profile = defaults('11111111-1111-4111-8111-111111111111', role, defaultNames[role]);
    return { role, nameKo: profile.nameKo, tools: profile.tools, provider: profile.provider, model: profile.model, limits: profile.limits, avatar: profile.avatar };
  }) }, requestId: c.get('requestId') }));
  routes.get('/employees', async c => {
    const rows = await database.sql<EmployeeRow[]>`select e.*,p.config from employees e join employee_profiles p on p.organization_id=e.organization_id and p.employee_id=e.id and p.version=e.current_profile_version
      where e.organization_id=${c.get('auth').organizationId} order by e.created_at,e.id`;
    return c.json({ data: { items: rows.map(employeeView) }, requestId: c.get('requestId') });
  });
  routes.post('/employees', async c => {
    const input = await body(c.req.raw, createSchema);
    return mutate(database, c, input, async tx => {
      const auth = c.get('auth'); const id = randomUUID(); const { template, ...fields } = input;
      const config = validateProfile({ ...defaults(id, template, input.nameKo), ...fields });
      await tx`insert into employees (id,organization_id,name_ko,role) values (${id},${auth.organizationId},${config.nameKo},${template})`;
      await tx`insert into employee_profiles (organization_id,employee_id,version,config) values (${auth.organizationId},${id},1,${tx.json(jsonValue(config))})`;
      await tx`insert into employee_employment_events (id,organization_id,employee_id,to_status,actor_id) values (${randomUUID()},${auth.organizationId},${id},'ACTIVE',${auth.userId})`;
      await emit(tx, { organizationId: auth.organizationId, type: 'employee.created', aggregateVersion: 1, payload: { employeeId: id, role: template, profileVersion: 1 } });
      await audit(tx, c, 'employee.created', 'employee', id);
      return { status: 201, data: employeeView(await employee(tx, auth.organizationId, id)) };
    });
  });
  routes.get('/employees/:id', async c => {
    const id = validId(c.req.param('id')); const org = c.get('auth').organizationId;
    const rows = await database.sql<EmployeeRow[]>`select e.*,p.config from employees e join employee_profiles p on p.organization_id=e.organization_id and p.employee_id=e.id and p.version=e.current_profile_version where e.organization_id=${org} and e.id=${id}`;
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', '직원을 찾을 수 없습니다.');
    const profiles = await database.sql<{ config: StaffingProfile }[]>`select config from employee_profiles where organization_id=${org} and employee_id=${id} order by version`;
    const events = await database.sql<{ id: string; from_status: string | null; to_status: string; created_at: Date }[]>`select id,from_status,to_status,created_at from employee_employment_events where organization_id=${org} and employee_id=${id} order by created_at,id`;
    return c.json({ data: { ...employeeView(rows[0]), profiles: profiles.map(row => row.config), employmentHistory: events.map(row => ({ id: row.id, fromStatus: row.from_status, toStatus: row.to_status, createdAt: row.created_at.toISOString() })) }, requestId: c.get('requestId') });
  });
  routes.patch('/employees/:id', async c => {
    const id = validId(c.req.param('id')); const input = await body(c.req.raw, patchSchema);
    return mutate(database, c, input, async tx => {
      const org = c.get('auth').organizationId; const previous = await employee(tx, org, id, input.expectedVersion);
      const { expectedVersion: _version, ...fields } = input;
      const config = validateProfile({ ...previous.config, ...fields, profileVersion: previous.current_profile_version + 1 });
      await tx`insert into employee_profiles (organization_id,employee_id,version,config) values (${org},${id},${config.profileVersion},${tx.json(jsonValue(config))})`;
      await tx`update employees set name_ko=${config.nameKo},current_profile_version=${config.profileVersion},version=version+1,updated_at=now() where organization_id=${org} and id=${id}`;
      if (previous.config.tools.some(tool => !config.tools.includes(tool)) || Object.keys(config.limits).some(key => config.limits[key as keyof typeof config.limits] < previous.config.limits[key as keyof typeof config.limits])) await fenceRuns(tx, org, id);
      await emit(tx, { organizationId: org, type: 'employee.profile.updated', aggregateVersion: previous.version + 1, payload: { employeeId: id, profileVersion: config.profileVersion } });
      await audit(tx, c, 'employee.profile.updated', 'employee', id);
      return { status: 200, data: employeeView(await employee(tx, org, id)) };
    });
  });
  routes.post('/employees/:id/employment', async c => {
    const id = validId(c.req.param('id')); const input = await body(c.req.raw, employmentSchema);
    return mutate(database, c, input, async tx => {
      const auth = c.get('auth'); const previous = await employee(tx, auth.organizationId, id, input.expectedVersion);
      const next = input.action === 'suspend' ? 'SUSPENDED' : input.action === 'retire' ? 'RETIRED' : 'ACTIVE';
      if (next === previous.employment_status || input.action === 'suspend' && previous.employment_status !== 'ACTIVE' || input.action === 'rehire' && previous.employment_status === 'ACTIVE') throw new ApiError(409, 'INVALID_TRANSITION', '현재 고용 상태에서 요청할 수 없습니다.');
      let profileVersion = previous.current_profile_version;
      if (next === 'ACTIVE') {
        profileVersion++;
        await tx`insert into employee_profiles (organization_id,employee_id,version,config) values (${auth.organizationId},${id},${profileVersion},${tx.json(jsonValue({ ...previous.config, profileVersion }))})`;
      } else await fenceRuns(tx, auth.organizationId, id);
      await tx`update employees set employment_status=${next},current_profile_version=${profileVersion},version=version+1,updated_at=now() where organization_id=${auth.organizationId} and id=${id}`;
      await tx`insert into employee_employment_events (id,organization_id,employee_id,from_status,to_status,actor_id) values (${randomUUID()},${auth.organizationId},${id},${previous.employment_status},${next},${auth.userId})`;
      await emit(tx, { organizationId: auth.organizationId, type: 'employee.employment.changed', aggregateVersion: previous.version + 1, payload: { employeeId: id, employmentStatus: next, profileVersion } });
      await audit(tx, c, 'employee.employment.changed', 'employee', id);
      return { status: 200, data: employeeView(await employee(tx, auth.organizationId, id)) };
    });
  });
  routes.get('/projects/:id/staffing', async c => {
    const id = validId(c.req.param('id')); const org = c.get('auth').organizationId;
    const project = await database.sql`select 1 from projects where organization_id=${org} and id=${id}`;
    if (!project.length) throw new ApiError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    const rows = await database.sql<{ role: Role; employee_id: string; name_ko: string; current_profile_version: number; version: number; employment_status: string }[]>`select a.role,a.employee_id,e.name_ko,e.current_profile_version,a.version,e.employment_status
      from project_staffing a join employees e on e.organization_id=a.organization_id and e.id=a.employee_id where a.organization_id=${org} and a.project_id=${id} order by a.role`;
    return c.json({ data: { items: rows.map(row => ({ role: row.role, employeeId: row.employee_id, employeeNameKo: row.name_ko, profileVersion: row.current_profile_version, version: row.version, employmentStatus: row.employment_status })) }, requestId: c.get('requestId') });
  });
  routes.put('/projects/:id/staffing', async c => {
    const id = validId(c.req.param('id')); const input = await body(c.req.raw, assignmentSchema);
    return mutate(database, c, input, async tx => {
      const org = c.get('auth').organizationId; await requireProject(tx, org, id);
      const hired = await employee(tx, org, input.employeeId);
      if (hired.role !== input.role || hired.employment_status !== 'ACTIVE') throw new ApiError(409, 'STAFFING_UNAVAILABLE', '역할과 재직 상태를 확인하세요.');
      const previous = await tx<{ employee_id: string; version: number }[]>`select employee_id,version from project_staffing where organization_id=${org} and project_id=${id} and role=${input.role} for update`;
      if (previous[0] ? previous[0].version !== input.expectedVersion : input.expectedVersion !== undefined) throw new ApiError(409, 'VERSION_CONFLICT', '배정이 변경됐습니다. 새로고침하세요.');
      if (previous[0] && previous[0].employee_id !== hired.id) await fenceRuns(tx, org, previous[0].employee_id, id, input.role);
      const assigned = await tx<{ version: number }[]>`insert into project_staffing (organization_id,project_id,role,employee_id) values (${org},${id},${input.role},${hired.id})
        on conflict (organization_id,project_id,role) do update set employee_id=excluded.employee_id,version=nextval('staffing_assignment_version_seq'),updated_at=now() returning version`;
      await emit(tx, { organizationId: org, projectId: id, type: 'project.staffing.updated', aggregateVersion: assigned[0].version, payload: { role: input.role, employeeId: hired.id } });
      await audit(tx, c, 'project.staffing.updated', 'project', id, id);
      return { status: 200, data: { role: input.role, employeeId: hired.id, employeeNameKo: hired.name_ko, profileVersion: hired.current_profile_version, version: assigned[0].version, employmentStatus: hired.employment_status } };
    });
  });
  routes.delete('/projects/:id/staffing/:role', async c => {
    const id = validId(c.req.param('id')); const parsedRole = z.enum(roles).safeParse(c.req.param('role'));
    if (!parsedRole.success) throw new ApiError(404, 'NOT_FOUND', '역할을 찾을 수 없습니다.');
    const input = await body(c.req.raw, versionSchema);
    return mutate(database, c, input, async tx => {
      const org = c.get('auth').organizationId; await requireProject(tx, org, id);
      const previous = await tx<{ employee_id: string; version: number }[]>`select employee_id,version from project_staffing where organization_id=${org} and project_id=${id} and role=${parsedRole.data} for update`;
      if (!previous[0]) throw new ApiError(404, 'NOT_FOUND', '배정을 찾을 수 없습니다.');
      if (previous[0].version !== input.expectedVersion) throw new ApiError(409, 'VERSION_CONFLICT', '배정이 변경됐습니다. 새로고침하세요.');
      await fenceRuns(tx, org, previous[0].employee_id, id, parsedRole.data);
      await tx`delete from project_staffing where organization_id=${org} and project_id=${id} and role=${parsedRole.data}`;
      await emit(tx, { organizationId: org, projectId: id, type: 'project.staffing.updated', aggregateVersion: previous[0].version + 1, payload: { role: parsedRole.data, employeeId: null } });
      await audit(tx, c, 'project.staffing.updated', 'project', id, id);
      return { status: 200, data: { unassigned: true, role: parsedRole.data } };
    });
  });
  return routes;
}
