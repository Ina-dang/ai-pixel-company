import { randomUUID } from 'node:crypto';
import { ExecutionBlocked, initialCheckpoint, type Checkpoint, type RunStatus, type WorkflowRun, type WorkflowStore } from '@ai-pixel/agents';
import type { Database, Transaction } from '@ai-pixel/db';
import type postgres from 'postgres';
import { z } from 'zod';
import { emit, lockOrganization } from './repository.js';
import { authorizeStaffingRole, pinRunStaffing, readRunStaffing } from './staffing.js';
import { dependencyBlock, reserveExecution, settleExecution, sharedSlotAvailable } from './execution-policy.js';
import type { Role, StaffingProfile, StaffingTool } from '@ai-pixel/agents';

const usageSchema = z.object({ inputTokens: z.number().int().nonnegative(), cachedInputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() });
const fileSchema = z.object({ path: z.string().max(256), content: z.string().max(100_000) });
const shaSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const checkpointSchema = z.object({
  stage: z.enum(['PM', 'DEVELOPER', 'VERIFY', 'QA']), rework: z.number().int().min(0).max(2), turns: z.number().int().min(0).max(20), usage: usageSchema,
  roles: z.array(z.object({ role: z.enum(['PM', 'DEVELOPER', 'QA']), threadId: z.string().min(1), turnId: z.string().min(1).nullable(),
    output: z.object({ summaryKo: z.string(), specEn: z.string(), acceptanceCriteria: z.array(z.object({ id: z.string(), description: z.string() })), files: z.array(fileSchema).max(20),
      verdict: z.enum(['PASS', 'FAIL', 'NA']), candidateSha: z.string(), issues: z.array(z.string()) }),
    usage: usageSchema, candidateSha: shaSchema.nullable(), completedAt: z.iso.datetime() })).max(20),
  workspace: z.object({ files: z.array(fileSchema).max(32), sha: shaSchema, diff: z.string().max(500_000) }).nullable(),
  verification: z.object({ sha: shaSchema, test: z.object({ exitCode: z.number().int(), output: z.string() }), build: z.object({ exitCode: z.number().int(), output: z.string() }),
    sandbox: z.object({ networkDisabled: z.boolean(), readOnlyRoot: z.boolean(), resourceLimited: z.boolean() }), verifiedAt: z.iso.datetime() }).nullable(),
  activeThreadId: z.string().nullable(), activeTurnId: z.string().nullable(), startedAt: z.iso.datetime().nullable(), stopReason: z.string().nullable(),
});

export type WorkflowRow = {
  id: string; organization_id: string; project_id: string; task_id: string; command_original_ko: string;
  status: RunStatus; version: number; checkpoint: Checkpoint; lease_token: string | null; lease_expires_at: Date | null; stop_lease_token: string | null;
  created_at: Date; updated_at: Date;
};
export function workflowView(row: WorkflowRow): WorkflowRun {
  return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, taskId: row.task_id,
    commandOriginalKo: row.command_original_ko, status: row.status, version: row.version, checkpoint: row.checkpoint,
    leaseToken: row.lease_token, leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
// Lease credentials remain private to the worker, even to authenticated dashboard clients.
export function publicWorkflow(row: WorkflowRow, staffing?: StaffingProfile[]) {
  const { leaseToken: _leaseToken, ...run } = workflowView(row);
  return { ...run, ...(staffing ? { staffing } : {}), stopping: row.stop_lease_token !== null,
    resumable: ['PAUSED', 'BLOCKED'].includes(row.status) && !row.checkpoint.activeThreadId && !row.checkpoint.activeTurnId
      && !row.stop_lease_token && !['RECOVERY_REQUIRED', 'STOP_UNVERIFIABLE'].includes(row.checkpoint.stopReason ?? '') };
}
export const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as postgres.JSONValue;

export async function recordWorkflow(tx: Transaction, row: WorkflowRow, previous?: Checkpoint, type: 'workflow.run.created' | 'workflow.run.updated' = 'workflow.run.updated') {
  await emit(tx, { organizationId: row.organization_id, projectId: row.project_id, taskId: row.task_id, runId: row.id,
    type, aggregateVersion: row.version, payload: { runId: row.id, status: row.status, stage: row.checkpoint.stage, version: row.version, stopReason: row.checkpoint.stopReason } });
  for (const role of row.checkpoint.roles.slice(previous?.roles.length ?? row.checkpoint.roles.length)) {
    await emit(tx, { organizationId: row.organization_id, projectId: row.project_id, taskId: row.task_id, runId: row.id,
      type: 'agent.completed', aggregateVersion: row.version, payload: { runId: row.id, role: role.role, candidateSha: role.candidateSha, summaryKo: role.output.summaryKo } });
  }
  if (row.status === 'WAITING_APPROVAL') await emit(tx, { organizationId: row.organization_id, projectId: row.project_id, taskId: row.task_id,
    runId: row.id, type: 'approval.requested', aggregateVersion: row.version, payload: { runId: row.id, candidateSha: row.checkpoint.workspace?.sha ?? null } });
  await tx`insert into audit_logs (id,organization_id,project_id,actor_type,actor_id,action,target_type,target_id,request_id,outcome,metadata)
    values (${randomUUID()},${row.organization_id},${row.project_id},'SYSTEM','subscription-worker',${type},'workflow_run',${row.id},${randomUUID()},'SUCCESS',
    ${tx.json({ version: row.version, status: row.status, stage: row.checkpoint.stage })})`;
}
export async function updateTaskForRun(tx: Transaction, row: WorkflowRow) {
  const status = row.status === 'SUCCEEDED' ? 'COMPLETED' : row.status === 'FAILED' ? 'FAILED' : row.status === 'CANCELLED' ? 'CANCELLED'
    : row.status === 'WAITING_APPROVAL' ? 'APPROVAL_REQUIRED' : row.status === 'RUNNING'
      ? row.checkpoint.stage === 'PM' ? 'PLANNING' : row.checkpoint.stage === 'QA' ? 'REVIEW' : 'IN_PROGRESS' : null;
  const blocked = row.status === 'BLOCKED' ? row.checkpoint.stopReason : null;
  const pm = row.checkpoint.roles.find((role) => role.role === 'PM');
  const updated = await tx<{ version: number; status: string }[]>`update tasks set status=coalesce(${status}::text,status),blocked_reason=${blocked},
    spec_en=coalesce(${pm?.output.specEn ?? null}::text,spec_en),version=version+1,updated_at=now()
    where organization_id=${row.organization_id} and id=${row.task_id} returning version,status`;
  await emit(tx, { organizationId: row.organization_id, projectId: row.project_id, taskId: row.task_id, runId: row.id,
    type: 'task.status.changed', aggregateVersion: updated[0].version, payload: { id: row.task_id, status: updated[0].status, latestRunId: row.id } });
}

export class WorkflowRepository implements WorkflowStore {
  constructor(readonly database: Database) {}
  async authorizeRole(runId: string, role: Role, requiredTools: StaffingTool[]) {
    const profile = await authorizeStaffingRole(this.database, runId, role, requiredTools);
    const limit = await this.database.sql.begin(async tx => {
      const rows = await tx<WorkflowRow[]>`select * from workflow_runs where id=${runId}`;
      if (!rows[0]) throw new ExecutionBlocked('LEASE_LOST');
      const run = rows[0]; await lockOrganization(tx, run.organization_id);
      const blocked = await dependencyBlock(tx, run.organization_id, run.project_id, run.task_id);
      if (blocked) throw new ExecutionBlocked(blocked);
      return reserveExecution(tx, { org: run.organization_id, project: run.project_id, operation: run.id, kind: 'WORKFLOW',
        totalTokens: run.checkpoint.usage.inputTokens + run.checkpoint.usage.outputTokens, profileLimit: profile.limits.maxTokens });
    });
    return { ...profile, limits: { ...profile.limits, maxTokens: Math.min(profile.limits.maxTokens, limit) } };
  }
  async get(id: string) {
    const rows = await this.database.sql<WorkflowRow[]>`select * from workflow_runs where id=${id}`;
    return rows[0] ? { ...workflowView(rows[0]), staffing: await readRunStaffing(this.database.sql, id) } : null;
  }
  async claim() {
    // One local subscription backs all projects. An unconfirmed stop survives
    // restart and fences other queued work, including when no thread ID arrived.
    const unsafe = await this.database.sql`select 1 from workflow_runs where stop_lease_token is not null
      or checkpoint->>'stopReason' in ('STOP_UNVERIFIABLE','RECOVERY_REQUIRED') limit 1`;
    if (unsafe.length) return null;
    // Lock order is organization counter, run, task in every mutation.
    const candidates = await this.database.sql<{ organization_id: string }[]>`select organization_id from
      (select organization_id,created_at from workflow_runs where status='QUEUED' union all select organization_id,created_at from task_schedules where enabled=true) q
      group by organization_id order by min(created_at) limit 100`;
    for (const candidate of candidates) {
      const result = await this.database.sql.begin(async (tx) => {
        if (!await sharedSlotAvailable(tx)) return null;
        await lockOrganization(tx, candidate.organization_id);
        await this.queueScheduled(tx, candidate.organization_id);
        const rows = await tx<WorkflowRow[]>`select r.* from workflow_runs r join tasks t on t.organization_id=r.organization_id and t.id=r.task_id
          where r.organization_id=${candidate.organization_id} and r.status='QUEUED'
          order by case t.priority when 'URGENT' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 else 1 end desc,r.created_at,r.id for update of r skip locked limit 1`;
        if (!rows[0]) return null;
        const pending = rows[0], profiles = await readRunStaffing(tx, pending.id);
        try {
          const block = await dependencyBlock(tx, pending.organization_id, pending.project_id, pending.task_id);
          if (block) throw new ExecutionBlocked(block);
          await reserveExecution(tx, { org: pending.organization_id, project: pending.project_id, operation: pending.id, kind: 'WORKFLOW',
            totalTokens: pending.checkpoint.usage.inputTokens + pending.checkpoint.usage.outputTokens, profileLimit: Math.min(500000, ...profiles.map(p => p.limits.maxTokens)) });
        } catch (error) {
          const checkpoint = { ...pending.checkpoint, stopReason: error instanceof ExecutionBlocked ? error.reason : 'POLICY_UNVERIFIABLE' };
          const changed = await tx<WorkflowRow[]>`update workflow_runs set status='BLOCKED',checkpoint=${tx.json(jsonValue(checkpoint))},version=version+1,updated_at=now() where id=${pending.id} returning *`;
          await settleExecution(tx, pending.organization_id, pending.id, pending.checkpoint.usage.inputTokens + pending.checkpoint.usage.outputTokens, 'SETTLED');
          await updateTaskForRun(tx, changed[0]); await recordWorkflow(tx, changed[0]); return null;
        }
        const claimed = await tx<WorkflowRow[]>`update workflow_runs set status='RUNNING',lease_token=${randomUUID()},lease_expires_at=now()+interval '60 seconds',stop_lease_token=null,version=version+1,updated_at=now()
          where id=${rows[0].id} returning *`;
        await updateTaskForRun(tx, claimed[0]);
        await recordWorkflow(tx, claimed[0]);
        return { ...workflowView(claimed[0]), staffing: await readRunStaffing(tx, claimed[0].id) };
      });
      if (result) return result;
    }
    return null;
  }
  private async queueScheduled(tx: Transaction, org: string) {
    const schedules = await tx<{ task_id: string; project_id: string; requested_by: string; command_original_ko: string }[]>`select s.task_id,s.project_id,s.requested_by,t.command_original_ko
      from task_schedules s join tasks t on t.organization_id=s.organization_id and t.id=s.task_id
      where s.organization_id=${org} and s.enabled=true and t.status in ('TODO','FAILED')
      order by case t.priority when 'URGENT' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 else 1 end desc,s.created_at,s.task_id`;
    for (const schedule of schedules) {
      let reason = await dependencyBlock(tx, org, schedule.project_id, schedule.task_id);
      const owner = await tx`select 1 from memberships where organization_id=${org} and user_id=${schedule.requested_by} and role='OWNER' and status='ACTIVE'`;
      if (!owner.length) reason = 'OWNER_PERMISSION_REVOKED';
      const active = await tx`select 1 from workflow_runs where organization_id=${org} and task_id=${schedule.task_id} and status in ('QUEUED','RUNNING','PAUSED','BLOCKED','WAITING_APPROVAL')`;
      if (active.length) reason = 'ACTIVE_RUN_EXISTS';
      if (!reason) {
        try {
          await tx.savepoint(async sub => {
            const rows = await sub<WorkflowRow[]>`insert into workflow_runs(id,organization_id,project_id,task_id,command_original_ko,fixture,checkpoint)
              values(${randomUUID()},${org},${schedule.project_id},${schedule.task_id},${schedule.command_original_ko},'node-functions-v1',${sub.json(jsonValue(initialCheckpoint()))}) returning *`;
            const run = rows[0], profiles = await pinRunStaffing(sub, org, schedule.project_id, run.id);
            await reserveExecution(sub, { org, project: schedule.project_id, operation: run.id, kind: 'WORKFLOW', totalTokens: 0, profileLimit: Math.min(...profiles.map(p => p.limits.maxTokens)) });
            await sub`update task_schedules set enabled=false,run_id=${run.id},reason=null,version=version+1,updated_at=now() where organization_id=${org} and task_id=${schedule.task_id}`;
            await recordWorkflow(sub, run, undefined, 'workflow.run.created');
          });
          continue;
        } catch (error) { reason = error instanceof ExecutionBlocked ? error.reason : 'STAFFING_OR_POLICY_UNAVAILABLE'; }
      }
      await tx`update task_schedules set reason=${reason},updated_at=now() where organization_id=${org} and task_id=${schedule.task_id} and reason is distinct from ${reason}`;
      if (reason === 'DEPENDENCY') await tx`update tasks set blocked_reason='DEPENDENCY' where organization_id=${org} and id=${schedule.task_id} and status='TODO'`;
    }
  }
  async save(id: string, leaseToken: string, change: { status?: RunStatus; checkpoint?: Checkpoint }) {
    if (change.checkpoint) checkpointSchema.parse(change.checkpoint);
    if (change.status && !['RUNNING', 'PAUSED', 'BLOCKED', 'WAITING_APPROVAL', 'FAILED', 'CANCELLED'].includes(change.status)) throw new Error('Worker cannot authorize result acceptance.');
    const organization = await this.database.sql<{ organization_id: string }[]>`select organization_id from workflow_runs where id=${id}`;
    if (!organization[0]) return false;
    return this.database.sql.begin(async (tx) => {
      await lockOrganization(tx, organization[0].organization_id);
      const rows = await tx<WorkflowRow[]>`select * from workflow_runs where id=${id} and status='RUNNING' and lease_token=${leaseToken} and lease_expires_at>now() for update`;
      if (!rows[0]) return false;
      const checkpoint = change.checkpoint ?? rows[0].checkpoint;
      const status = change.status ?? rows[0].status;
      const updated = await tx<WorkflowRow[]>`update workflow_runs set status=${status},checkpoint=${tx.json(jsonValue(checkpoint))},version=version+1,updated_at=now(),
        lease_token=${status === 'RUNNING' ? leaseToken : null}::uuid,lease_expires_at=${status === 'RUNNING' ? tx`now()+interval '60 seconds'` : tx`null`}
        where id=${id} returning *`;
      await settleExecution(tx, rows[0].organization_id, id, checkpoint.usage.inputTokens + checkpoint.usage.outputTokens,
        checkpoint.stopReason === 'STOP_UNVERIFIABLE' ? 'UNKNOWN' : status === 'RUNNING' ? 'HELD' : 'SETTLED');
      await updateTaskForRun(tx, updated[0]);
      await recordWorkflow(tx, updated[0], rows[0].checkpoint);
      return true;
    });
  }
  async heartbeat(id: string, leaseToken: string) {
    const rows = await this.database.sql`update workflow_runs set lease_expires_at=now()+interval '60 seconds'
      where id=${id} and lease_token=${leaseToken} and status='RUNNING' and lease_expires_at>now() returning id`;
    return rows.length === 1;
  }
  async acknowledgeStop(id: string, oldLeaseToken: string) {
    const organization = await this.database.sql<{ organization_id: string }[]>`select organization_id from workflow_runs where id=${id}`;
    if (!organization[0]) return false;
    return this.database.sql.begin(async (tx) => {
      await lockOrganization(tx, organization[0].organization_id);
      const rows = await tx<WorkflowRow[]>`select * from workflow_runs where id=${id} and status in ('PAUSED','CANCELLED') and stop_lease_token=${oldLeaseToken} for update`;
      if (!rows[0]) return false;
      const checkpoint = { ...rows[0].checkpoint, activeThreadId: null, activeTurnId: null };
      const updated = await tx<WorkflowRow[]>`update workflow_runs set checkpoint=${tx.json(jsonValue(checkpoint))},stop_lease_token=null,version=version+1,updated_at=now() where id=${id} returning *`;
      await settleExecution(tx, rows[0].organization_id, id, checkpoint.usage.inputTokens + checkpoint.usage.outputTokens, 'SETTLED');
      await recordWorkflow(tx, updated[0]);
      return true;
    });
  }
  async recover() {
    const expired = await this.database.sql<{ id: string; organization_id: string }[]>`select id,organization_id from workflow_runs where status='RUNNING' and lease_expires_at<=now()`;
    let recovered = 0;
    for (const candidate of expired) {
      recovered += await this.database.sql.begin(async (tx) => {
        await lockOrganization(tx, candidate.organization_id);
        const rows = await tx<WorkflowRow[]>`select * from workflow_runs where id=${candidate.id} and status='RUNNING' and lease_expires_at<=now() for update`;
        if (!rows[0]) return 0;
        const checkpoint = { ...rows[0].checkpoint, stopReason: 'RECOVERY_REQUIRED' };
        const updated = await tx<WorkflowRow[]>`update workflow_runs set status='BLOCKED',checkpoint=${tx.json(jsonValue(checkpoint))},lease_token=null,lease_expires_at=null,version=version+1,updated_at=now() where id=${candidate.id} returning *`;
        await updateTaskForRun(tx, updated[0]);
        await recordWorkflow(tx, updated[0]);
        return 1;
      });
    }
    return recovered;
  }
}

export { initialCheckpoint };
