import { randomUUID } from 'node:crypto';
import type { Database } from '@ai-pixel/db';
import { type GitHubAdapter, type GitHubConfig, hash, IntegrationError } from '@ai-pixel/integrations';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Connection, Operation } from './integrations.js';
import { audit, emit, lockOrganization, mutate } from './repository.js';
import { ApiError, type ApiEnv, canonical } from './security.js';
import type { WorkflowRow } from './workflows.js';

type Remote = Awaited<ReturnType<GitHubAdapter['mergeSnapshot']>>;
type Scope = { action: 'MERGE_PULL_REQUEST'; connectionVersion: number; installationId: number; repositoryId: number; base: string; branch: string;
  headSha: string; baseSha: string; candidateSha: string; runVersion: number; pullNumber: number; mergeMethod: 'squash'; policyVersion: string; requiredChecks: string[]; remote: Remote };
type MergeRow = { id: string; operation_id: string; organization_id: string; project_id: string; run_id: string; scope: Scope; scope_hash: string; status: string; version: number;
  expires_at: Date; approved_by: string | null; approved_session_id: string | null; approved_at: Date | null; result: unknown; error_code: string | null; created_at: Date };
type Dependencies = { connection: (id: string) => Promise<Connection>;
  evidence: (org: string, project: string, run: string, version: number) => Promise<WorkflowRow>;
  adapter: (connection: Connection, operation?: Operation, guard?: () => Promise<void>) => Promise<GitHubAdapter> };
const bodySchema = z.strictObject({ expectedVersion: z.number().int().positive(), scopeHash: z.string().regex(/^[a-f0-9]{64}$/) });
const view = (row: MergeRow) => ({ id: row.id, operationId: row.operation_id, runId: row.run_id, scope: row.scope, scopeHash: row.scope_hash, status: row.status,
  version: row.version, expiresAt: row.expires_at.toISOString(), approvedBy: row.approved_by, approvedAt: row.approved_at?.toISOString() ?? null, result: row.result, errorCode: row.error_code });

export class IntegrationMerges {
  constructor(private database: Database, private deps: Dependencies) {}
  async list(org: string, project: string) {
    const rows = await this.database.sql<MergeRow[]>`select * from integration_merge_requests where organization_id=${org} and project_id=${project} order by created_at desc,id desc limit 30`;
    return rows.map(view);
  }
  async create(operation: Operation, connection: Connection, pullNumber: number, branch: string, headSha: string, config: GitHubConfig) {
    const remote = await (await this.deps.adapter(connection, operation)).mergeSnapshot(pullNumber, branch, headSha);
    const scope: Scope = { action: 'MERGE_PULL_REQUEST', connectionVersion: connection.version, installationId: config.installationId, repositoryId: config.repositoryId,
      base: config.baseBranch, branch, headSha, baseSha: remote.baseSha, candidateSha: operation.candidate_sha, runVersion: operation.request.expectedRunVersion,
      pullNumber, mergeMethod: 'squash', policyVersion: config.policyVersion, requiredChecks: config.requiredChecks, remote };
    const scopeHash = hash(canonical(scope)), requestId = randomUUID();
    await this.database.sql.begin(async tx => {
      await lockOrganization(tx, operation.organization_id);
      const running = await tx`select 1 from integration_merge_requests where organization_id=${operation.organization_id} and run_id=${operation.run_id} and status in ('QUEUED','RUNNING','UNKNOWN','SUCCEEDED')`;
      if (running.length) throw new IntegrationError('MERGE_ALREADY_DISPATCHED', 409);
      await tx`update integration_merge_requests set status='STALE',error_code='SUPERSEDED',version=version+1,updated_at=now()
        where organization_id=${operation.organization_id} and run_id=${operation.run_id} and status in ('REQUESTED','APPROVED')`;
      await tx`insert into integration_merge_requests(id,operation_id,organization_id,project_id,run_id,scope,scope_hash,expires_at)
        values(${requestId},${operation.id},${operation.organization_id},${operation.project_id},${operation.run_id},${tx.json(scope)},${scopeHash},now()+interval '15 minutes')`;
      await emit(tx, { organizationId: operation.organization_id, projectId: operation.project_id, runId: operation.run_id, type: 'integration.merge.requested', aggregateVersion: 1,
        payload: { requestId, scopeHash, headSha, baseSha: remote.baseSha, remoteMergeExecuted: false } });
    });
    return { requestId, scopeHash, ...scope, requiresOwnerApproval: true, remoteMergeExecuted: false };
  }
  private async row(id: string, org?: string, project?: string) {
    const rows = await this.database.sql<MergeRow[]>`select * from integration_merge_requests where id=${id}`;
    const row = rows[0];
    if (!row || (org && row.organization_id !== org) || (project && row.project_id !== project)) throw new ApiError(404, 'NOT_FOUND', 'merge 승인 요청을 찾을 수 없습니다.');
    return row;
  }
  private async operation(row: MergeRow) {
    const rows = await this.database.sql<Operation[]>`select * from integration_operations where id=${row.operation_id} and organization_id=${row.organization_id}`;
    if (!rows[0]) throw new IntegrationError('MERGE_OPERATION_MISSING', 409);
    return rows[0];
  }
  private async active(row: MergeRow, expectedStatus: string, requireApproval: boolean) {
    const current = await this.row(row.id);
    if (current.status !== expectedStatus || current.version !== row.version || current.scope_hash !== row.scope_hash) throw new IntegrationError('MERGE_VERSION_CHANGED', 409);
    if (current.expires_at.getTime() <= Date.now()) throw new IntegrationError('MERGE_APPROVAL_EXPIRED', 409);
    if (hash(canonical(current.scope)) !== current.scope_hash) throw new IntegrationError('MERGE_SCOPE_CHANGED', 409);
    const project = await this.database.sql`select 1 from projects p join organizations o on o.id=p.organization_id
      where p.id=${row.project_id} and p.organization_id=${row.organization_id} and p.status='ACTIVE' and o.status='ACTIVE'`;
    if (!project.length) throw new IntegrationError('PROJECT_SCOPE_CHANGED', 409);
    if (requireApproval) {
      const allowed = await this.database.sql`select 1 from sessions s join memberships m on m.organization_id=s.organization_id and m.user_id=s.user_id
        join organizations o on o.id=s.organization_id join projects p on p.organization_id=s.organization_id and p.id=${row.project_id}
        where s.id=${row.approved_session_id} and s.user_id=${row.approved_by} and s.organization_id=${row.organization_id}
        and s.revoked_at is null and s.expires_at>now() and m.status='ACTIVE' and m.role='OWNER' and o.status='ACTIVE' and p.status='ACTIVE'`;
      if (!allowed.length) throw new IntegrationError('MERGE_APPROVER_REVOKED', 403);
    }
  }
  private async preflight(row: MergeRow, expectedStatus: string, requireApproval = false) {
    await this.active(row, expectedStatus, requireApproval);
    const operation = await this.operation(row), connection = await this.deps.connection(operation.connection_id);
    if (connection.version !== row.scope.connectionVersion || connection.version !== operation.connection_version) throw new IntegrationError('CONNECTION_VERSION_CHANGED', 409);
    const run = await this.deps.evidence(row.organization_id, row.project_id, row.run_id, row.scope.runVersion);
    if (run.checkpoint.workspace?.sha !== row.scope.candidateSha) throw new IntegrationError('CANDIDATE_CHANGED', 409);
    const guard = async () => { await this.active(row, expectedStatus, requireApproval); };
    const adapter = await this.deps.adapter(connection, operation, guard);
    const remote = await adapter.mergeSnapshot(row.scope.pullNumber, row.scope.branch, row.scope.headSha);
    if (canonical(remote) !== canonical(row.scope.remote)) throw new IntegrationError('MERGE_SCOPE_CHANGED', 409);
    const blockers = [
      ...(run.status !== 'SUCCEEDED' ? ['RESULT_ACCEPTANCE_REQUIRED'] : []),
      ...(remote.draft ? ['DRAFT_PULL_REQUEST'] : []),
      ...(!remote.mergeable || remote.mergeableState !== 'clean' ? ['PULL_REQUEST_NOT_MERGEABLE'] : []),
      ...(remote.ci.status !== 'PASS' ? ['CURRENT_HEAD_CI_REQUIRED'] : []),
    ];
    return { adapter, blockers, remote };
  }
  private async invalidate(row: MergeRow, error: unknown) {
    if (!(error instanceof IntegrationError)) return;
    const status = error.code === 'MERGE_APPROVAL_EXPIRED' ? 'EXPIRED' : 'STALE';
    await this.database.sql`update integration_merge_requests set status=${status},error_code=${error.code},version=version+1,updated_at=now()
      where id=${row.id} and version=${row.version} and status in ('REQUESTED','APPROVED','QUEUED')`;
  }
  routes() {
    const routes = new Hono<ApiEnv>();
    for (const action of ['validate', 'approve', 'execute', 'revoke', 'reconcile'] as const) routes.post(`/projects/:id/integrations/merges/:requestId/${action}`, async c => {
      const auth = c.get('auth'), projectId = c.req.param('id'), requestId = c.req.param('requestId');
      if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(requestId).success) throw new ApiError(404, 'NOT_FOUND', '대상을 찾을 수 없습니다.');
      const body = bodySchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) throw new ApiError(400, 'INVALID_INPUT', '승인 버전과 범위를 확인하세요.');
      const row = await this.row(requestId, auth.organizationId, projectId);
      if (row.version !== body.data.expectedVersion || row.scope_hash !== body.data.scopeHash) throw new ApiError(409, 'MERGE_VERSION_CHANGED', '승인 범위가 변경됐습니다. 다시 확인하세요.');
      if (action === 'reconcile') {
        if (row.status !== 'UNKNOWN') throw new ApiError(409, 'MERGE_STATE_INVALID', '결과 불명 요청만 원격 조회할 수 있습니다.');
        try {
          const operation = await this.operation(row), connection = await this.deps.connection(operation.connection_id);
          if (connection.version !== row.scope.connectionVersion) throw new IntegrationError('CONNECTION_VERSION_CHANGED', 409);
          const result = await (await this.deps.adapter(connection)).mergedResult(row.scope.pullNumber, row.scope.branch, row.scope.headSha, row.scope.baseSha);
          return await mutate(this.database, c, body.data, async tx => {
            const changed = await tx<MergeRow[]>`update integration_merge_requests set status=${result ? 'SUCCEEDED' : 'UNKNOWN'},result=${tx.json(JSON.parse(JSON.stringify(result)))},error_code=${result ? null : 'EFFECT_UNKNOWN'},version=version+1,updated_at=now()
              where id=${row.id} and version=${row.version} and status='UNKNOWN' returning *`;
            if (!changed[0]) throw new ApiError(409, 'MERGE_VERSION_CHANGED', '조회 중 상태가 변경됐습니다.');
            await audit(tx, c, 'integration.merge.reconciled', 'integration_merge_request', row.id, projectId);
            await emit(tx, { organizationId: row.organization_id, projectId, runId: row.run_id, type: 'integration.updated', aggregateVersion: changed[0].version,
              payload: { mergeRequestId: row.id, status: changed[0].status, readOnlyRemoteQuery: true } });
            return { status: 200, data: view(changed[0]) };
          });
        } catch (error) { if (error instanceof IntegrationError) throw new ApiError(409, error.code, '원격 merge 결과를 확정할 수 없습니다. 자동 재실행하지 않습니다.'); throw error; }
      }
      const expected = action === 'execute' ? 'APPROVED' : row.status;
      if (action !== 'revoke' && !['REQUESTED','APPROVED'].includes(expected)) throw new ApiError(409, 'MERGE_STATE_INVALID', '현재 상태에서는 처리할 수 없습니다.');
      if (action === 'approve' && row.status !== 'REQUESTED') throw new ApiError(409, 'MERGE_STATE_INVALID', '새 승인 요청을 확인하세요.');
      if (action === 'execute' && (row.approved_by !== auth.userId || row.approved_session_id !== auth.sessionId)) throw new ApiError(403, 'MERGE_APPROVER_MISMATCH', '승인한 Owner 세션에서 실행하세요.');
      try {
        if (action !== 'revoke') {
          const check = await this.preflight(row, expected, action === 'execute');
          if (action === 'validate') return c.json({ data: { requestId, ready: check.blockers.length === 0, blockers: check.blockers, scopeHash: row.scope_hash, remoteMergeExecuted: false }, requestId: c.get('requestId') });
          if (check.blockers.length) throw new IntegrationError(check.blockers[0], 409);
        }
        return await mutate(this.database, c, body.data, async tx => {
          const current = await tx<MergeRow[]>`select * from integration_merge_requests where id=${row.id} for update`;
          if (current[0].version !== row.version || current[0].scope_hash !== row.scope_hash) throw new ApiError(409, 'MERGE_VERSION_CHANGED', '승인 상태가 변경됐습니다.');
          if (action === 'revoke' && !['REQUESTED','APPROVED','QUEUED'].includes(current[0].status)) throw new ApiError(409, 'MERGE_STATE_INVALID', '실행이 시작된 요청은 취소할 수 없습니다.');
          if (action !== 'revoke') await this.active(row, expected, action === 'execute');
          const status = action === 'approve' ? 'APPROVED' : action === 'execute' ? 'QUEUED' : 'REVOKED';
          const changed = await tx<MergeRow[]>`update integration_merge_requests set status=${status},version=version+1,updated_at=now(),
            approved_by=${action === 'approve' ? auth.userId : row.approved_by},approved_session_id=${action === 'approve' ? auth.sessionId : row.approved_session_id},
            approved_at=${action === 'approve' ? new Date() : row.approved_at} where id=${row.id} returning *`;
          await audit(tx, c, `integration.merge.${action}`, 'integration_merge_request', row.id, projectId);
          await emit(tx, { organizationId: row.organization_id, projectId, runId: row.run_id, type: 'integration.updated', aggregateVersion: changed[0].version,
            payload: { mergeRequestId: row.id, status, remoteMergeExecuted: false } });
          return { status: action === 'execute' ? 202 : 200, data: view(changed[0]) };
        });
      } catch (error) {
        if (error instanceof IntegrationError) {
          // A non-ready draft or unaccepted result can still be reviewed; changed authority/scope cannot.
          if (!['RESULT_ACCEPTANCE_REQUIRED','DRAFT_PULL_REQUEST','PULL_REQUEST_NOT_MERGEABLE','CURRENT_HEAD_CI_REQUIRED'].includes(error.code)) await this.invalidate(row, error);
          throw new ApiError(error.status === 403 ? 403 : 409, error.code, 'merge 범위·권한·검증 결과를 다시 확인하세요.');
        }
        throw error;
      }
    });
    return routes;
  }
  async recover() {
    await this.database.sql`update integration_merge_requests set status='UNKNOWN',error_code='PROCESS_RESTART_EFFECT_UNKNOWN',version=version+1,updated_at=now() where status='RUNNING'`;
  }
  async processOnce() {
    const rows = await this.database.sql<MergeRow[]>`update integration_merge_requests set status='RUNNING',version=version+1,updated_at=now()
      where id=(select id from integration_merge_requests where status='QUEUED' order by created_at,id for update skip locked limit 1) returning *`;
    const row = rows[0]; if (!row) return false;
    let status = 'FAILED', result: unknown = null, errorCode: string | null = null;
    try {
      const check = await this.preflight(row, 'RUNNING', true);
      if (check.blockers.length) throw new IntegrationError(check.blockers[0], 409);
      result = await check.adapter.merge(row.scope.pullNumber, row.scope.branch, row.scope.remote);
      status = 'SUCCEEDED';
    } catch (error) {
      errorCode = error instanceof IntegrationError ? error.code : 'MERGE_UNVERIFIABLE';
      status = errorCode === 'EFFECT_UNKNOWN' ? 'UNKNOWN' : 'FAILED';
    }
    await this.database.sql.begin(async tx => {
      await lockOrganization(tx, row.organization_id);
      const updated = await tx<MergeRow[]>`update integration_merge_requests set status=${status},result=${tx.json(JSON.parse(JSON.stringify(result)))},error_code=${errorCode},version=version+1,updated_at=now()
        where id=${row.id} and status='RUNNING' and version=${row.version} returning *`;
      if (updated[0]) {
        await emit(tx, { organizationId: row.organization_id, projectId: row.project_id, runId: row.run_id, type: 'integration.updated', aggregateVersion: updated[0].version,
          payload: { mergeRequestId: row.id, status, errorCode } });
        await tx`insert into audit_logs(id,organization_id,project_id,actor_type,actor_id,action,target_type,target_id,request_id,outcome,metadata)
          values(${randomUUID()},${row.organization_id},${row.project_id},'USER',${row.approved_by ?? 'unknown'},'integration.merge.executed','integration_merge_request',${row.id},${row.id},${status === 'SUCCEEDED' ? 'SUCCESS' : 'FAILED'},${tx.json({ status, errorCode, scopeHash: row.scope_hash })})`;
      }
    });
    return true;
  }
}
