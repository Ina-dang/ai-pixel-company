import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createDatabase } from '@ai-pixel/db';
import { loadRuntime } from './runtime.js';
import { acceptable } from '../apps/api/src/workflow-routes.js';
import { workflowView, type WorkflowRow } from '../apps/api/src/workflows.js';
import { HOW_TO_TRASH_BASE_SHA, HOW_TO_TRASH_URL, loadRepositoryAdmission, REPOSITORY_PATHS, RepositorySandbox } from '../packages/sandbox/src/repository.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const proof = JSON.parse(await readFile(join(root, '.local/how-to-trash-live.json'), 'utf8'));
assert.equal(proof.status, 'PASS', 'A verified live run is required');
assert.match(proof.runId, /^[a-f0-9-]{36}$/);
const database = createDatabase(loadRuntime().databaseUrl), run = promisify(execFile);
try {
  const rows = await database.sql<WorkflowRow[]>`select * from workflow_runs where id=${proof.runId} and fixture='how-to-trash-v1'`;
  assert(rows[0]); const workflow = workflowView(rows[0]);
  assert.equal(workflow.status, 'WAITING_APPROVAL');
  assert(workflow.repositorySource && acceptable(workflow.checkpoint, proof.candidateSha));
  const snapshot = await new RepositorySandbox(root, workflow.repositorySource).snapshot(workflow.id);
  assert.equal(snapshot.sha, proof.candidateSha);
  const baseline = (await loadRepositoryAdmission(root)).admission;
  const original = new Map(baseline.files.map(file => [file.path, file.content]));
  const changed = snapshot.files.filter(file => file.content !== original.get(file.path));
  assert(changed.length > 0 && changed.every(file => (REPOSITORY_PATHS as readonly string[]).includes(file.path)));
  const checkout = join(root, '.local/repositories/how-to-trash');
  const git = async (args: string[]) => (await run('git', args, { cwd: checkout, encoding: 'utf8', windowsHide: true })).stdout.trim();
  assert.equal(await git(['rev-parse', 'HEAD']), HOW_TO_TRASH_BASE_SHA);
  assert.equal(await git(['remote', 'get-url', 'origin']), HOW_TO_TRASH_URL);
  assert.equal(await git(['branch', '--show-current']), 'codex/region-search');
  assert.equal(await git(['status', '--porcelain']), '', 'Never overwrite an independently changed checkout');
  for (const file of changed) {
    await mkdir(dirname(join(checkout, file.path)), { recursive: true });
    await writeFile(join(checkout, file.path), file.content);
  }
  const result = { exported: changed.map(file => file.path), candidateSha: snapshot.sha, runId: workflow.id,
    baseSha: HOW_TO_TRASH_BASE_SHA, accepted: false, merged: false, deployed: false, exportedAt: new Date().toISOString() };
  await writeFile(join(root, '.local/how-to-trash-export.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await database.close(); }
