import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { Database } from '@ai-pixel/db';
import { REPOSITORY_PATHS, RepositorySandbox } from '../../../packages/sandbox/src/repository.js';
import { acceptable } from './workflow-routes.js';
import { checkpointSchema, jsonValue, workflowView, type WorkflowRow } from './workflows.js';
import { emit, lockOrganization } from './repository.js';

export type DeliveryGit = (args: string[]) => Promise<string>;
export async function verifyDelivery(run: ReturnType<typeof workflowView>, git: DeliveryGit, files: { path: string; content: string }[]) {
  assert(run.fixture === 'how-to-trash-v1' && run.repositorySource, 'Bounded repository run required');
  assert(['WAITING_APPROVAL', 'SUCCEEDED'].includes(run.status) && acceptable(run.checkpoint, run.checkpoint.workspace?.sha ?? ''), 'Matching QA PASS required');
  assert(run.checkpoint.workspace, 'Workspace required');
  assert.equal((await git(['status', '--porcelain'])).trim(), '', 'Checkout must be clean');
  assert((await git(['remote', 'get-url', 'origin'])).trim() === run.repositorySource.repositoryUrl, 'Repository mismatch');
  const branch = (await git(['branch', '--show-current'])).trim(), commitSha = (await git(['rev-parse', 'HEAD'])).trim();
  assert(/^codex\/[\w./-]+$/.test(branch) && !branch.includes('..') && /^[a-f0-9]{40}$/.test(commitSha), 'Invalid delivery reference');
  await git(['check-ref-format', '--branch', branch]);
  await git(['merge-base', '--is-ancestor', run.repositorySource.baseSha, commitSha]);
  assert.equal((await git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])).trim().split(/\s+/)[0], commitSha, 'Push not verified');
  const changed = (await git(['diff', '--name-only', run.repositorySource.baseSha, commitSha])).trim().split('\n').filter(Boolean);
  assert(changed.length && changed.every(path => (REPOSITORY_PATHS as readonly string[]).includes(path)), 'Changed path outside admission');
  for (const file of files) assert((await git(['show', `${commitSha}:${file.path}`])) === file.content, `Candidate differs: ${file.path}`);
  return { repositoryUrl: run.repositorySource.repositoryUrl, branch, commitSha, candidateSha: run.checkpoint.workspace.sha, files: changed, verifiedAt: new Date().toISOString() };
}

export async function recordRepositoryDelivery(database: Database, root: string, runId: string) {
  const rows = await database.sql<WorkflowRow[]>`select * from workflow_runs where id=${runId}`;
  assert(rows[0], 'Run not found'); const row = rows[0], run = workflowView(row);
  assert(run.repositorySource, 'Repository source missing');
  const snapshot = await new RepositorySandbox(root, run.repositorySource).snapshot(runId);
  assert.equal(snapshot.sha, run.checkpoint.workspace?.sha, 'Workspace changed');
  const execute = promisify(execFile);
  const git: DeliveryGit = async args => (await execute('git', args, { cwd: join(root, '.local/repositories/how-to-trash'), encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 2_000_000 })).stdout;
  const delivery = await verifyDelivery(run, git, snapshot.files);
  return database.sql.begin(async tx => {
    await lockOrganization(tx, row.organization_id);
    const current = await tx<WorkflowRow[]>`select * from workflow_runs where id=${runId} and organization_id=${row.organization_id} for update`;
    assert(current[0]?.version === row.version, 'Run changed during verification');
    if (current[0].checkpoint.delivery) {
      assert.equal(current[0].checkpoint.delivery.commitSha, delivery.commitSha, 'Delivery already recorded for another commit');
      return current[0].checkpoint.delivery;
    }
    const checkpoint = { ...current[0].checkpoint, delivery }; checkpointSchema.parse(checkpoint);
    const updated = await tx<WorkflowRow[]>`update workflow_runs set checkpoint=${tx.json(jsonValue(checkpoint))},version=version+1,updated_at=now() where id=${runId} returning *`;
    await emit(tx, { organizationId: row.organization_id, projectId: row.project_id, taskId: row.task_id, runId, type: 'workflow.run.updated', aggregateVersion: updated[0].version,
      payload: { runId, status: row.status, stage: checkpoint.stage, version: updated[0].version, stopReason: checkpoint.stopReason } });
    await tx`insert into audit_logs(id,organization_id,project_id,actor_type,actor_id,action,target_type,target_id,request_id,outcome,metadata)
      values(${randomUUID()},${row.organization_id},${row.project_id},'SYSTEM','local-delivery-verifier','workflow.delivery.verified','workflow_run',${runId},${randomUUID()},'SUCCESS',${tx.json(delivery)})`;
    return delivery;
  });
}
