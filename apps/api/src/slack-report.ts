import type { WorkflowRun } from '@ai-pixel/agents';
import { taskLabels, type TaskStatus } from '@ai-pixel/contracts';
import { hash, IntegrationError, safeText } from '@ai-pixel/integrations';

export function assertRepositoryReportManifest(run: WorkflowRun, snapshot: { sha: string }) {
  const files = run.checkpoint.workspace?.files, source = run.repositorySource;
  if (run.fixture !== 'how-to-trash-v1' || source?.profile !== 'how-to-trash-v1' || !files || !run.checkpoint.workspace
    || snapshot.sha !== run.checkpoint.workspace.sha
    || hash(JSON.stringify({ admissionSha: source.admissionSha, files: [...files].sort((a, b) => a.path.localeCompare(b.path, 'en')) })) !== snapshot.sha) throw new IntegrationError('CANDIDATE_MANIFEST_CHANGED', 409);
}

// Escape user/model text separately from links produced by this module.
export function slackLabel(value: string, maximum = 260) {
  let safe: string;
  try { safe = safeText(value, 100_000).replace(/\s+/g, ' ').trim(); }
  catch { return '요약을 안전하게 표시할 수 없습니다. 상세 화면에서 확인하세요.'; }
  let result = '';
  for (const character of safe.replace(/[*_~`]/g, '')) {
    const escaped = ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[character] ?? character;
    if (result.length + escaped.length > maximum) return `${result}…`;
    result += escaped;
  }
  return result;
}
export function slackDashboardLink(projectId: string, taskId?: string) {
  const query = new URLSearchParams({ project: projectId }); if (taskId) query.set('task', taskId);
  return `<http://127.0.0.1:3000/?${query}#task-inspector|대시보드 우측 상세 열기 (이 PC)>`;
}
function commitLink(run: WorkflowRun) {
  const delivery = run.checkpoint.delivery;
  if (!delivery || delivery.candidateSha !== run.checkpoint.workspace?.sha || delivery.repositoryUrl !== run.repositorySource?.repositoryUrl || !/^[a-f0-9]{40}$/.test(delivery.commitSha)) return null;
  try {
    const url = new URL(delivery.repositoryUrl);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || !/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname)) return null;
    return `<${url.origin}${url.pathname.replace(/\/$/, '').replace(/\.git$/, '')}/commit/${delivery.commitSha}|확인된 커밋 ${delivery.commitSha.slice(0, 7)}>`;
  } catch { return null; }
}
function changeSummary(value: string) {
  // Developer reports also contain their then-current test status. Keep the
  // change sentence here; current verification comes from the server below.
  return slackLabel(value.replace(/^헴[,，\s]+/, '').split(/(?<=[.!?。])\s+/u)[0]);
}
export function slackTaskReport(input: { projectId: string; projectName: string; task: { id: string; title: string; status: TaskStatus }; run?: WorkflowRun }) {
  const { task, projectId, projectName } = input;
  // Never attach another task's evidence, even if the caller supplies it accidentally.
  const run = input.run?.taskId === task.id && input.run.projectId === projectId ? input.run : undefined;
  const checkpoint = run?.checkpoint, sha = checkpoint?.workspace?.sha;
  const developer = checkpoint?.roles.filter(role => role.role === 'DEVELOPER' && role.candidateSha === sha).at(-1);
  const verification = checkpoint?.verification?.sha === sha && sha ? checkpoint?.verification : null;
  const qa = checkpoint?.roles.filter(role => role.role === 'QA').at(-1);
  const qaCurrent = !!sha && qa?.candidateSha === sha && qa?.output.candidateSha === sha;
  const checks = !run ? '미실행 · 실행 기록 없음' : `테스트 ${verification ? verification.test.exitCode === 0 ? '통과' : '실패' : '미검증'} · 빌드 ${verification ? verification.build.exitCode === 0 ? '통과' : '실패' : '미검증'} · QA ${qaCurrent ? qa?.output.verdict === 'PASS' && !qa.output.issues.length ? 'PASS' : 'FAIL' : '미검증'}`;
  let next = '상세 화면에서 수용 기준을 확인하고 실행 여부를 결정해 주세요.';
  if (run?.status === 'WAITING_APPROVAL') next = '상세 화면에서 변경 파일과 검증 근거를 검토하고 결과 수락 여부를 결정해 주세요.';
  else if (run?.status === 'SUCCEEDED') next = '결과 수락 완료. 후속 업무를 정해 주세요. merge·배포가 필요하면 별도로 승인해 주세요.';
  else if (run && ['BLOCKED', 'PAUSED', 'FAILED', 'CANCELLED'].includes(run.status)) next = '상세 화면에서 중단 사유와 남은 실행 한도를 확인해 주세요.';
  else if (run) next = '직원 실행 결과를 기다린 뒤 상세 화면에서 확인해 주세요.';
  const commit = run && commitLink(run);
  return [
    `*업무명* · ${slackLabel(task.title, 100)}`,
    `프로젝트 · ${slackLabel(projectName, 80)} / 상태 · ${taskLabels[task.status]}`,
    `*변경 요약* · ${developer ? changeSummary(developer.output.summaryKo) : '서버에 기록된 현재 후보의 코드 변경 요약이 없습니다.'}`,
    `*검증 결과* · ${checks}`,
    `*다음 할 일* · ${next}`,
    `*상세 화면* · ${slackDashboardLink(projectId, task.id)}`,
    commit ? `전달 근거 · ${commit}` : '전달 근거 · 확인된 push 커밋 기록 없음 (검증 후보와 Git 커밋은 별개)',
  ].join('\n');
}
