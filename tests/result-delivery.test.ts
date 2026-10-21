import { expect, test } from 'vitest';
import { initialCheckpoint, type WorkflowRun, type RoleEvidence } from '../packages/agents/src/types';
import { verifyDelivery, type DeliveryGit } from '../apps/api/src/repository-delivery';
import { dashboardLink, deliveryLinks, repositoryLink } from '../apps/web/app/ui/result-model';
import type { WorkflowRun as PublicRun } from '../apps/web/app/ui/api';
import { slackDashboardLink } from '../apps/api/src/slack-commands';

const sha = 'a'.repeat(64), commit = 'b'.repeat(40), url = 'https://github.com/Ina-dang/how-to-trash.git';
const files = [{ path: 'src/lib/regions.ts', content: 'export const count = 1;\n' }];
function run(): WorkflowRun {
  const role = (role: RoleEvidence['role']): RoleEvidence => ({ role, threadId: role, turnId: null, completedAt: new Date().toISOString(), usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, candidateSha: role === 'PM' ? null : sha,
    output: { summaryKo: '검증 결과', specEn: 'Implement regions', acceptanceCriteria: [{ id: 'AC-1', description: 'Match data' }], files: role === 'DEVELOPER' ? files : [], verdict: role === 'QA' ? 'PASS' : 'NA', candidateSha: role === 'QA' ? sha : '', issues: [] } });
  return { id: 'run', taskId: 'task', projectId: 'project', organizationId: 'org', commandOriginalKo: '지역 검색', status: 'WAITING_APPROVAL', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), leaseToken: null, leaseExpiresAt: null,
    fixture: 'how-to-trash-v1', repositorySource: { profile: 'how-to-trash-v1', repositoryUrl: url, baseSha: 'c'.repeat(40), admissionSha: sha, imageId: 'image' },
    checkpoint: { ...initialCheckpoint(), roles: [role('PM'), role('DEVELOPER'), role('QA')], workspace: { files, sha, diff: '+ code' }, verification: { sha, test: { exitCode: 0, output: 'pass' }, build: { exitCode: 0, output: 'pass' }, sandbox: { networkDisabled: true, readOnlyRoot: true, resourceLimited: true }, verifiedAt: new Date().toISOString() } } };
}
const git = (overrides: Record<string, string> = {}): DeliveryGit => async args => overrides[args[0]] ?? ({ status: '', remote: url, branch: 'codex/region-search', 'rev-parse': commit, 'check-ref-format': '', 'merge-base': '', 'ls-remote': `${commit}\trefs/heads/codex/region-search`, diff: files[0].path, show: files[0].content }[args[0]] ?? '');

test('delivery requires remote commit and exact candidate bytes, preserving review state', async () => {
  const input = run(); const result = await verifyDelivery(input, git(), files);
  expect(result.commitSha).toBe(commit); expect(result.files).toEqual([files[0].path]); expect(input.status).toBe('WAITING_APPROVAL');
  const links = deliveryLinks({ ...input, checkpoint: { ...input.checkpoint, delivery: result } } as PublicRun);
  expect(links?.commit).toBe(`https://github.com/Ina-dang/how-to-trash/commit/${commit}`);
  expect(links?.branch).toContain('/tree/codex/region-search');
});
test.each([
  ['unverified push', { 'ls-remote': '' }], ['dirty checkout', { status: ' M src/lib/regions.ts' }],
  ['other repository', { remote: 'https://github.com/other/repo.git' }], ['different bytes', { show: 'unverified' }],
  ['forbidden path', { diff: 'src/data/waste-guides.ts' }], ['unsafe branch', { branch: 'main' }],
])('blocks %s before recording delivery', async (_name, overrides) => { await expect(verifyDelivery(run(), git(overrides), files)).rejects.toThrow(); });
test('missing QA or changed verification never becomes a push report', async () => {
  const input = run(); input.checkpoint.roles[2].output.verdict = 'FAIL'; await expect(verifyDelivery(input, git(), files)).rejects.toThrow();
  const changed = run(); if (changed.checkpoint.verification) changed.checkpoint.verification.sha = 'd'.repeat(64);
  await expect(verifyDelivery(changed, git(), files)).rejects.toThrow();
});
test('safe links reject external origins, credentials, queries and stale delivery candidates', () => {
  for (const invalid of ['javascript:alert(1)', 'https://github.com.evil/Ina-dang/repo', 'https://user:secret@github.com/Ina-dang/repo', 'https://github.com/Ina-dang/repo?secret=hidden']) expect(repositoryLink(invalid)).toBeNull();
  const input = run(); input.checkpoint.delivery = { repositoryUrl: url, branch: 'codex/test', commitSha: commit, candidateSha: 'd'.repeat(64), files: [files[0].path], verifiedAt: new Date().toISOString() };
  expect(deliveryLinks(input as PublicRun)).toBeNull();
});
test('dashboard and Slack links carry a project and task without granting execution', () => {
  expect(dashboardLink('project', 'task')).toBe('/?project=project&task=task#task-inspector');
  expect(slackDashboardLink('project', 'task')).toContain('?project=project&task=task#task-inspector');
});
