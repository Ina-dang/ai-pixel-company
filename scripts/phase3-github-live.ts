import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { assertCandidateManifest, githubConfig } from '../packages/integrations/src/index.js';

// Opt-in external writes: only the dedicated private integration-test repository.
// Never starts a model, accepts a run, merges a PR, or dispatches hosted Actions.
const projectId = process.argv[2], runId = process.argv[3];
assert(projectId && runId, 'Usage: phase3-github-live.ts <projectId> <verifiedRunId>');
const local = JSON.parse(readFileSync('.local/integrations.json', 'utf8'));
const connection = local.connections.find((entry: { projectId: string; provider: string }) => entry.projectId === projectId && entry.provider === 'GITHUB');
assert(connection, 'Configure the project GitHub connection first');
const config = githubConfig(connection.config);
assert.equal(config.owner, 'Ina-dang');
assert.equal(config.repo, 'ai-pixel-company-integration-tests');
assert.equal(config.baseBranch, 'fixture-base');
const reportSlack = process.argv.includes('--slack-report');
if (reportSlack) {
  const slack = local.connections.find((entry: { projectId: string; provider: string }) => entry.projectId === projectId && entry.provider === 'SLACK');
  assert.equal(slack?.config.teamId, 'T0BSCLLFFDJ');
  assert.equal(slack?.config.channelId, 'C0CAEGXQ5LL');
}
const origin = 'http://127.0.0.1:3000';
const login = await fetch(`${origin}/api/v1/auth/session`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ secret: readFileSync('.local/owner-key', 'utf8').trim() }),
});
assert(login.ok, `Owner login HTTP ${login.status}`);
const session = await login.json();
const cookies = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
async function api(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method, headers: { Origin: origin, Cookie: cookies, 'X-CSRF-Token': session.data.csrfToken,
      'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert(response.ok, `${path}: HTTP ${response.status} ${result.error?.code ?? ''}`);
  return result.data;
}
const run = await api(`/runs/${runId}`);
assert.equal(run.projectId, projectId);
assert.equal(run.status, 'WAITING_APPROVAL');
assertCandidateManifest(run.checkpoint.workspace.files, run.checkpoint.workspace.sha);
assert.equal(run.checkpoint.verification.sha, run.checkpoint.workspace.sha);
assert.equal(run.checkpoint.verification.test.exitCode, 0);
assert.equal(run.checkpoint.verification.build.exitCode, 0);
const project = await api(`/projects/${projectId}`);
if (project.repositoryUrl !== `https://github.com/${config.owner}/${config.repo}.git` || project.defaultBranch !== config.baseBranch) {
  await api(`/projects/${projectId}`, { expectedVersion: project.version,
    repositoryUrl: `https://github.com/${config.owner}/${config.repo}.git`, defaultBranch: config.baseBranch }, 'PATCH');
}
for (const kind of ['ISSUE_CREATE', 'BRANCH_CREATE', 'PUSH_CANDIDATE', 'DRAFT_PR_CREATE', 'CI_REFRESH', ...(reportSlack ? ['SLACK_REPORT'] : [])]) {
  const state = await api(`/projects/${projectId}/integrations`);
  let operation = kind === 'CI_REFRESH' ? undefined : state.operations.find((entry: { kind: string; runId: string }) => entry.kind === kind && entry.runId === runId);
  if (!operation) operation = await api(`/projects/${projectId}/integrations/operations`, {
    kind, runId, expectedRunVersion: run.version,
    title: kind === 'SLACK_REPORT' ? `Phase 3 실제 연동 검증 ${runId.slice(0, 8)}` : `Phase 3 isolated verification ${runId.slice(0, 8)}`,
    body: `Dedicated integration test. Candidate manifest: ${run.checkpoint.workspace.sha}. Local Docker test/build and QA passed. Owner acceptance is pending.`,
  });
  const deadline = Date.now() + 90_000;
  while (['PENDING', 'RUNNING', 'DEFERRED'].includes(operation.status) && Date.now() < deadline) {
    await sleep(1000);
    const current = await api(`/projects/${projectId}/integrations`);
    operation = current.operations.find((entry: { id: string }) => entry.id === operation.id);
    assert(operation, 'Operation disappeared');
  }
  console.log(JSON.stringify({ kind, id: operation.id, status: operation.status,
    errorCode: operation.errorCode, externalRef: operation.externalRef }));
  assert.equal(operation.status, 'SUCCEEDED', `Stop without reissuing ${kind}: ${operation.errorCode ?? operation.status}`);
}
const final = await api(`/runs/${runId}`);
assert.equal(final.version, run.version);
assert.equal(final.status, 'WAITING_APPROVAL');
console.log(JSON.stringify({ verified: true, candidateSha: run.checkpoint.workspace.sha, ownerAcceptance: 'PENDING', merged: false, hostedActionsDispatched: false }));
