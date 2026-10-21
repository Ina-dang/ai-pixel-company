import { expect, test } from 'vitest';
import { initialCheckpoint, type WorkflowRun, type RoleEvidence } from '../packages/agents/src/types';
import { assertRepositoryReportManifest, slackLabel, slackTaskReport } from '../apps/api/src/slack-report';
import { hash } from '../packages/integrations/src/index';

const sha = 'a'.repeat(64), commit = 'b'.repeat(40);
const task = { id: 'task', title: '지역 목록과 검색 개선', status: 'APPROVAL_REQUIRED' as const };
const input = { projectId: 'project', projectName: '실제 업무 · how-to-trash', task };
type VerifiedRun = WorkflowRun & { checkpoint: WorkflowRun['checkpoint'] & {
  workspace: NonNullable<WorkflowRun['checkpoint']['workspace']>;
  verification: NonNullable<WorkflowRun['checkpoint']['verification']>;
  delivery: NonNullable<WorkflowRun['checkpoint']['delivery']>;
} };
function run(): VerifiedRun {
  const role = (name: RoleEvidence['role']): RoleEvidence => ({ role: name, threadId: name, turnId: null, completedAt: new Date().toISOString(), candidateSha: sha,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, output: { summaryKo: '지도 없이 지역 목록을 검색하고 상세 화면을 열도록 개선했습니다.', specEn: '', acceptanceCriteria: [], files: [], verdict: name === 'QA' ? 'PASS' : 'NA', candidateSha: sha, issues: [] } });
  return { id: 'run', projectId: 'project', taskId: 'task', organizationId: 'org', status: 'WAITING_APPROVAL', version: 1,
    commandOriginalKo: '지역 검색', leaseToken: null, leaseExpiresAt: null, createdAt: '', updatedAt: '',
    fixture: 'how-to-trash-v1', repositorySource: { profile: 'how-to-trash-v1', repositoryUrl: 'https://github.com/Ina-dang/how-to-trash.git', baseSha: 'c'.repeat(40), admissionSha: sha, imageId: 'image' },
    checkpoint: { ...initialCheckpoint(), roles: [role('DEVELOPER'), role('QA')], workspace: { sha, files: [], diff: '+code' },
      verification: { sha, test: { exitCode: 0, output: 'PRIVATE RAW LOG' }, build: { exitCode: 0, output: '' }, sandbox: { readOnlyRoot: true, networkDisabled: true, resourceLimited: true }, verifiedAt: '' },
      delivery: { repositoryUrl: 'https://github.com/Ina-dang/how-to-trash.git', commitSha: commit, candidateSha: sha, branch: 'codex/region-search', files: [], verifiedAt: '' } } };
}
test('report leads with task, summary, checks, next action and exact task detail link', () => {
  const text = slackTaskReport({ ...input, run: run() });
  for (const label of ['업무명', '변경 요약', '검증 결과', '다음 할 일', '상세 화면']) expect(text).toContain(label);
  expect(text).toContain(task.title); expect(text).toContain('지도 없이 지역 목록');
  expect(text).toContain('테스트 통과 · 빌드 통과 · QA PASS'); expect(text).toContain('수락 여부를 결정');
  expect(text).toContain('?project=project&task=task#task-inspector'); expect(text).toContain(`/commit/${commit}|`);
  expect(text).not.toContain('PRIVATE RAW LOG'); expect(text).not.toContain('후보 SHA');
});
test('unstarted task and missing code summary are reported honestly', () => {
  const text = slackTaskReport(input); expect(text).toContain('미실행'); expect(text).toContain('코드 변경 요약이 없습니다'); expect(text).not.toContain('QA PASS'); expect(text).toContain('확인된 push 커밋 기록 없음');
});
test('stale test, QA, developer summary and delivery never become current success', () => {
  const current = run(); current.checkpoint.workspace.sha = 'd'.repeat(64);
  const text = slackTaskReport({ ...input, run: current }); expect(text).toContain('테스트 미검증 · 빌드 미검증 · QA 미검증'); expect(text).not.toContain('지도 없이'); expect(text).not.toContain('/commit/');
});
test('wrong task or project evidence is excluded', () => {
  for (const change of [{ taskId: 'another' }, { projectId: 'another' }]) expect(slackTaskReport({ ...input, run: { ...run(), ...change } })).toContain('미실행');
});
test('failed checks and QA issues do not read as success', () => {
  const current = run(); current.checkpoint.verification.test.exitCode = 1; current.checkpoint.roles[1].output.issues = ['repair'];
  expect(slackTaskReport({ ...input, run: current })).toContain('테스트 실패 · 빌드 통과 · QA FAIL');
});
test('untrusted Slack syntax and secrets cannot add links or mentions', () => {
  expect(slackLabel('<!channel> <https://evil.example|link> & *fake*')).toBe('[mention] &lt;https://evil.example|link&gt; &amp; fake');
  const secret = `xoxb-${'a'.repeat(35)}`;
  expect(slackLabel(`prefix ${secret}`)).not.toContain(secret);
  const current = run(); current.checkpoint.roles[0].output.summaryKo = secret;
  expect(slackTaskReport({ ...input, run: current })).not.toContain(secret);
});
test('unsafe or mismatched delivery cannot introduce an external link', () => {
  for (const url of ['https://user:secret@github.com/Ina-dang/how-to-trash', 'https://evil.example/repo', 'https://github.com/Ina-dang/how-to-trash?token=secret']) {
    const current = run(); current.checkpoint.delivery.repositoryUrl = url; current.repositorySource = { ...current.repositorySource as NonNullable<WorkflowRun['repositorySource']>, repositoryUrl: url };
    expect(slackTaskReport({ ...input, run: current })).not.toContain('/commit/');
  }
});
test('even escaped long text fits the three-task status message budget', () => {
  const current = run(); current.checkpoint.roles[0].output.summaryKo = '&'.repeat(5000);
  const text = slackTaskReport({ projectId: 'project', projectName: '&'.repeat(1000), task: { ...task, title: '&'.repeat(1000) }, run: current });
  expect(text.length * 3 + 500).toBeLessThan(6000); expect(slackLabel('&'.repeat(1000))).not.toMatch(/&amp?…$/);
});
test('stopped and accepted runs have different next actions', () => {
  expect(slackTaskReport({ ...input, run: { ...run(), status: 'BLOCKED' } })).toContain('중단 사유');
  expect(slackTaskReport({ ...input, run: { ...run(), status: 'SUCCEEDED' } })).toContain('결과 수락 완료');
});
test('repository report checks the admitted snapshot and admission-bound file hash', () => {
  const current = run(); current.checkpoint.workspace.sha = hash(JSON.stringify({ admissionSha: sha, files: [] }));
  expect(() => assertRepositoryReportManifest(current, { sha: current.checkpoint.workspace.sha })).not.toThrow();
  expect(() => assertRepositoryReportManifest(current, { sha: 'd'.repeat(64) })).toThrow('CANDIDATE_MANIFEST_CHANGED');
  current.checkpoint.workspace.files.push({ path: 'changed.ts', content: 'different bytes' });
  expect(() => assertRepositoryReportManifest(current, { sha: current.checkpoint.workspace.sha })).toThrow('CANDIDATE_MANIFEST_CHANGED');
});
test('historical Developer test caveats do not contradict the current server checks', () => {
  const current = run(); current.checkpoint.roles[0].output.summaryKo = '헴, 지역 검색을 구현했습니다. 테스트·빌드는 아직 미검증입니다.';
  const text = slackTaskReport({ ...input, run: current }); expect(text).toContain('변경 요약* · 지역 검색을 구현했습니다.');
  expect(text).not.toContain('아직 미검증'); expect(text).toContain('테스트 통과 · 빌드 통과 · QA PASS');
  current.checkpoint.roles[0].output.summaryKo = `코드를 수정했습니다. xoxb-${'a'.repeat(35)}`;
  expect(slackTaskReport({ ...input, run: current })).not.toContain('xoxb-');
});
