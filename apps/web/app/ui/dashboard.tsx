"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  api, allProjects, ApiError, errorMessage, eventLabels, formatTime,
  type CompanyEvent, type Project, type Session, type Snapshot, type Task, type TaskDetail,
} from "./api";

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
      <div className="sidebar-note"><span className="tiny-square" aria-hidden="true" /><strong>기반을 만드는 중</strong><p>프로젝트와 업무를 준비하고<br />변경 이력을 확인하세요.</p><span className="phase-pill">PHASE 0 · FOUNDATION</span></div>
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
        {activeProject ? <ProjectWorkspace key={activeProject.id} project={activeProject} session={session} onError={onError} /> : <section className="empty-state panel"><span className="empty-mark" aria-hidden="true">＋</span><h2>첫 프로젝트를 만들어 주세요</h2><p>프로젝트를 만들면 업무 원문과 수용 기준을 등록할 수 있습니다.</p></section>}
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

function ProjectWorkspace({ project, session, onError }: { project: Project; session: Session; onError: (error: unknown) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<CompanyEvent[]>([]);
  const [connection, setConnection] = useState("연결 준비 중");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingError, setLoadingError] = useState("");
  const reloadRef = useRef<(() => Promise<Snapshot | undefined>) | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let stream: EventSource | undefined;
    let generation = 0;
    let probing = false;
    const seen = new Set<string>();
    const refresh = async () => {
      const request = ++generation;
      try {
        const loaded = await api<Snapshot>(`/projects/${encodeURIComponent(project.id)}/snapshot`, { signal: controller.signal });
        if (!controller.signal.aborted && request === generation) { setSnapshot(loaded); setLoadingError(""); }
        return loaded;
      } catch (failure) {
        if (!controller.signal.aborted) { setLoadingError(errorMessage(failure)); onError(failure); }
      }
    };
    reloadRef.current = refresh;
    const receive = (message: MessageEvent<string>) => {
      if (controller.signal.aborted) return;
      try {
        const entry = JSON.parse(message.data) as CompanyEvent;
        const id = message.lastEventId || entry.eventId;
        if (id && seen.has(id)) return;
        if (id) { seen.add(id); if (seen.size > 500) seen.delete(seen.values().next().value as string); }
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
      for (const type of ["task.created", "project.created", "task.updated", "task.status.changed"]) connected.addEventListener(type, receive as EventListener);
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
        seen.clear();
        setRefreshKey(current => current + 1);
        void refresh().then(loaded => {
          if (!controller.signal.aborted && loaded) connect(loaded.cursor);
        });
      });
    };
    void (async () => {
      try {
        const initial = await api<Snapshot>(`/projects/${encodeURIComponent(project.id)}/snapshot`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setSnapshot(initial);
        connect(initial.cursor);
      } catch (failure) {
        if (!controller.signal.aborted) { setConnection("연결할 수 없음"); setLoadingError(errorMessage(failure)); onError(failure); }
      }
    })();
    return () => { controller.abort(); stream?.close(); reloadRef.current = null; };
  }, [project.id, onError]);

  const tasks = snapshot?.tasks ?? [];
  const activeTask = tasks.find(task => task.id === selectedTaskId);

  return <>
    <section className="summary-grid" aria-label="프로젝트 현황">
      <SummaryCard label="등록된 업무" value={snapshot ? String(tasks.length) : "—"} suffix="건" caption="서버에 저장된 전체 업무" />
      <SummaryCard label="실행 중인 직원" value="—" caption="실행 엔진 연결 전" subdued />
      <SummaryCard label="승인 대기" value={snapshot ? String(snapshot.approvals.length) : "—"} suffix="건" caption="Owner 확인이 필요한 요청" />
      <div className="summary-card connection-card"><span>서버 동기화</span><strong className={connection === "실시간 연결됨" ? "connection-good" : "connection-pending"}><i aria-hidden="true" />{connection}</strong><small role="status" aria-live="polite">{snapshot ? `마지막 동기화 커서 ${snapshot.cursor}` : "서버 상태를 불러오고 있습니다."}</small></div>
    </section>
    <section className="engine-notice" aria-labelledby="engine-title"><span className="engine-icon" aria-hidden="true">▧</span><div><h2 id="engine-title">아직 실행 엔진이 연결되지 않았습니다</h2><p>지금은 업무 등록과 상태 이력 확인이 가능합니다. AI 직원 실행은 다음 단계에서 연결됩니다.</p></div><span className="subtle-tag">준비 단계</span></section>
    {loadingError && <div className="error-with-retry"><ErrorNotice message={loadingError} /><button className="button secondary" type="button" onClick={() => window.location.reload()}>연결 다시 시도</button></div>}
    <div className="work-grid">
      <section className="panel tasks-panel" aria-labelledby="task-list-title">
        <div className="section-heading"><div><span className="eyebrow">TASK BOARD</span><h2 id="task-list-title">업무 목록 <span className="count-pill">{snapshot ? tasks.length : "—"}</span></h2></div><button className="text-button" type="button" onClick={() => void reloadRef.current?.()}>새로고침</button></div>
        {!snapshot ? <p className="inline-empty" role="status">업무를 불러오는 중입니다…</p> : tasks.length === 0 ? <div className="empty-state"><span className="empty-mark" aria-hidden="true">▤</span><h3>아직 등록된 업무가 없습니다</h3><p>한국어 요청과 수용 기준을 입력해<br />첫 업무를 준비하세요.</p></div> : <ul className="task-list">{tasks.map(task => <li key={task.id}><button className={`task-row ${selectedTaskId === task.id ? "selected" : ""}`} type="button" onClick={() => setSelectedTaskId(task.id)} aria-label={`업무 상세: ${task.title}`} aria-expanded={selectedTaskId === task.id}><span className="task-symbol" aria-hidden="true">▤</span><span className="task-info"><strong>{task.title}</strong><small>v{task.version} · {formatTime(task.updatedAt)} KST</small></span><span className="status-badge">{task.statusLabelKo}</span><span className="task-arrow" aria-hidden="true">↗</span></button></li>)}</ul>}
      </section>
      <TaskForm projectId={project.id} session={session} onError={onError} onCreated={async task => { await reloadRef.current?.(); setSelectedTaskId(task.id); setRefreshKey(current => current + 1); }} />
    </div>
    {activeTask && <TaskDetailPanel key={`${activeTask.id}:${activeTask.version}:${refreshKey}`} task={activeTask} onError={onError} onClose={() => setSelectedTaskId("")} />}
    <section className="panel activity-panel" aria-labelledby="event-log-title"><div className="section-heading"><div><span className="eyebrow">ACTIVITY</span><h2 id="event-log-title">실시간 변경 기록</h2></div><span className="muted small">현재 연결에서 받은 최근 알림</span></div>{events.length === 0 ? <p className="inline-empty">아직 수신한 변경 알림이 없습니다. 업무의 저장 이력은 업무 상세에서 확인할 수 있습니다.</p> : <ol className="event-list">{events.map(entry => <li key={entry.eventId}><span className="event-dot" aria-hidden="true" /><strong>{eventLabels[entry.type] ?? entry.type}</strong><code>#{entry.sequence}</code><time dateTime={entry.timestamp}>{formatTime(entry.timestamp)} KST</time></li>)}</ol>}</section>
  </>;
}

function SummaryCard({ label, value, suffix, caption, subdued }: { label: string; value: string; suffix?: string; caption: string; subdued?: boolean }) {
  return <div className="summary-card"><span>{label}</span><strong className={subdued ? "muted" : ""}>{value}<small className="summary-suffix">{suffix}</small></strong><small>{caption}</small></div>;
}

function TaskForm({ projectId, session, onCreated, onError }: { projectId: string; session: Session; onCreated: (task: Task) => Promise<void>; onError: (error: unknown) => void }) {
  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("");
  const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const submission = useRef<Submission>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const acceptanceCriteria = criteria.split("\n").map(line => line.trim()).filter(Boolean).map((descriptionKo, index) => ({ id: `AC-${index + 1}`, descriptionKo, method: "manual", required: true }));
    if (acceptanceCriteria.length === 0) { setNotice("수용 기준을 한 개 이상 입력해 주세요."); return; }
    setBusy(true); setNotice("");
    try {
      const task = await api<Task>(`/projects/${encodeURIComponent(projectId)}/tasks`, submissionOptions({ title, commandOriginalKo: command, source: "TEXT", priority: "MEDIUM", acceptanceCriteria }, submission), session.csrfToken);
      submission.current = null;
      setTitle(""); setCommand(""); setCriteria(""); setNotice("업무를 등록했습니다. 실행 엔진 연결 전까지 대기합니다.");
      await onCreated(task);
    } catch (failure) { onError(failure); }
    finally { setBusy(false); }
  }
  return <section className="panel task-form-panel" aria-labelledby="task-form-title"><div className="section-heading"><div><span className="eyebrow">NEW TASK</span><h2 id="task-form-title">새 업무 등록</h2></div><span className="subtle-tag">한국어 원문 보존</span></div><form className="stack-form" onSubmit={submit}>
    <div className="field"><label htmlFor="task-title">업무 제목</label><input id="task-title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={200} placeholder="어떤 업무를 준비할까요?" /></div>
    <div className="field"><label htmlFor="task-command">한국어 요청 원문</label><textarea id="task-command" value={command} onChange={event => setCommand(event.target.value)} required maxLength={10000} rows={3} aria-describedby="command-help" placeholder="목표와 필요한 작업을 구체적으로 알려 주세요." /><small id="command-help">입력한 요청은 원문 그대로 서버에 저장됩니다.</small></div>
    <div className="field"><label htmlFor="task-criteria">수용 기준</label><textarea id="task-criteria" value={criteria} onChange={event => setCriteria(event.target.value)} required maxLength={10000} rows={3} aria-describedby="criteria-help" placeholder="예: 새로고침 후에도 입력한 설정이 유지된다" /><small id="criteria-help">줄마다 하나의 기준을 입력하세요. 등록 순서대로 AC ID가 부여됩니다.</small></div>
    {notice && <p className="form-notice" role="status">{notice}</p>}
    <div className="form-actions"><span>등록 후 상태: 대기</span><button type="submit" className="button primary" disabled={busy}>{busy ? "업무 저장 중…" : "업무 등록"}</button></div>
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
