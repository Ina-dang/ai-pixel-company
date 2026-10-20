"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  api, allProjects, ApiError, errorMessage, eventLabels, formatTime,
  type CompanyEvent, type Project, type RoleEvidence, type Session, type Snapshot, type SubscriptionState, type Task, type TaskDetail, type WorkflowRun,
} from "./api";
import { PixelOffice } from './office';
import { CollaborationWorkspace } from './collaboration';
import { chooseSnapshot, ProjectEventGate } from './office-model';
import { VoiceInput, type VoiceCandidate } from './voice-input';

type Submission = { body: string; key: string } | null;

function submissionOptions(value: unknown, previous: { current: Submission }): RequestInit {
  const body = JSON.stringify(value);
  if (previous.current?.body !== body) previous.current = { body, key: crypto.randomUUID() };
  return { method: "POST", body, headers: { "Idempotency-Key": previous.current.key } };
}

function Brand() {
  return <a className="brand" href="/" aria-label="AI Pixel Company 홈">
    <span className="pixel-logo" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
    <span>PIXEL<span className="brand-small">COMPANY</span></span>
  </a>;
}

function ErrorNotice({ message }: { message: string }) {
  return message ? <div className="error-notice" role="alert">{message}</div> : null;
}

export function Dashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const authGeneration = useRef(0);

  const onError = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 401) {
      authGeneration.current += 1;
      setSession(null);
      setProjects([]);
      setProjectId("");
      setNotice("");
      setError("세션이 만료되었거나 로그아웃되었습니다. 다시 로그인해 주세요.");
    } else setError(errorMessage(failure));
  }, []);

  const loadProjects = useCallback(async (signal?: AbortSignal) => {
    const generation = authGeneration.current;
    const loaded = await allProjects(signal);
    if (signal?.aborted || generation !== authGeneration.current) return;
    setProjects(loaded);
    setProjectId(current => loaded.some(project => project.id === current) ? current : loaded[0]?.id ?? "");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const loaded = await api<Session>("/me", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setSession(loaded);
        await loadProjects(controller.signal);
      } catch (failure) {
        if (!controller.signal.aborted && !(failure instanceof ApiError && failure.status === 401)) onError(failure);
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    })();
    return () => controller.abort();
  }, [loadProjects, onError]);

  async function onLogin(secret: string) {
    setBusy(true);
    setError("");
    try {
      const authenticated = await api<Session>("/auth/session", { method: "POST", body: JSON.stringify({ secret }) });
      authGeneration.current += 1;
      setSession(authenticated);
      await loadProjects();
    } catch (failure) { onError(failure); }
    finally { setBusy(false); }
  }

  async function logout() {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await api<void>("/auth/session", { method: "DELETE" }, session.csrfToken);
      authGeneration.current += 1;
      setSession(null);
      setProjects([]);
      setProjectId("");
      setNotice("로그아웃했습니다.");
    } catch (failure) { onError(failure); }
    finally { setBusy(false); }
  }

  const activeProject = projects.find(project => project.id === projectId);

  if (checking) return <main className="login-page"><Brand /><p role="status">Owner 세션을 확인하고 있습니다…</p></main>;

  if (!session) return <main className="login-page">
    <Brand />
    <section className="login-card" aria-labelledby="login-title">
      <span className="eyebrow">LOCAL WORKSPACE</span>
      <h1 id="login-title">회사의 첫 업무를<br />준비해 볼까요.</h1>
      <p className="muted">로컬 개발 환경에서 발급된 키로 로그인하세요.</p>
      <ErrorNotice message={error} />
      {notice && <p className="success-notice" role="status">{notice}</p>}
      <LoginForm onLogin={onLogin} busy={busy} />
      <p className="login-footnote">Owner 전용 · 로컬 환경<br />키는 브라우저 저장소에 보관하지 않습니다.</p>
    </section>
    <p className="login-bottom">작은 픽셀에서 시작하는, 체계적인 업무.</p>
  </main>;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <aside className="sidebar" aria-label="회사 탐색">
      <Brand />
      <div className="workspace-label">WORKSPACE</div>
      <div className="organization-name">{session.organization.name}</div>
      <nav><a className="nav-link active" href="#main-content" aria-current="page"><span aria-hidden="true">▦</span> 회사 대시보드</a></nav>
      <div className="sidebar-note"><span className="tiny-square" aria-hidden="true" /><strong>근거와 함께 일하는 직원</strong><p>계획, 코드, 검증 결과를<br />확인하고 수락하세요.</p><span className="phase-pill">PHASE 2 · PIXEL OFFICE</span></div>
      <div className="owner-profile"><span className="avatar" aria-hidden="true">O</span><div><strong>{session.user.displayName}</strong><small>Owner · 로컬 세션</small></div><button className="logout" type="button" onClick={() => void logout()} disabled={busy}>로그아웃</button></div>
    </aside>
    <div className="content-shell">
      <header className="topbar"><span>워크스페이스 <span className="breadcrumb-separator">/</span> <strong>대시보드</strong></span><span className="environment-tag"><span aria-hidden="true" />로컬 개발 환경</span></header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        <div className="page-heading"><div><span className="eyebrow">COMPANY OVERVIEW</span><h1>회사 대시보드</h1><p className="muted">요청은 명확하게, 진행 상황은 근거와 함께.</p></div>{projects.length > 0 ? <button type="button" className="button primary" onClick={() => setShowProjectForm(value => !value)} aria-expanded={showProjectForm} aria-controls="project-form">{showProjectForm ? "프로젝트 양식 닫기" : "+ 새 프로젝트"}</button> : <span className="subtle-tag">첫 프로젝트 설정</span>}</div>
        <ErrorNotice message={error} />
        {notice && <p className="success-notice" role="status">{notice}</p>}
        {(showProjectForm || projects.length === 0) && <ProjectForm session={session} onError={onError} onCreated={async project => {
          await loadProjects();
          setProjectId(project.id);
          setShowProjectForm(false);
          setError("");
          setNotice(`프로젝트 ‘${project.name}’을 만들었습니다.`);
        }} />}
        {projects.length > 0 && <section className="project-bar" aria-label="프로젝트 선택">
          <div><label htmlFor="project-picker">현재 프로젝트</label><select id="project-picker" value={projectId} onChange={event => { setProjectId(event.target.value); setError(""); setNotice(""); }}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
          <div className="repository-meta"><span>연결 저장소</span><strong>{activeProject?.repositoryUrl || "저장소 미지정"}</strong><small>기본 브랜치 · {activeProject?.defaultBranch ?? "—"}</small></div>
        </section>}
        {activeProject ? <ProjectWorkspace key={activeProject.id} project={activeProject} session={session} onError={onError} onSelectProject={setProjectId} /> : <section className="empty-state panel"><span className="empty-mark" aria-hidden="true">＋</span><h2>첫 프로젝트를 만들어 주세요</h2><p>프로젝트를 만들면 업무 원문과 수용 기준을 등록할 수 있습니다.</p></section>}
        <footer className="page-footer">AI PIXEL COMPANY <span>화면의 업무 상태는 서버 기록을 기준으로 표시합니다.</span></footer>
      </main>
    </div>
  </div>;
}

function LoginForm({ onLogin, busy }: { onLogin: (secret: string) => Promise<void>; busy: boolean }) {
  const [secret, setSecret] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = secret;
    setSecret("");
    await onLogin(current);
  }
  return <form onSubmit={submit} className="stack-form">
    <label htmlFor="owner-secret">Owner 비밀키</label>
    <input id="owner-secret" type="password" autoComplete="off" value={secret} onChange={event => setSecret(event.target.value)} required maxLength={1024} spellCheck={false} />
    <button className="button primary full-width" type="submit" disabled={busy}>{busy ? "로그인 확인 중…" : "로그인"}</button>
  </form>;
}

function ProjectForm({ session, onCreated, onError }: { session: Session; onCreated: (project: Project) => Promise<void>; onError: (error: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const submission = useRef<Submission>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const project = await api<Project>("/projects", submissionOptions({ name, repositoryUrl, defaultBranch }, submission), session.csrfToken);
      submission.current = null;
      setName(""); setRepositoryUrl("");
      await onCreated(project);
    } catch (failure) { onError(failure); }
    finally { setBusy(false); }
  }
  return <section className="panel create-project" id="project-form" aria-labelledby="project-form-title">
    <div className="section-heading"><div><span className="eyebrow">NEW PROJECT</span><h2 id="project-form-title">프로젝트 만들기</h2></div><span className="subtle-tag">Owner</span></div>
    <form onSubmit={submit} className="project-form">
      <div className="field"><label htmlFor="project-name">프로젝트 이름</label><input id="project-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required placeholder="예: AI Pixel Company" /></div>
      <div className="field"><label htmlFor="repository-url">저장소 URL</label><input id="repository-url" type="url" value={repositoryUrl} onChange={event => setRepositoryUrl(event.target.value)} maxLength={2000} required placeholder="https://github.com/owner/repository.git" /></div>
      <div className="field"><label htmlFor="default-branch">기본 브랜치</label><input id="default-branch" value={defaultBranch} onChange={event => setDefaultBranch(event.target.value)} maxLength={255} required /></div>
      <button type="submit" className="button primary" disabled={busy}>{busy ? "프로젝트 생성 중…" : "프로젝트 만들기"}</button>
    </form>
  </section>;
}

function ProjectWorkspace({ project, session, onError, onSelectProject }: { project: Project; session: Session; onError: (error: unknown) => void; onSelectProject: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<CompanyEvent[]>([]);
  const [connection, setConnection] = useState("연결 준비 중");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingError, setLoadingError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const reloadRef = useRef<(() => Promise<Snapshot | undefined>) | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [subscriptionError, setSubscriptionError] = useState("");
  const checkSubscriptionRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const check = async () => {
      if (loading || controller.signal.aborted) return;
      loading = true;
      try {
        const loaded = await api<SubscriptionState>("/subscription", { signal: controller.signal });
        if (!controller.signal.aborted) { setSubscription(loaded); setSubscriptionError(""); }
      } catch (failure) {
        if (!controller.signal.aborted) { setSubscription(null); setSubscriptionError(errorMessage(failure)); onError(failure); }
      } finally { loading = false; }
    };
    checkSubscriptionRef.current = check;
    void check();
    const timer = window.setInterval(() => void check(), 10000);
    return () => { controller.abort(); window.clearInterval(timer); checkSubscriptionRef.current = null; };
  }, [onError]);

  useEffect(() => {
    const controller = new AbortController();
    let stream: EventSource | undefined;
    let probing = false;
    let current: Snapshot | null = null;
    let pending: Promise<Snapshot | undefined> | null = null;
    let dirty = false, resetRequested = false;
    let recoveryTimer: number | undefined;
    const gate = new ProjectEventGate(project.id, '0');
    const refresh = (reset = false): Promise<Snapshot | undefined> => {
      if (reset) resetRequested = true;
      if (pending) { dirty = true; return pending; }
      pending = (async () => {
        let result: Snapshot | undefined;
        do {
          dirty = false;
          const force = resetRequested; resetRequested = false;
          try {
            const loaded = await api<Snapshot>(`/projects/${encodeURIComponent(project.id)}/snapshot`, { signal: controller.signal });
            if (controller.signal.aborted) return;
            if (resetRequested) { dirty = true; continue; }
            const chosen = chooseSnapshot(current, loaded, project.id, force);
            if (!chosen || (chosen !== loaded && chosen.cursor !== loaded.cursor)) {
              setLoadingError('상태 순서를 확인하고 있습니다. 마지막으로 확인된 상태를 유지합니다.');
              continue;
            }
            current = chosen;
            if (force) gate.reset(chosen.cursor); else gate.advance(chosen.cursor);
            setSnapshot(chosen);
            setLastSyncedAt(loaded.syncedAt ?? new Date().toISOString());
            setLoadingError('');
            result = chosen;
          } catch (failure) {
            if (!controller.signal.aborted) { setLoadingError(errorMessage(failure)); onError(failure); }
          }
        } while (dirty && !controller.signal.aborted);
        return result;
      })().finally(() => { pending = null; });
      return pending;
    };
    reloadRef.current = refresh;
    const receive = (message: MessageEvent<string>) => {
      if (controller.signal.aborted) return;
      try {
        const entry = JSON.parse(message.data) as CompanyEvent;
        if (!gate.receive(entry)) return;
        setEvents(current => [{ ...entry, type: entry.type ?? message.type }, ...current].slice(0, 20));
        setRefreshKey(current => current + 1);
        void refresh();
      } catch { setLoadingError("변경 알림을 읽지 못해 서버 상태를 다시 확인합니다."); void refresh(); }
    };
    const connect = (cursor: string) => {
      if (controller.signal.aborted) return;
      const connected = new EventSource(`/api/v1/events/stream?projectId=${encodeURIComponent(project.id)}&after=${encodeURIComponent(cursor)}`);
      stream = connected;
      connected.onopen = () => { if (!controller.signal.aborted) { setConnection("실시간 연결됨"); void refresh(); } };
      connected.onerror = () => {
          if (controller.signal.aborted) return;
          setConnection("연결 끊김 · 재연결 중");
          if (probing) return;
          probing = true;
          void api<Session>("/me", { signal: controller.signal }).catch(failure => {
            if (!controller.signal.aborted && failure instanceof ApiError && failure.status === 401) { connected.close(); onError(failure); }
          }).finally(() => { probing = false; });
      };
      for (const type of ["task.created", "project.created", "task.updated", "task.status.changed", "workflow.run.created", "workflow.run.updated", "agent.completed", "approval.requested", "approval.resolved", "employee.created", "employee.profile.updated", "employee.employment.changed", "project.staffing.updated", "integration.updated", "integration.operation.updated", "integration.webhook.received", "integration.connection.updated", "integration.merge.requested"]) connected.addEventListener(type, receive as EventListener);
      connected.onmessage = receive;
      connected.addEventListener("stream.auth-error", () => {
        connected.close();
        if (!controller.signal.aborted) onError(new ApiError(401, "세션이 만료되었습니다."));
      });
      connected.addEventListener("stream.reset", () => {
        connected.close();
        if (controller.signal.aborted) return;
        setConnection("서버 상태 복원 중");
        setEvents([]);
        setRefreshKey(current => current + 1);
        const restore = () => { void refresh(true).then(loaded => {
          if (controller.signal.aborted) return;
          if (loaded) connect(loaded.cursor);
          else recoveryTimer = window.setTimeout(restore, 2000);
        }); };
        restore();
      });
      connected.addEventListener('stream.cursor', (message) => {
        try { gate.advance(JSON.parse((message as MessageEvent<string>).data).sequence); } catch { /* A snapshot will re-establish the cursor. */ }
      });
    };
    void refresh(true).then(initial => {
      if (controller.signal.aborted) return;
      if (initial) { if (!stream) connect(initial.cursor); } else setConnection('연결할 수 없음');
    });
    const visible = () => {
      if (!document.hidden) void refresh().then(loaded => {
        if (!controller.signal.aborted && loaded && !stream) connect(loaded.cursor);
      });
    };
    document.addEventListener('visibilitychange', visible);
    const poll = window.setInterval(visible, 10000);
    return () => { controller.abort(); stream?.close(); window.clearTimeout(recoveryTimer); window.clearInterval(poll); document.removeEventListener('visibilitychange', visible); reloadRef.current = null; };
  }, [project.id, onError]);

  const tasks = snapshot?.tasks ?? [];
  const activeTask = tasks.find(task => task.id === selectedTaskId);

  return <>
    <PixelOffice projectId={project.id} agents={snapshot?.agents} connection={loadingError ? '상태 확인 중' : connection} syncedAt={lastSyncedAt} onOpenTask={id => {
      setSelectedTaskId(id);
      window.requestAnimationFrame(() => document.querySelector('.task-detail')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    }} />
    <CollaborationWorkspace projectId={project.id} tasks={tasks} session={session} refreshKey={refreshKey} onOpenTask={setSelectedTaskId} onChanged={() => { void reloadRef.current?.(); }} onError={onError} onSelectProject={onSelectProject}/>
    <section className="summary-grid" aria-label="프로젝트 현황">
      <SummaryCard label="등록된 업무" value={snapshot ? String(tasks.length) : "—"} suffix="건" caption="서버에 저장된 전체 업무" />
      <SummaryCard label="직원 실행 방식" value="Codex" caption="PM → Developer → QA · 순차 실행" subdued />
      <SummaryCard label="승인 대기" value={snapshot ? String(snapshot.approvals.length) : "—"} suffix="건" caption="Owner 확인이 필요한 요청" />
      <div className="summary-card connection-card"><span>서버 동기화</span><strong className={connection === "실시간 연결됨" ? "connection-good" : "connection-pending"}><i aria-hidden="true" />{connection}</strong><small role="status" aria-live="polite">{snapshot ? `마지막 동기화 커서 ${snapshot.cursor}` : "서버 상태를 불러오고 있습니다."}</small></div>
    </section>
    <section className="engine-notice subscription-panel" aria-labelledby="engine-title"><span className="engine-icon" aria-hidden="true">▧</span><div><h2 id="engine-title">Codex 구독 · {subscription?.ready ? "실행 가능" : subscription ? "실행 중단 조건" : "상태 확인 중"}</h2><p>기존 구독의 포함 한도를 공유합니다. API 키 대체 경로 없이 한도에서 중단하고, 재개는 직접 요청합니다.</p>{subscription?.reason && <p className="stop-reason" role="status">중단 사유: {subscription.reason}</p>}{subscriptionError && <p role="status">구독 상태를 확인하지 못했습니다. 실행은 비활성화됩니다.</p>}{subscription && <div className="quota-windows">{subscription.windows.map((window, index) => <span key={`${window.windowDurationMins}:${window.resetsAt}`}>한도 {index + 1}: 사용 {window.usedPercent}%{window.resetsAt ? ` · 초기화 ${formatTime(new Date(window.resetsAt * 1000).toISOString())} KST` : " · 초기화 시각 미제공"}</span>)}<small>인증: {subscription.authMode} · 확인 {formatTime(subscription.checkedAt)} KST</small></div>}</div><button className="text-button" type="button" onClick={() => void checkSubscriptionRef.current?.()}>한도 확인</button></section>
    {loadingError && <div className="error-with-retry"><ErrorNotice message={loadingError} /><button className="button secondary" type="button" onClick={() => window.location.reload()}>연결 다시 시도</button></div>}
    <div className="work-grid">
      <section className="panel tasks-panel" aria-labelledby="task-list-title">
        <div className="section-heading"><div><span className="eyebrow">TASK BOARD</span><h2 id="task-list-title">업무 목록 <span className="count-pill">{snapshot ? tasks.length : "—"}</span></h2></div><button className="text-button" type="button" onClick={() => void reloadRef.current?.()}>새로고침</button></div>
        {!snapshot ? <p className="inline-empty" role="status">업무를 불러오는 중입니다…</p> : tasks.length === 0 ? <div className="empty-state"><span className="empty-mark" aria-hidden="true">▤</span><h3>아직 등록된 업무가 없습니다</h3><p>한국어 요청과 수용 기준을 입력해<br />첫 업무를 준비하세요.</p></div> : <ul className="task-list">{tasks.map(task => <li key={task.id}><button className={`task-row ${selectedTaskId === task.id ? "selected" : ""}`} type="button" onClick={() => setSelectedTaskId(task.id)} aria-label={`업무 상세: ${task.title}`} aria-expanded={selectedTaskId === task.id}><span className="task-symbol" aria-hidden="true">▤</span><span className="task-info"><strong>{task.title}</strong><small>v{task.version} · {formatTime(task.updatedAt)} KST</small></span><span className="status-badge">{task.statusLabelKo}</span><span className="task-arrow" aria-hidden="true">↗</span></button></li>)}</ul>}
      </section>
      <TaskForm projectId={project.id} session={session} onError={onError} onCreated={async task => { await reloadRef.current?.(); setSelectedTaskId(task.id); setRefreshKey(current => current + 1); }} />
    </div>
    {activeTask && <TaskDetailPanel key={`${activeTask.id}:${activeTask.version}:${refreshKey}`} task={activeTask} onError={onError} onClose={() => setSelectedTaskId("")} />}
    {activeTask && <WorkflowPanel key={activeTask.id} task={activeTask} session={session} subscription={subscription} refreshKey={refreshKey} onError={onError} onChanged={() => { void reloadRef.current?.(); void checkSubscriptionRef.current?.(); }} />}
    <section className="panel activity-panel" aria-labelledby="event-log-title"><div className="section-heading"><div><span className="eyebrow">ACTIVITY</span><h2 id="event-log-title">실시간 변경 기록</h2></div><span className="muted small">현재 연결에서 받은 최근 알림</span></div>{events.length === 0 ? <p className="inline-empty">아직 수신한 변경 알림이 없습니다. 업무의 저장 이력은 업무 상세에서 확인할 수 있습니다.</p> : <ol className="event-list">{events.map(entry => <li key={entry.eventId}><span className="event-dot" aria-hidden="true" /><strong>{eventLabels[entry.type] ?? entry.type}</strong><code>#{entry.sequence}</code><time dateTime={entry.timestamp}>{formatTime(entry.timestamp)} KST</time></li>)}</ol>}</section>
  </>;
}

function SummaryCard({ label, value, suffix, caption, subdued }: { label: string; value: string; suffix?: string; caption: string; subdued?: boolean }) {
  return <div className="summary-card"><span>{label}</span><strong className={subdued ? "muted" : ""}>{value}<small className="summary-suffix">{suffix}</small></strong><small>{caption}</small></div>;
}

const runStatusLabels: Record<WorkflowRun["status"], string> = {
  QUEUED: "실행 대기", RUNNING: "실행 중", PAUSED: "일시 정지", BLOCKED: "차단됨",
  WAITING_APPROVAL: "결과 수락 대기", SUCCEEDED: "실행 성공", FAILED: "실행 실패", CANCELLED: "취소됨",
};

function WorkflowPanel({ task, session, subscription, refreshKey, onError, onChanged }: {
  task: Task; session: Session; subscription: SubscriptionState | null; refreshKey: number;
  onError: (error: unknown) => void; onChanged: () => void;
}) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [acceptSha, setAcceptSha] = useState("");
  const submission = useRef<Submission>(null);
  const refresh = useRef<(() => Promise<void>) | null>(null);
  const alive = useRef(true);
  const observedRefresh = useRef(refreshKey);

  useEffect(() => {
    const controller = new AbortController();
    alive.current = true;
    let pending = false;
    const load = async () => {
      if (pending || controller.signal.aborted) return;
      pending = true;
      try {
        const result = await api<{ items: WorkflowRun[] }>(`/tasks/${encodeURIComponent(task.id)}/runs`, { signal: controller.signal });
        if (!controller.signal.aborted) { setRuns(result.items); setLoaded(true); setFailure(""); }
      } catch (error) {
        if (!controller.signal.aborted) { setFailure(errorMessage(error)); onError(error); }
      } finally { pending = false; }
    };
    refresh.current = load;
    void load();
    const timer = window.setInterval(() => void load(), 2500);
    return () => { alive.current = false; controller.abort(); window.clearInterval(timer); refresh.current = null; };
  }, [task.id, onError]);

  useEffect(() => {
    if (observedRefresh.current === refreshKey) return;
    observedRefresh.current = refreshKey;
    void refresh.current?.();
  }, [refreshKey]);

  const latest = runs[0];
  const terminal = latest && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(latest.status);
  const workspace = latest?.checkpoint.workspace;
  const verification = latest?.checkpoint.verification;
  const pm = latest?.checkpoint.roles.filter(role => role.role === "PM").at(-1);
  const developer = latest?.checkpoint.roles.filter(role => role.role === "DEVELOPER").at(-1);
  const qa = latest?.checkpoint.roles.filter(role => role.role === "QA").at(-1);
  const matchingEvidence = !!workspace && !!workspace.diff.trim() && workspace.files.length > 0 && !latest?.checkpoint.activeTurnId
    && verification?.sha === workspace.sha && verification.test.exitCode === 0 && verification.build.exitCode === 0
    && verification.sandbox.networkDisabled && verification.sandbox.readOnlyRoot && verification.sandbox.resourceLimited
    && !!pm?.output.specEn.trim() && pm.output.acceptanceCriteria.length > 0
    && developer?.candidateSha === workspace.sha && developer.output.files.length > 0
    && qa?.output.verdict === "PASS" && qa.candidateSha === workspace.sha && qa.output.candidateSha === workspace.sha && qa.output.issues.length === 0;
  const canResume = latest && !latest.stopping && (latest.resumable ?? (["PAUSED", "BLOCKED"].includes(latest.status) && !latest.checkpoint.activeTurnId && !latest.checkpoint.activeThreadId && latest.checkpoint.stopReason !== "RECOVERY_REQUIRED"));

  async function mutate(path: string, value: unknown) {
    if (busy) return;
    setBusy(true); setFailure("");
    try {
      const result = await api<WorkflowRun>(path, submissionOptions(value, submission), session.csrfToken);
      submission.current = null;
      if (!alive.current) return;
      setRuns(current => [result, ...current.filter(run => run.id !== result.id)]);
      setLoaded(true); setAcceptSha(""); onChanged();
      await refresh.current?.();
    } catch (error) {
      if (alive.current) { setFailure(errorMessage(error)); onError(error); }
    } finally { if (alive.current) setBusy(false); }
  }

  return <section className="panel workflow-panel" aria-labelledby="workflow-title">
    <div className="section-heading"><div><span className="eyebrow">SUBSCRIPTION WORKFLOW</span><h2 id="workflow-title">AI 직원 실행</h2></div><span className="subtle-tag">PM → Developer → QA</span></div>
    <p className="muted">Phase 1 검증 범위: 격리된 <code>node-functions-v1</code> 함수 라이브러리. 직원이 코드를 수정하면 샌드박스에서 테스트·빌드를 실행하고 같은 SHA를 QA가 검토합니다. 연결 저장소의 임의 코드는 실행하지 않습니다.</p>
    <ErrorNotice message={failure} />
    {!loaded && !failure && <p role="status">실행 기록을 불러오는 중입니다…</p>}
    {loaded && (!latest || terminal) && <div className="workflow-actions"><button type="button" className="button primary" disabled={busy || !subscription?.ready || !["TODO", "FAILED"].includes(task.status)} onClick={() => void mutate(`/tasks/${encodeURIComponent(task.id)}/runs`, { fixture: "node-functions-v1" })}>{busy ? "실행 요청 중…" : "검증 업무 실행"}</button><span className="muted small">구독 상태와 서버 실행 조건을 통과해야 시작합니다.</span></div>}
    {latest && <>
      <div className="run-meta"><span className="status-badge">실행: {runStatusLabels[latest.status]}</span><span>현재 단계: {latest.checkpoint.stage}</span><span>업무: {task.statusLabelKo}</span><span>실행 버전 {latest.version}</span></div>
      <p className="muted small run-identifier">실행 ID <code>{latest.id}</code> · {formatTime(latest.updatedAt)} KST</p>
      {latest.checkpoint.stopReason && <p className="run-blocked" role="status">중단 사유: <code>{latest.checkpoint.stopReason}</code><br />조건을 해결한 후 한도를 확인하고 직접 재개해 주세요. 자동 재시도나 API 키 대체 실행은 하지 않습니다.</p>}
      {latest.stopping && <p role="status" className="muted small">진행 중인 직원 작업의 중단 확인을 기다리고 있습니다.</p>}
      {!terminal && latest.status !== "WAITING_APPROVAL" && <div className="workflow-actions">
        {["QUEUED", "RUNNING"].includes(latest.status) && <button className="button secondary" type="button" disabled={busy} onClick={() => void mutate(`/runs/${encodeURIComponent(latest.id)}/control`, { action: "pause", expectedVersion: latest.version })}>일시 정지 요청</button>}
        {canResume && <button className="button primary" type="button" disabled={busy || !subscription?.ready} onClick={() => void mutate(`/runs/${encodeURIComponent(latest.id)}/control`, { action: "resume", expectedVersion: latest.version })}>실행 재개</button>}
      </div>}
      {!terminal && <div className="workflow-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => void mutate(`/runs/${encodeURIComponent(latest.id)}/control`, { action: "cancel", expectedVersion: latest.version })}>실행 취소</button></div>}
      <div className="role-evidence-grid">{(["PM", "DEVELOPER", "QA"] as const).map(role => {
        const entries = latest.checkpoint.roles.filter(entry => entry.role === role);
        return <article className="role-evidence" key={role}><h3>{role === "DEVELOPER" ? "Developer" : role}</h3>{entries.length ? entries.map(entry => <RoleResult key={`${entry.threadId}:${entry.turnId}`} evidence={entry} />) : <p className="muted small">완료된 결과 없음</p>}</article>;
      })}</div>
      {workspace && <div className="candidate-evidence"><h3>코드 변경 근거</h3><p className="run-sha">후보 SHA <code>{workspace.sha}</code></p><p className="small">Developer 제출 파일: {latest.checkpoint.roles.filter(role => role.role === "DEVELOPER").at(-1)?.output.files.map(file => file.path).join(", ") || "기록 없음"}</p><details><summary>후보 diff 확인</summary><pre className="evidence-output">{workspace.diff || "diff 없음"}</pre></details></div>}
      {verification && <div className="verification-evidence"><h3>실제 실행 검증</h3><p className="run-sha">검증 SHA <code>{verification.sha}</code> · {formatTime(verification.verifiedAt)} KST</p><div className="verification-grid">{(["test", "build"] as const).map(kind => <details key={kind} open={verification[kind].exitCode !== 0}><summary>{kind === "test" ? "테스트" : "빌드"} 종료 코드: {verification[kind].exitCode}</summary><pre className="evidence-output">{verification[kind].output || "출력 없음"}</pre></details>)}</div><p className="muted small">네트워크 차단: {verification.sandbox.networkDisabled ? "검증됨" : "미검증"} · 루트 읽기 전용: {verification.sandbox.readOnlyRoot ? "검증됨" : "미검증"} · 자원 제한: {verification.sandbox.resourceLimited ? "검증됨" : "미검증"}</p></div>}
      <p className="usage-evidence">구독 사용 기록 · 입력 {latest.checkpoint.usage.inputTokens.toLocaleString("ko-KR")} / 캐시 입력 {latest.checkpoint.usage.cachedInputTokens.toLocaleString("ko-KR")} / 출력 {latest.checkpoint.usage.outputTokens.toLocaleString("ko-KR")} 토큰 · 모델 호출 {latest.checkpoint.turns}회 · 재작업 {latest.checkpoint.rework}회<br /><span className="muted">토큰 수를 API 요금으로 환산하지 않습니다.</span></p>
      {latest.status === "WAITING_APPROVAL" && <div className="acceptance-box"><h3>Owner 결과 수락</h3><p>위 코드 변경과 테스트·빌드·QA 결과를 검토하고 표시된 후보 SHA를 수락합니다. 서버가 근거와 최신 버전을 다시 확인합니다.</p>{!matchingEvidence && <p role="status">동일 SHA의 테스트·빌드·QA PASS 근거가 부족하여 수락할 수 없습니다.</p>}<label className="acceptance-check"><input type="checkbox" checked={!!workspace && acceptSha === workspace.sha} disabled={!matchingEvidence || busy} onChange={event => setAcceptSha(event.target.checked ? workspace?.sha ?? "" : "")} /><span>후보 SHA <code>{workspace?.sha ?? "없음"}</code>의 결과를 확인했습니다.</span></label><button type="button" className="button primary" disabled={busy || !matchingEvidence || acceptSha !== workspace?.sha} onClick={() => void mutate(`/runs/${encodeURIComponent(latest.id)}/accept`, { candidateSha: workspace?.sha, expectedVersion: latest.version })}>표시한 SHA 결과 수락</button></div>}
      {runs.length > 1 && <details className="past-runs"><summary>이전 실행 {runs.length - 1}건</summary><ul>{runs.slice(1).map(run => <li key={run.id}><code>{run.id}</code> · {runStatusLabels[run.status]} · {formatTime(run.updatedAt)} KST</li>)}</ul></details>}
    </>}
  </section>;
}

function RoleResult({ evidence }: { evidence: RoleEvidence }) {
  return <div className="role-result"><p>{evidence.output.summaryKo}</p><p className="muted small">판정: {evidence.output.verdict} · {formatTime(evidence.completedAt)} KST</p>{evidence.candidateSha && <p className="run-sha"><code>{evidence.candidateSha}</code></p>}<details><summary>인계 명세·수용 기준</summary><p className="original-command">{evidence.output.specEn}</p><ul className="criteria-list">{evidence.output.acceptanceCriteria.map(criterion => <li key={criterion.id}><code>{criterion.id}</code><span>{criterion.description}</span></li>)}</ul>{evidence.output.issues.length > 0 && <ul>{evidence.output.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}<p className="muted small run-identifier">스레드 <code>{evidence.threadId}</code><br />턴 <code>{evidence.turnId}</code></p></details></div>;
}

function TaskForm({ projectId, session, onCreated, onError }: { projectId: string; session: Session; onCreated: (task: Task) => Promise<void>; onError: (error: unknown) => void }) {
  const [voiceCandidate, setVoiceCandidate] = useState<VoiceCandidate | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceConfirmed, setVoiceConfirmed] = useState(false);
  const [voiceReset, setVoiceReset] = useState(0);
  useEffect(() => { if (projectId) { setVoiceCandidate(null); setVoiceConfirmed(false); setVoiceBusy(false); } }, [projectId]);
  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("");
  const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const submission = useRef<Submission>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || voiceBusy) return;
    if (voiceCandidate && !voiceConfirmed) { setNotice('전사 내용을 수정·확인한 뒤 확인란을 선택해 주세요.'); return; }
    const acceptanceCriteria = criteria.split("\n").map(line => line.trim()).filter(Boolean).map((descriptionKo, index) => ({ id: `AC-${index + 1}`, descriptionKo, method: "manual", required: true }));
    if (acceptanceCriteria.length === 0) { setNotice("수용 기준을 한 개 이상 입력해 주세요."); return; }
    setBusy(true); setNotice("");
    try {
      const input = { title, commandOriginalKo: command, source: voiceCandidate ? 'VOICE' : 'TEXT', priority: 'MEDIUM', acceptanceCriteria };
      const task = await api<Task>(voiceCandidate ? `/voice/candidates/${voiceCandidate.id}/confirm` : `/projects/${encodeURIComponent(projectId)}/tasks`, submissionOptions(voiceCandidate ? { task: input, confirmed: true, expectedVersion: voiceCandidate.version } : input, submission), session.csrfToken);
      submission.current = null;
      setTitle(""); setCommand(""); setCriteria(""); setNotice("업무를 등록했습니다. 업무 상세에서 실행 범위를 확인해 주세요.");
      setVoiceCandidate(null); setVoiceConfirmed(false); setVoiceReset(value => value + 1);
      await onCreated(task);
    } catch (failure) { onError(failure); }
    finally { setBusy(false); }
  }
  return <section className="panel task-form-panel" aria-labelledby="task-form-title"><div className="section-heading"><div><span className="eyebrow">NEW TASK</span><h2 id="task-form-title">새 업무 등록</h2></div><span className="subtle-tag">한국어 원문 보존</span></div><form className="stack-form" onSubmit={submit}>
    <VoiceInput key={`${projectId}-${voiceReset}`} projectId={projectId} session={session} onBusy={setVoiceBusy} onCandidate={candidate => { setVoiceCandidate(candidate); setVoiceConfirmed(false); setCommand(candidate?.transcript ?? ''); submission.current = null; }} />
    <div className="field"><label htmlFor="task-title">업무 제목</label><input id="task-title" value={title} onChange={event => { setTitle(event.target.value); setVoiceConfirmed(false); }} required maxLength={200} placeholder="어떤 업무를 준비할까요?" /></div>
    <div className="field"><label htmlFor="task-command">한국어 요청 원문</label><textarea id="task-command" value={command} onChange={event => { setCommand(event.target.value); setVoiceConfirmed(false); }} required maxLength={10000} rows={3} aria-describedby="command-help" placeholder="목표와 필요한 작업을 구체적으로 알려 주세요." /><small id="command-help">입력한 요청은 원문 그대로 서버에 저장됩니다.</small></div>
    <div className="field"><label htmlFor="task-criteria">수용 기준</label><textarea id="task-criteria" value={criteria} onChange={event => { setCriteria(event.target.value); setVoiceConfirmed(false); }} required maxLength={10000} rows={3} aria-describedby="criteria-help" placeholder="예: 새로고침 후에도 입력한 설정이 유지된다" /><small id="criteria-help">줄마다 하나의 기준을 입력하세요. 등록 순서대로 AC ID가 부여됩니다.</small></div>
    {notice && <p className="form-notice" role="status">{notice}</p>}
    {voiceCandidate && <label className="acceptance-check"><input type="checkbox" checked={voiceConfirmed} onChange={event => setVoiceConfirmed(event.target.checked)} /><span>프로젝트와 전사 수정 내용·수용 기준을 확인했습니다. 이 내용으로 업무를 등록합니다.</span></label>}
    <div className="form-actions"><span>등록 후 상태: 대기{voiceCandidate ? ' · 음성 전사 확인 필요' : ''}</span><button type="submit" className="button primary" disabled={busy || voiceBusy || Boolean(voiceCandidate && !voiceConfirmed)}>{busy ? "업무 저장 중…" : "업무 등록"}</button></div>
  </form></section>;
}

function TaskDetailPanel({ task, onError, onClose }: { task: Task; onError: (error: unknown) => void; onClose: () => void }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<TaskDetail>(`/tasks/${encodeURIComponent(task.id)}`, { signal: controller.signal }).then(loaded => {
      if (!controller.signal.aborted) { setDetail(loaded); setFailed(false); }
    }).catch(failure => { if (!controller.signal.aborted) { setFailed(true); onError(failure); } });
    return () => controller.abort();
  }, [task.id, onError]);
  const shown = detail ?? task;
  return <section className="panel detail-panel" aria-labelledby="task-detail-title"><div className="section-heading"><div><span className="eyebrow">TASK DETAIL</span><h2 id="task-detail-title">{shown.title}</h2></div><button type="button" className="text-button" onClick={onClose}>상세 닫기</button></div>
    <div className="detail-meta"><span className="status-badge">{shown.statusLabelKo}</span><span>버전 {shown.version}</span><span>최종 변경 · {formatTime(shown.updatedAt)} KST</span></div>
    <div className="detail-grid"><div><h3>한국어 요청 원문</h3><p className="original-command">{shown.commandOriginalKo}</p><h3>수용 기준</h3><ul className="criteria-list">{shown.acceptanceCriteria.map(criterion => <li key={criterion.id}><code>{criterion.id}</code><span>{criterion.descriptionKo}</span></li>)}</ul></div><div><h3>업무 상태 이력</h3>{failed ? <p role="status" className="muted">이력을 불러오지 못했습니다. 업무를 다시 선택해 주세요.</p> : !detail ? <p role="status" className="muted">이력을 불러오는 중입니다…</p> : detail.events.length === 0 ? <p className="muted">서버에 기록된 상태 이력이 없습니다.</p> : <ol className="history-list">{detail.events.map(entry => <li key={entry.eventId}><strong>{eventLabels[entry.type] ?? entry.type}</strong><span><time dateTime={entry.timestamp}>{formatTime(entry.timestamp)} KST</time> · #{entry.sequence}</span></li>)}</ol>}</div></div>
  </section>;
}
