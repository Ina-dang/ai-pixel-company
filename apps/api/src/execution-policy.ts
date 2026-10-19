import { ExecutionBlocked } from '@ai-pixel/agents';
import type { Transaction } from '@ai-pixel/db';
import {maintenanceReason} from './maintenance.js';

export const executionDefaults = { companyMonthlyTokens: 2000000, projectMonthlyTokens: 1000000, runTokens: 500000, reviewTokens: 50000, providerSlots: 1 } as const;
export const budgetMonth = () => `${new Date().toISOString().slice(0,7)}-01`;
export async function readExecutionPolicy(tx: Transaction, organizationId: string, projectId: string) {
  const company = await tx<{ monthly_tokens: string; run_tokens: number; version: number }[]>`select monthly_tokens,run_tokens,version from company_execution_policies where organization_id=${organizationId}`;
  const project = await tx<{ monthly_tokens: string; run_tokens: number; version: number }[]>`select monthly_tokens,run_tokens,version from project_execution_policies where organization_id=${organizationId} and project_id=${projectId}`;
  return {
    company: { monthlyTokens: Number(company[0]?.monthly_tokens ?? executionDefaults.companyMonthlyTokens), runTokens: company[0]?.run_tokens ?? executionDefaults.runTokens, version: company[0]?.version ?? 0 },
    project: { monthlyTokens: Number(project[0]?.monthly_tokens ?? executionDefaults.projectMonthlyTokens), runTokens: project[0]?.run_tokens ?? executionDefaults.runTokens, version: project[0]?.version ?? 0 },
  };
}
export async function dependencyBlock(tx: Transaction, org: string, project: string, task: string) {
  const active = await tx`select 1 from projects p join organizations o on o.id=p.organization_id where p.organization_id=${org} and p.id=${project} and p.status='ACTIVE' and o.status='ACTIVE'`;
  if (!active.length) return 'PROJECT_INACTIVE';
  const unmet = await tx`select 1 from task_dependencies d join tasks t on t.organization_id=d.organization_id and t.id=d.prerequisite_id
    where d.organization_id=${org} and d.project_id=${project} and d.task_id=${task} and t.status<>'COMPLETED' limit 1`;
  return unmet.length ? 'DEPENDENCY' : null;
}
/** Call under the organization lock; amounts are completed-response tokens, never currency or subscription credits. */
export async function reserveExecution(tx: Transaction, input: { org: string; project: string; operation: string; kind: 'WORKFLOW' | 'REVIEW'; totalTokens: number; profileLimit: number }) {
  const maintenance=await maintenanceReason(tx);if(maintenance)throw new ExecutionBlocked(maintenance);
  const { org, project, operation, totalTokens } = input;
  const policy = await readExecutionPolicy(tx, org, project);
  const limit = Math.min(policy.company.runTokens, policy.project.runTokens, input.profileLimit, input.kind === 'REVIEW' ? executionDefaults.reviewTokens : executionDefaults.runTokens);
  if (!Number.isSafeInteger(totalTokens) || totalTokens < 0 || totalTokens >= limit) throw new ExecutionBlocked('TOKEN_LIMIT');
  const month = budgetMonth();
  const current = await tx<{ base_tokens: string }[]>`select base_tokens from execution_allowances where organization_id=${org} and operation_id=${operation} and period_start=${month}::date`;
  const base = Number(current[0]?.base_tokens ?? totalTokens), spent = Math.max(0, totalTokens - base), reserved = Math.max(spent, limit - base);
  const totals = await tx<{ company: string; project: string }[]>`select coalesce(sum(case when status in ('HELD','UNKNOWN') then greatest(reserved_tokens,spent_tokens) else spent_tokens end),0) as company,
    coalesce(sum(case when project_id=${project} then case when status in ('HELD','UNKNOWN') then greatest(reserved_tokens,spent_tokens) else spent_tokens end else 0 end),0) as project
    from execution_allowances where organization_id=${org} and period_start=${month}::date and operation_id<>${operation}`;
  if (Number(totals[0].company) + reserved > policy.company.monthlyTokens || Number(totals[0].project) + reserved > policy.project.monthlyTokens) throw new ExecutionBlocked('PROJECT_TOKEN_BUDGET');
  await tx`update execution_allowances set status='SETTLED',updated_at=now() where organization_id=${org} and operation_id=${operation} and period_start<>${month}::date and status='HELD'`;
  await tx`insert into execution_allowances(organization_id,project_id,operation_id,kind,period_start,reserved_tokens,spent_tokens,base_tokens)
    values(${org},${project},${operation},${input.kind},${month}::date,${reserved},${spent},${base}) on conflict(organization_id,operation_id,period_start)
    do update set reserved_tokens=excluded.reserved_tokens,spent_tokens=excluded.spent_tokens,status='HELD',updated_at=now()`;
  return limit;
}
export async function settleExecution(tx: Transaction, org: string, operation: string, totalTokens: number, status: 'HELD' | 'SETTLED' | 'UNKNOWN') {
  await tx`update execution_allowances set spent_tokens=greatest(spent_tokens,${totalTokens}-base_tokens),status=${status},updated_at=now()
    where organization_id=${org} and operation_id=${operation} and period_start=${budgetMonth()}::date`;
}
/** One shared Codex subscription slot, across workers/projects/review jobs. Acquire before the org lock. */
export async function sharedSlotAvailable(tx: Transaction) {
  await tx`select pg_advisory_xact_lock(9700401)`;
  if(await maintenanceReason(tx))return false;
  const active = await tx`select 1 from workflow_runs where status='RUNNING' or stop_lease_token is not null or checkpoint->>'stopReason' in ('STOP_UNVERIFIABLE','RECOVERY_REQUIRED')
    union all select 1 from performance_review_jobs where status in ('RUNNING','UNKNOWN') limit 1`;
  return active.length === 0;
}
