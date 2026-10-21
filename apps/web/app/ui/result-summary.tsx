import type { Project, WorkflowRun } from './api';
import { formatTime } from './api';
import { dashboardLink, deliveryLinks, repositoryLink } from './result-model';

export function ProjectResultContext({ project, taskCount }: { project: Project; taskCount: number }) {
  const repository = repositoryLink(project.repositoryUrl);
  return <div className="result-context"><span className="eyebrow">SELECTED PROJECT</span><h2>프로젝트 상세</h2><strong>{project.name}</strong><p>업무 {taskCount}건 · 기본 브랜치 {project.defaultBranch}</p>{repository && <a href={repository} target="_blank" rel="noopener noreferrer">저장소 바로 열기 ↗</a>}<p className="muted">업무를 선택하면 결과와 변경 내용을 이곳에서 확인할 수 있습니다.</p></div>;
}

export function ResultSummary({ run, matchingEvidence, projectId, taskTitle }: { run: WorkflowRun; matchingEvidence: boolean; projectId: string; taskTitle: string }) {
  const checkpoint = run.checkpoint, qa = checkpoint.roles.filter(role => role.role === 'QA').at(-1);
  const developer = checkpoint.roles.filter(role => role.role === 'DEVELOPER').at(-1);
  const links = deliveryLinks(run);
  const files = links?.delivery.files ?? developer?.output.files.map(file => file.path) ?? [];
  const matches = !!checkpoint.workspace && checkpoint.workspace.sha === checkpoint.verification?.sha;
  return <section className="result-summary" aria-label="선택 업무 결과 요약"><h3>결과 한눈에 보기</h3>
    <p><strong>업무 · {taskTitle}</strong></p>
    <p className="result-next-step">{run.status === 'WAITING_APPROVAL' ? '검증을 마쳤습니다. 변경 내용과 근거를 확인한 뒤 수락 여부를 결정해 주세요.' : run.status === 'SUCCEEDED' ? 'Owner가 결과를 수락했습니다. merge·배포 상태는 별도입니다.' : '현재까지 확인된 근거입니다. 검증 완료 전에는 결과를 수락하지 않습니다.'}</p>
    <dl className="result-checks">{(['test', 'build'] as const).map(kind => <div key={kind}><dt>{kind === 'test' ? '테스트' : '빌드'}</dt><dd>{!checkpoint.verification ? '미실행' : !matches ? '후보 불일치' : checkpoint.verification[kind].exitCode === 0 ? '통과 · 종료 0' : `실패 · 종료 ${checkpoint.verification[kind].exitCode}`}</dd></div>)}<div><dt>QA</dt><dd>{matchingEvidence ? 'PASS · 동일 후보' : qa ? `${qa.output.verdict} · 근거 확인 필요` : '검토 전'}</dd></div></dl>
    <p>{qa?.output.summaryKo || developer?.output.summaryKo || '아직 완료된 직원 보고가 없습니다.'}</p>
    <div className="result-links">{links ? <><a href={links.commit} target="_blank" rel="noopener noreferrer">변경 커밋 {links.delivery.commitSha.slice(0, 7)} ↗</a><a href={links.branch} target="_blank" rel="noopener noreferrer">작업 브랜치 열기 ↗</a><small>원격 전달 확인 · {formatTime(links.delivery.verifiedAt)} KST</small></> : <p className="muted">확인된 push 기록이 없습니다. 후보 SHA는 Git 커밋 주소가 아닙니다.</p>}<a href={dashboardLink(projectId, run.taskId)}>이 업무 바로가기</a></div>
    <details className="result-files" open><summary>변경 파일 {files.length}개</summary>{files.length ? <ul>{files.map(path => <li key={path}>{links ? <a href={`${repositoryLink(links.delivery.repositoryUrl)}/blob/${links.delivery.commitSha}/${path.split('/').map(encodeURIComponent).join('/')}`} target="_blank" rel="noopener noreferrer">{path} ↗</a> : <code>{path}</code>}</li>)}</ul> : <p>제출된 변경 파일이 없습니다.</p>}</details><small>검증 통과·수락·push·merge·배포는 서로 다른 상태입니다.</small>
  </section>;
}
