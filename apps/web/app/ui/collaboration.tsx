'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, ApiError, errorMessage, formatTime, type Session, type Task, type WorkflowRun } from './api';
import { employmentNames, kanbanLanes, laneTasks, listInput, operationNames, operationStatusNames, roleNames, safeExternalUrl,
  staffRoles, toolNames, validLimits, type Employee, type Integrations, type ProfileLimits, type StaffAssignment, type StaffRole, type StaffTemplate } from './collaboration-model';
import './collaboration.css';
import { MergeApproval, SlackCommandHistory } from './integration-approvals';
import { CompanyOperations, EmployeeReviews } from './company-workspace';
import {OperationsPanel} from './operations';

export type CollaborationWorkspaceProps = { projectId: string; tasks: Task[]; session: Session; refreshKey?: number;
  onOpenTask: (id: string) => void; onChanged: () => void; onError: (error: unknown) => void; onSelectProject?: (id: string) => void };
type StaffData = { templates: StaffTemplate[]; employees: Employee[]; assignments: StaffAssignment[] };
type Tab = 'board' | 'staff' | 'integrations' | 'company' | 'reviews' | 'operations';
const tabs: { id: Tab; label: string }[] = [{ id: 'board', label: '업무 보드' }, { id: 'staff', label: '직원·배정' }, { id: 'integrations', label: '연동 현황' }, {id:'company',label:'회사 운영'}, {id:'reviews',label:'직원 평가'}, {id:'operations',label:'운영·복구'}];

function useMutation(session: Session, onRefresh: () => Promise<void>, onError: (error: unknown) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const previous = useRef<{ signature: string; key: string } | null>(null);
  const run = async (path: string, value: unknown, method = 'POST'): Promise<boolean> => {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError('');
    const body = JSON.stringify(value), signature = `${method}:${path}:${body}`;
    if (previous.current?.signature !== signature) previous.current = { signature, key: crypto.randomUUID() };
    try {
      await api(path, { method, body, headers: { 'Idempotency-Key': previous.current.key } }, session.csrfToken);
      previous.current = null; await onRefresh(); return true;
    } catch (failure) { setError(errorMessage(failure)); onError(failure); return false; }
    finally { pending.current = false; setBusy(false); }
  };
  return { run, busy, error };
}
function InlineError({ message }: { message: string }) { return message ? <p className="error-notice" role="alert">{message}</p> : null; }

export function CollaborationWorkspace({ projectId, tasks, session, refreshKey = 0, onOpenTask, onChanged, onError, onSelectProject }: CollaborationWorkspaceProps) {
  const [tab, setTab] = useState<Tab>('board');
  const [staff, setStaff] = useState<StaffData | null>(null);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError('');
    const results = await Promise.allSettled([
      api<{ items: StaffTemplate[] }>('/employees/templates', { signal: controller.signal }),
      api<{ items: Employee[] }>('/employees', { signal: controller.signal }),
      api<{ items: StaffAssignment[] }>(`/projects/${encodeURIComponent(projectId)}/staffing`, { signal: controller.signal }),
      api<Integrations>(`/projects/${encodeURIComponent(projectId)}/integrations`, { signal: controller.signal }),
    ]);
    if (controller.signal.aborted || request !== generation.current) return;
    const [templates, employees, assignments, connected] = results;
    if (templates.status === 'fulfilled' && employees.status === 'fulfilled' && assignments.status === 'fulfilled') {
      setStaff({ templates: templates.value.items, employees: employees.value.items, assignments: assignments.value.items });
    } else setStaff(null);
    setIntegrations(connected.status === 'fulfilled' ? connected.value : null);
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) {
      setError('직원 또는 연동 정보를 모두 불러오지 못했습니다. 다시 확인해 주세요.');
      for (const result of failed) if (result.status === 'rejected' && result.reason instanceof ApiError && result.reason.status === 401) onError(result.reason);
    }
    setLoading(false);
    setRevision(current => current + 1);
  }, [projectId, onError]);
  useEffect(() => { void refreshKey; void load(); return () => active.current?.abort(); }, [load, refreshKey]);
  const refresh = async () => { await load(); onChanged(); };
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setTab(tabs[next].id); document.getElementById(`collaboration-tab-${tabs[next].id}`)?.focus();
  }
  return <section className="collaboration panel" aria-label="업무와 협업 관리">
    <div className="collaboration-heading"><div><span className="eyebrow">WORK TOGETHER</span><h2>업무와 협업</h2><p>업무의 흐름, 함께할 직원, 연결 상태를 한곳에서 확인하세요.</p></div><span className="subtle-tag">Codex 구독</span></div>
    <div className="collaboration-tabs" role="tablist" aria-label="협업 화면">{tabs.map((entry, index) => <button key={entry.id} id={`collaboration-tab-${entry.id}`} type="button" role="tab" aria-selected={tab === entry.id} aria-controls={`collaboration-panel-${entry.id}`} tabIndex={tab === entry.id ? 0 : -1} onKeyDown={event => tabKey(event, index)} onClick={() => setTab(entry.id)}>{entry.label}</button>)}</div>
    {tab !== 'board' && <div className="collaboration-refresh"><button className="text-button" type="button" disabled={loading} onClick={() => void load()}>{loading ? '서버 상태 확인 중…' : '협업 정보 새로고침'}</button></div>}
    <InlineError message={error} />
    {error && <button className="text-button" type="button" disabled={loading} onClick={() => void load()}>협업 정보 다시 확인</button>}
    <div id={`collaboration-panel-${tab}`} role="tabpanel" aria-labelledby={`collaboration-tab-${tab}`} className="collaboration-content">
      {tab === 'board' && <><p className="collaboration-note">업무 상태는 실행·검증·결과 수락에 따라 바뀝니다. 카드를 열어 근거와 다음 작업을 확인하세요.</p><div className="kanban-board">{kanbanLanes.map(lane => {
        const items = laneTasks(tasks, lane.statuses);
        return <section className={`kanban-lane lane-${lane.id}`} key={lane.id} aria-label={`${lane.title} 업무`}><h3>{lane.title}<span>{items.length}</span></h3>{items.length ? <ul>{items.map(task => <li key={task.id}><button type="button" className="kanban-task" onClick={() => onOpenTask(task.id)} aria-label={`보드 업무 열기: ${task.title}`}><span className="status-badge">{task.statusLabelKo}</span><strong>{task.title}</strong><small>수용 기준 {task.acceptanceCriteria.length}개 · v{task.version}</small><span className="kanban-open">업무 상세 <span aria-hidden="true">↗</span></span></button></li>)}</ul> : <p className="kanban-empty">해당 상태의 업무가 없습니다.</p>}</section>;
      })}</div><p className="collaboration-footnote">실행 범위: 격리된 node-functions-v1 함수 검증. 보드에서 최종 상태를 직접 변경하지 않습니다.</p></>}
      {tab === 'staff' && (staff ? <StaffingPanel key={projectId} projectId={projectId} data={staff} session={session} onRefresh={refresh} onError={onError} /> : <p role="status" className="muted">{loading ? '직원과 배정 정보를 확인하고 있습니다.' : '직원 정보를 확인할 수 없습니다. 다시 확인해 주세요.'}</p>)}
      {tab === 'integrations' && (integrations ? <IntegrationPanel key={projectId} projectId={projectId} tasks={tasks} data={integrations} session={session} refreshKey={revision} onRefresh={refresh} onError={onError} /> : <p role="status" className="muted">{loading ? '연결 상태를 확인하고 있습니다.' : '연결 상태를 확인할 수 없습니다. 다시 확인해 주세요.'}</p>)}
      {tab === 'company' && <CompanyOperations key={projectId} projectId={projectId} session={session} refreshKey={refreshKey} onChanged={onChanged} onError={onError} onSelectProject={onSelectProject}/>}
      {tab === 'reviews' && <EmployeeReviews key={projectId} projectId={projectId} session={session} refreshKey={refreshKey} onChanged={onChanged} onError={onError}/>}
      {tab === 'operations' && <OperationsPanel key={projectId} projectId={projectId} session={session} onError={onError}/>}
    </div>
  </section>;
}

function StaffingPanel({ projectId, data, session, onRefresh, onError }: { projectId: string; data: StaffData; session: Session; onRefresh: () => Promise<void>; onError: (error: unknown) => void }) {
  const [editing, setEditing] = useState<Employee | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<Employee | null>(null);
  const [selection, setSelection] = useState<Partial<Record<StaffRole, string>>>({});
  const mutation = useMutation(session, onRefresh, onError);
  async function history(employee: Employee) {
    try { setDetail(await api<Employee>(`/employees/${encodeURIComponent(employee.id)}`)); }
    catch (failure) { onError(failure); }
  }
  return <>
    <div className="collaboration-section-heading"><div><h3>직원과 프로젝트 배정</h3><p>역할에 직원을 배정하고, 실행 시점의 프로필 버전을 보존합니다. 설정 변경은 새 버전으로 남습니다.</p></div><button className="button primary" type="button" onClick={() => { setEditing(null); setShowForm(value => !value); }}>{showForm && !editing ? '채용 양식 닫기' : '새 직원 채용'}</button></div>
    <div className="staff-assignments">{staffRoles.map(role => {
      const assigned = data.assignments.find(item => item.role === role);
      const available = data.employees.filter(employee => employee.role === role && employee.employmentStatus === 'ACTIVE');
      const selected = selection[role] ?? assigned?.employeeId ?? '';
      const validSelection = available.some(employee => employee.id === selected);
      return <section className="staff-assignment" key={role} aria-label={`${roleNames[role]} 프로젝트 배정`}>
        <h4>{roleNames[role]}</h4><p>{assigned ? <>{assigned.employeeNameKo} <span className="muted">· {employmentNames[assigned.employmentStatus]} · 프로필 v{assigned.profileVersion}</span></> : '미배정 · 새 실행 전에 직원을 선택하세요'}</p>
        <label htmlFor={`assignment-${role}`}>{roleNames[role]} 배정 직원</label><select id={`assignment-${role}`} value={validSelection ? selected : ''} disabled={mutation.busy} onChange={event => setSelection(current => ({ ...current, [role]: event.target.value }))}><option value="">직원 선택</option>{available.map(employee => <option key={employee.id} value={employee.id}>{employee.nameKo} · 프로필 v{employee.currentProfileVersion}</option>)}</select>
        <div className="staff-row-actions"><button className="button secondary" type="button" disabled={mutation.busy || !validSelection} onClick={() => void mutation.run(`/projects/${encodeURIComponent(projectId)}/staffing`, { role, employeeId: selected, ...(assigned ? { expectedVersion: assigned.version } : {}) }, 'PUT')}>배정 저장</button>{assigned && <button className="text-button" type="button" disabled={mutation.busy} onClick={() => void mutation.run(`/projects/${encodeURIComponent(projectId)}/staffing/${role}`, { expectedVersion: assigned.version }, 'DELETE')}>배정 해제</button>}</div>
      </section>;
    })}</div>
    <InlineError message={mutation.error} />
    {showForm && <ProfileForm key={editing ? `${editing.id}:${editing.version}` : 'new'} templates={data.templates} employee={editing} session={session} onRefresh={async () => { await onRefresh(); setShowForm(false); setEditing(null); }} onError={onError} onClose={() => setShowForm(false)} />}
    {data.employees.length === 0 ? <div className="staff-empty"><h4>아직 채용한 직원이 없습니다</h4><p>PM·Developer·QA 템플릿에서 직원을 만들고 이 프로젝트에 배정하세요. 배정한 직원의 프로필은 새 실행부터 사용됩니다.</p></div> : <ul className="employee-list">{data.employees.map(employee => <li key={employee.id}>
      <div className={`staff-avatar avatar-${employee.profile.avatar}`} aria-hidden="true">{roleNames[employee.role][0]}</div>
      <div className="employee-summary"><strong>{employee.nameKo}</strong><span>{roleNames[employee.role]} · {employmentNames[employee.employmentStatus]} · 프로필 v{employee.currentProfileVersion}</span><small>{employee.profile.departmentKo || '부서 미지정'} · {employee.profile.model} · Codex 구독</small></div>
      <div className="staff-row-actions">
        <button className="text-button" type="button" onClick={() => void history(employee)} aria-label={`${employee.nameKo} 프로필 이력`}>프로필 이력</button>
        <button className="text-button" type="button" onClick={() => { setEditing(employee); setShowForm(true); }} aria-label={`${employee.nameKo} 새 프로필 버전`}>새 버전 작성</button>
        {employee.employmentStatus === 'ACTIVE' && <button className="text-button" type="button" disabled={mutation.busy} onClick={() => void mutation.run(`/employees/${employee.id}/employment`, { action: 'suspend', expectedVersion: employee.version })} aria-label={`${employee.nameKo} 일시 중지`}>일시 중지</button>}
        {employee.employmentStatus !== 'RETIRED' && <button className="text-button" type="button" disabled={mutation.busy} onClick={() => void mutation.run(`/employees/${employee.id}/employment`, { action: 'retire', expectedVersion: employee.version })} aria-label={`${employee.nameKo} 퇴사 처리`}>퇴사 처리</button>}
        {employee.employmentStatus !== 'ACTIVE' && <button className="text-button" type="button" disabled={mutation.busy} onClick={() => void mutation.run(`/employees/${employee.id}/employment`, { action: 'rehire', expectedVersion: employee.version })} aria-label={`${employee.nameKo} ${employee.employmentStatus === 'SUSPENDED' ? '재직 재개' : '재채용'}`}>{employee.employmentStatus === 'SUSPENDED' ? '재직 재개' : '재채용'}</button>}
      </div>
    </li>)}</ul>}
    {detail && <section className="profile-history" aria-label="프로필 버전 이력"><div className="collaboration-section-heading"><h4>{detail.nameKo} · 프로필 이력</h4><button className="text-button" type="button" onClick={() => setDetail(null)}>이력 닫기</button></div>{(detail.profiles ?? [detail.profile]).map(profile => <details key={profile.profileVersion}><summary>프로필 v{profile.profileVersion} · {profile.model}</summary><dl className="profile-facts"><div><dt>역할 명세</dt><dd className="preserve-text">{profile.rolePrompt || '템플릿 기본 명세'}</dd></div><div><dt>전문 기술</dt><dd>{profile.skills.join(', ') || '미지정'}</dd></div><div><dt>도구</dt><dd>{profile.tools.join(', ')}</dd></div><div><dt>실행 상한</dt><dd>{profile.limits.maxTurns}회 · {profile.limits.maxTokens.toLocaleString('ko-KR')}토큰 · {profile.limits.maxElapsedMs / 1000}초</dd></div></dl></details>)}<p className="collaboration-footnote">고용 이력 {(detail.employmentHistory ?? []).length}건 · 기존 실행의 프로필과 검증 근거는 보존됩니다.</p></section>}
    <p className="collaboration-footnote">재직 상태와 실행 상태는 별개입니다. 권한·도구·예산은 실행 직전 서버에서 다시 확인합니다.</p>
  </>;
}

function ProfileForm({ templates, employee, session, onRefresh, onError, onClose }: { templates: StaffTemplate[]; employee: Employee | null; session: Session; onRefresh: () => Promise<void>; onError: (error: unknown) => void; onClose: () => void }) {
  const [role, setRole] = useState<StaffRole>(employee?.role ?? templates[0]?.role ?? 'PM');
  const template = templates.find(item => item.role === role);
  const profile = employee?.profile;
  const [name, setName] = useState(employee?.nameKo ?? '');
  const [department, setDepartment] = useState(profile?.departmentKo ?? '');
  const [skills, setSkills] = useState(profile?.skills.join(', ') ?? '');
  const [style, setStyle] = useState(profile?.workStyleKo ?? '');
  const [prompt, setPrompt] = useState(profile?.rolePrompt ?? '');
  const [tools, setTools] = useState(profile?.tools ?? template?.tools ?? []);
  const [limits, setLimits] = useState<ProfileLimits>(profile?.limits ?? template?.limits ?? { maxTurns: 1, maxTokens: 1, maxElapsedMs: 1000 });
  const [avatar, setAvatar] = useState(profile?.avatar ?? template?.avatar ?? 'pm');
  const [invalid, setInvalid] = useState('');
  const mutation = useMutation(session, onRefresh, onError);
  async function submit(event: FormEvent) {
    event.preventDefault(); setInvalid('');
    const parsedSkills = listInput(skills);
    if (!template || !name.trim() || !validLimits(limits, template.limits) || tools.length === 0 || tools.some(tool => !template.tools.includes(tool)) || parsedSkills.length > 10 || parsedSkills.some(skill => skill.length > 80)) { setInvalid('이름, 전문 기술(최대 10개), 허용 도구와 실행 상한을 확인해 주세요.'); return; }
    const fields = { nameKo: name.trim(), provider: template.provider, model: template.model, ...(department.trim() ? { departmentKo: department.trim() } : {}), skills: parsedSkills, ...(style.trim() ? { workStyleKo: style.trim() } : {}), ...(prompt.trim() ? { rolePrompt: prompt } : {}), tools, limits, avatar };
    await mutation.run(employee ? `/employees/${employee.id}` : '/employees', employee ? { ...fields, expectedVersion: employee.version } : { ...fields, template: role }, employee ? 'PATCH' : 'POST');
  }
  return <form className="staff-profile-form" onSubmit={submit} aria-label={employee ? '새 프로필 버전 작성' : '직원 채용 양식'}><div className="collaboration-section-heading"><div><h4>{employee ? `프로필 v${employee.currentProfileVersion + 1} 작성` : '새 직원 채용'}</h4><p>고정된 역할 범위에서 설정합니다. 현재 모델을 별도 API 키로 바꾸지 않습니다.</p></div><button className="text-button" type="button" onClick={onClose}>양식 닫기</button></div><div className="staff-form-grid">
    <div className="field"><label htmlFor="staff-role">역할 템플릿</label><select id="staff-role" value={role} disabled={!!employee || mutation.busy} onChange={event => { const next = event.target.value as StaffRole; const selected = templates.find(item => item.role === next); setRole(next); if (selected) { setTools(selected.tools); setLimits(selected.limits); setAvatar(selected.avatar); } }}>{templates.map(item => <option key={item.role} value={item.role}>{roleNames[item.role]}</option>)}</select></div>
    <div className="field"><label htmlFor="staff-name">직원 이름</label><input id="staff-name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></div>
    <div className="field"><label htmlFor="staff-department">부서</label><input id="staff-department" value={department} onChange={event => setDepartment(event.target.value)} maxLength={80} placeholder="입력하지 않으면 기본 부서 사용" /></div>
    <div className="field"><label htmlFor="staff-avatar">픽셀 캐릭터</label><select id="staff-avatar" value={avatar} onChange={event => setAvatar(event.target.value)}><option value="pm">기획 캐릭터</option><option value="developer">개발 캐릭터</option><option value="qa">검토 캐릭터</option></select></div>
    <div className="field"><label htmlFor="staff-skills">전문 기술</label><input id="staff-skills" value={skills} onChange={event => setSkills(event.target.value)} maxLength={1000} placeholder="예: TypeScript, 테스트 설계" /></div>
    <div className="field"><label htmlFor="staff-style">업무 성향</label><input id="staff-style" value={style} onChange={event => setStyle(event.target.value)} maxLength={300} placeholder="예: 근거를 확인하고 간결하게 보고" /></div>
    <div className="field staff-wide"><label htmlFor="staff-prompt">역할 명세</label><textarea id="staff-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} rows={3} maxLength={4000} placeholder="입력하지 않으면 템플릿 기본 명세를 사용합니다." /><small>역할 명세는 앱의 권한·실행 정책을 바꾸지 않습니다.</small></div>
    <fieldset className="staff-tools staff-wide"><legend>허용 도구</legend>{template?.tools.map(tool => <label key={tool}><input type="checkbox" checked={tools.includes(tool)} onChange={event => setTools(current => event.target.checked ? [...current, tool] : current.filter(item => item !== tool))} />{toolNames[tool] ?? tool}</label>)}</fieldset>
    <div className="field"><label htmlFor="staff-turns">최대 모델 응답 수</label><input id="staff-turns" type="number" min={1} max={template?.limits.maxTurns} value={limits.maxTurns} onChange={event => setLimits(current => ({ ...current, maxTurns: Number(event.target.value) }))} required /></div>
    <div className="field"><label htmlFor="staff-tokens">토큰 상한</label><input id="staff-tokens" type="number" min={1000} max={template?.limits.maxTokens} value={limits.maxTokens} onChange={event => setLimits(current => ({ ...current, maxTokens: Number(event.target.value) }))} required /></div>
    <div className="field"><label htmlFor="staff-time">실행 시간 상한(초)</label><input id="staff-time" type="number" min={1} max={(template?.limits.maxElapsedMs ?? 1000) / 1000} value={limits.maxElapsedMs / 1000} onChange={event => setLimits(current => ({ ...current, maxElapsedMs: Number(event.target.value) * 1000 }))} required /></div>
  </div><p className="collaboration-note">모델: {template?.model ?? '확인 필요'} · Codex 구독 포함 한도 공유 · API 키 대체 없음</p><InlineError message={invalid || mutation.error} /><div className="staff-row-actions"><button className="button primary" type="submit" disabled={mutation.busy || !template}>{mutation.busy ? '저장 중…' : employee ? '새 프로필 버전 저장' : '직원 채용 저장'}</button><span className="muted small">{employee ? `기존 v${employee.currentProfileVersion}은 보존됩니다.` : '채용 후 프로젝트 역할에 배정하세요.'}</span></div></form>;
}

function IntegrationPanel({ projectId, tasks, data, session, refreshKey, onRefresh, onError }: { projectId: string; tasks: Task[]; data: Integrations; session: Session; refreshKey: number; onRefresh: () => Promise<void>; onError: (error: unknown) => void }) {
  const [taskId, setTaskId] = useState('');
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedRun, setSelectedRun] = useState('');
  const [kind, setKind] = useState('DRAFT_PR_CREATE');
  const [reviewed, setReviewed] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [runError, setRunError] = useState('');
  const mutation = useMutation(session, onRefresh, onError);
  const available = data.connections.some(connection => connection.configured && connection.enabled);
  const connection = data.connections.find(item => item.provider === (kind === 'SLACK_REPORT' ? 'SLACK' : 'GITHUB'));
  const run = runs.find(item => item.id === selectedRun);
  const unresolved = data.operations.some(operation => operation.runId === selectedRun && operation.kind === kind && ['UNKNOWN', 'PENDING', 'RUNNING', 'DEFERRED'].includes(operation.status));
  useEffect(() => {
    void refreshKey;
    const controller = new AbortController(); setRuns([]); setSelectedRun(''); setReviewed(false); setRunError('');
    if (taskId) void api<{ items: WorkflowRun[] }>(`/tasks/${encodeURIComponent(taskId)}/runs`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setRuns(result.items); setSelectedRun(result.items[0]?.id ?? ''); }
    }).catch(failure => { if (!controller.signal.aborted) { setRunError(errorMessage(failure)); onError(failure); } });
    return () => controller.abort();
  }, [taskId, onError, refreshKey]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!run || !reviewed || unresolved || !connection?.configured || !connection.enabled) return;
    if (body.length > 6000) { setRunError('보고 내용은 6,000자 이내로 입력해 주세요.'); return; }
    setRunError('');
    const done = await mutation.run(`/projects/${encodeURIComponent(projectId)}/integrations/operations`, { kind, runId: run.id, expectedRunVersion: run.version, ...(title.trim() ? { title } : {}), ...(body.trim() ? { body } : {}) });
    if (done) { setReviewed(false); setTitle(''); setBody(''); }
  }
  return <>
    <div className="collaboration-section-heading"><div><h3>외부 연결 상태</h3><p>설정된 범위와 실제 확인 결과를 표시합니다. 연동 장애는 업무 검증 결과와 별도로 기록됩니다.</p></div></div>
    <p className="collaboration-note">Slack에 설치된 GitHub 앱과 AI Pixel Company 전용 연동은 별개예요. 이 회사가 작업할 저장소와 보고할 채널을 따로 연결해야 합니다.</p>
    <div className="integration-connections">{(['GITHUB', 'SLACK'] as const).map(provider => {
      const current = data.connections.find(item => item.provider === provider);
      const connected = !!current?.configured && current.enabled;
      const keys = provider === 'GITHUB' ? data.setup.githubEnv : data.setup.slackEnv;
      return <section className={`integration-connection ${connected ? 'is-configured' : ''}`} key={provider} aria-label={`${provider === 'GITHUB' ? 'GitHub' : 'Slack'} 연결`}>
        <div className="integration-provider"><span aria-hidden="true">{provider === 'GITHUB' ? 'GH' : 'S'}</span><h4>{provider === 'GITHUB' ? 'GitHub App' : 'Slack App'}</h4><span className="status-badge">{connected ? '서버 설정 확인됨' : current?.reason === 'DISABLED' ? '비활성' : '미설정'}</span></div>
        <p>{connected ? '연동 설정이 있습니다. 개별 작업의 원격 결과와 승인 범위는 별도로 확인합니다.' : provider === 'GITHUB' ? 'GitHub App 설치와 저장소 범위, 서버 자격 증명 설정이 필요합니다.' : 'Slack App 설치와 workspace·channel 범위, 서버 자격 증명 설정이 필요합니다.'}</p>
        {current?.configured && current.publicConfig && <ConnectionScope provider={provider} config={current.publicConfig} />}
        {connected && <p className="muted small">웹훅 서명 키: {current?.webhookConfigured ? '설정됨 · 원격 수신은 별도 검증 필요' : '미설정 · 외부 작업 발행만 가능'}</p>}
        {current?.reason && <p className="muted small">상태 코드: <code>{current.reason}</code></p>}
        <details><summary>설정 확인 경로</summary>
          <p>{provider === 'GITHUB' ? '전용 GitHub App을 만들고, 작업할 저장소에 설치하는 순서예요.' : '전용 Slack App을 만들고, 보고받을 workspace와 채널에 연결하는 순서예요.'}</p>
          <a className="operation-link" href={provider === 'GITHUB' ? 'https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app' : 'https://docs.slack.dev/quickstart/'} target="_blank" rel="noopener noreferrer">{provider === 'GITHUB' ? 'GitHub App 만들기 공식 안내' : 'Slack App 만들기 공식 안내'} <span aria-hidden="true">↗</span></a>
          <p>앱을 준비하면 관리자가 서버 연결 설정과 허용 범위를 확인해야 합니다. 비밀 키나 토큰을 이 화면에 입력하지 마세요.</p>
          <details><summary>개발자용 서버 설정 이름</summary><ul className="integration-env">{keys.map(key => <li key={key}><code>{key}</code></li>)}</ul></details>
          <p className="muted small">설정만으로 외부 작업의 성공이나 추가 권한이 확인되지는 않습니다.</p>
        </details>
      </section>;
    })}</div>
    {available ? <form className="integration-request" aria-label="외부 작업 요청" onSubmit={submit}><h4>검증 근거로 외부 작업 요청</h4><div className="staff-form-grid"><div className="field"><label htmlFor="integration-task">대상 업무</label><select id="integration-task" value={taskId} onChange={event => setTaskId(event.target.value)}><option value="">업무 선택</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></div><div className="field"><label htmlFor="integration-run">대상 실행</label><select id="integration-run" value={selectedRun} onChange={event => { setSelectedRun(event.target.value); setReviewed(false); }}><option value="">실행 선택</option>{runs.map(item => <option key={item.id} value={item.id}>{item.id} · {item.status} · v{item.version}</option>)}</select></div><div className="field"><label htmlFor="integration-kind">작업 종류</label><select id="integration-kind" value={kind} onChange={event => { setKind(event.target.value); setReviewed(false); }}>{Object.entries(operationNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field"><label htmlFor="integration-title">작업 제목</label><input id="integration-title" value={title} onChange={event => { setTitle(event.target.value); setReviewed(false); }} maxLength={200} /></div><div className="field staff-wide"><label htmlFor="integration-body">보고 내용</label><textarea id="integration-body" rows={2} value={body} onChange={event => { setBody(event.target.value); setReviewed(false); }} maxLength={10000} /><small>비밀·원시 코드·원시 실행 로그를 넣지 마세요.</small></div></div>{run && <p className="integration-candidate">대상 버전 {run.version} · 후보 SHA <code>{run.checkpoint.workspace?.sha ?? '검증된 후보 없음'}</code></p>}<label className="collaboration-check"><input type="checkbox" checked={reviewed} disabled={!run || unresolved || !connection?.configured || !connection.enabled} onChange={event => setReviewed(event.target.checked)} /><span>표시한 실행·후보 SHA·작업 종류를 확인했습니다. 서버가 검증·권한·설치 범위를 다시 검사합니다.</span></label>{kind === 'MERGE_REQUEST' && <p className="collaboration-note">이 요청은 merge 승인 범위를 기록합니다. 실제 merge는 실행하지 않습니다.</p>}{unresolved && <p className="integration-unknown" role="status">이 실행과 작업에 미확정·진행 중인 기록이 있습니다. 원격 결과를 확인하기 전에는 다시 요청할 수 없습니다.</p>}<InlineError message={runError || mutation.error} /><button className="button primary" type="submit" disabled={mutation.busy || !run || !reviewed || unresolved || !connection?.configured || !connection.enabled}>{mutation.busy ? '요청 기록 중…' : '확인한 외부 작업 요청'}</button></form> : <p className="collaboration-note">현재 실행 가능한 외부 연동이 없습니다. 로컬 코드 검증·테스트·결과 확인은 계속 사용할 수 있습니다.</p>}
    {!available && <InlineError message={mutation.error} />}
    <h4 className="operation-history-title">merge 승인 요청</h4>
    {(data.mergeRequests?.length ?? 0) === 0 ? <p className="muted small">별도로 승인할 merge 요청이 없습니다.</p> : <ol className="integration-operations">{data.mergeRequests?.map(request => <MergeApproval key={`${request.id}:${request.version}:${request.scopeHash}`} request={request} projectId={projectId} session={session} busy={mutation.busy} perform={mutation.run} />)}</ol>}
    <SlackCommandHistory commands={data.commands ?? []} />
    <h4 className="operation-history-title">외부 작업 기록 <span className="count-pill">{data.operations.length}</span></h4>{data.operations.length === 0 ? <p className="muted small">기록된 외부 작업이 없습니다. 미설정 상태를 연결 성공으로 표시하지 않습니다.</p> : <ol className="integration-operations">{data.operations.map(operation => {
      const ref = typeof operation.externalRef === 'object' && operation.externalRef ? (operation.externalRef as Record<string, unknown>).url : operation.externalRef;
      const url = safeExternalUrl(ref);
      return <li key={operation.id} className={operation.status === 'UNKNOWN' ? 'is-unknown' : ''}>
        <div><strong>{operationNames[operation.kind] ?? operation.kind}</strong><span className="status-badge">{operation.kind === 'CI_REFRESH' && operation.status === 'SUCCEEDED' ? '조회 완료' : operationStatusNames[operation.status]}</span></div>
        {operation.kind === 'CI_REFRESH' && operation.status === 'SUCCEEDED' && <CiEvidence value={operation.externalRef} />}
        <p className="muted small">{operation.provider} · 시도 {operation.attempts}회 · {formatTime(operation.updatedAt)} KST</p>
        {operation.runId && <p className="operation-reference">실행 <code>{operation.runId}</code></p>}
        {operation.candidateSha && <p className="operation-reference">후보 SHA <code>{operation.candidateSha}</code></p>}
        {operation.errorCode && <p className="operation-reference">확인 코드 <code>{operation.errorCode}</code></p>}
        {operation.status === 'UNKNOWN' && <><p className="integration-unknown">원격 생성 여부가 확정되지 않았습니다. GitHub·Slack에서 실제 결과를 확인하고 조정해야 하며, 같은 작업을 자동 재전송하지 않습니다.</p><button type="button" className="text-button" disabled={mutation.busy} onClick={() => void mutation.run(`/projects/${encodeURIComponent(projectId)}/integrations/operations/${operation.id}/reconcile`, {})}>원격 결과 다시 확인</button></>}
        {url && <a className="operation-link" href={url} target="_blank" rel="noopener noreferrer">확인된 외부 참조 열기 <span aria-hidden="true">↗</span></a>}
      </li>;
    })}</ol>}
  </>;
}

function CiEvidence({ value }: { value: unknown }) {
  const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return <div className="operation-reference"><p>CI 검사 결과: {result.status === 'PASS' ? '통과' : result.status === 'NOT_PASSED' ? '미통과' : '확인 필요'}</p>
    {typeof result.headSha === 'string' && <p>원격 head <code>{result.headSha}</code></p>}
    {Array.isArray(result.required) && <ul>{result.required.map(item => item && typeof item === 'object' && typeof item.name === 'string' && typeof item.state === 'string' ? <li key={item.name}>{item.name}: {item.state}</li> : null)}</ul>}
  </div>;
}

function ConnectionScope({ provider, config }: { provider: 'GITHUB' | 'SLACK'; config: Record<string, unknown> }) {
  const fields = provider === 'GITHUB' ? [['저장소', 'repository'], ['기본 브랜치', 'baseBranch'], ['설치 ID', 'installationId'], ['정책 버전', 'policyVersion']]
    : [['Workspace ID', 'teamId'], ['Channel ID', 'channelId'], ['매핑된 사용자 수', 'mappedUsers']];
  return <dl className="integration-scope">{fields.map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{typeof config[key] === 'string' || typeof config[key] === 'number' ? String(config[key]) : '확인 필요'}</dd></div>)}</dl>;
}
