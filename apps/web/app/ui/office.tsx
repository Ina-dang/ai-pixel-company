'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { OfficeAgent } from '@ai-pixel/contracts';
import { formatTime } from './api';
import { locationNames, officeRoles, roleNames, stateNames, validOfficeAgents } from './office-model';
import type { createOfficeScene } from './office-scene';
import { OFFICE_ROOM_LABELS } from './office-presentation';
import './office.css';

type SceneHandle = ReturnType<typeof createOfficeScene>;
type Props = { projectId: string; agents: unknown; connection: string; syncedAt: string | null; onOpenTask: (id: string) => void };
const runNames: Record<string, string> = { QUEUED: '실행 대기', RUNNING: '실행 중', PAUSED: '일시 중지', BLOCKED: '진행 차단', WAITING_APPROVAL: '결과 수락 대기', SUCCEEDED: '수락 완료', FAILED: '실패', CANCELLED: '취소됨' };
const taskNames: Record<string, string> = { TODO: '할 일', PLANNING: '계획 중', IN_PROGRESS: '진행 중', REVIEW: '검토 중', APPROVAL_REQUIRED: '승인 대기', COMPLETED: '완료', FAILED: '실패', CANCELLED: '취소' };
const stageNames: Record<string, string> = { PM: 'PM 명세 작성', DEVELOPER: 'Developer 코드 작성', VERIFY: '테스트·빌드 검증', QA: 'QA 검토' };

export function PixelOffice({ projectId, agents: input, connection, syncedAt, onOpenTask }: Props) {
  const agents = useMemo(() => validOfficeAgents(input), [input]);
  const [selectedId, setSelectedId] = useState<OfficeAgent['id']>('PM');
  const [graphics, setGraphics] = useState(true);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback' | 'off'>('loading');
  const [retry, setRetry] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneHandle | null>(null);
  const live = connection === '실시간 연결됨';
  const latest = useRef({ agents, selectedId, reducedMotion, visible: visible && live, snap: true });
  const previousLive = useRef(live);
  const hasAgents = agents.length === 3;
  const selected = agents.find(agent => agent.id === selectedId);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReducedMotion(media.matches);
    const visibility = () => setVisible(!document.hidden);
    motion(); visibility();
    media.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    return () => { media.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  useEffect(() => {
    const snap = !previousLive.current || !live;
    previousLive.current = live;
    latest.current = { agents, selectedId, reducedMotion, visible: visible && live, snap };
    scene.current?.update(agents, { selectedId, reducedMotion, visible: visible && live, snap });
  }, [agents, selectedId, reducedMotion, visible, live]);

  useEffect(() => {
    if (!graphics || !hasAgents || !mount.current) { setState(graphics ? 'fallback' : 'off'); return; }
    mount.current.dataset.officeProject = projectId;
    mount.current.dataset.officeAttempt = String(retry);
    let disposed = false, failed = false;
    let handle: SceneHandle | null = null;
    setState('loading');
    void import('./office-scene').then(module => {
      if (disposed || !mount.current) return;
      handle = module.createOfficeScene(mount.current, {
        onSelect: id => { if (!disposed) setSelectedId(id); },
        onReady: () => { if (!disposed && !failed) setState('ready'); },
        onError: () => {
          failed = true;
          if (!disposed) { setState('fallback'); handle?.destroy(); scene.current = null; }
        },
      });
      if (disposed || failed) { handle.destroy(); return; }
      scene.current = handle;
      handle.update(latest.current.agents, { ...latest.current, snap: true });
    }).catch(() => { if (!disposed) setState('fallback'); });
    return () => { disposed = true; handle?.destroy(); if (scene.current === handle) scene.current = null; };
  }, [graphics, hasAgents, projectId, retry]);

  return <section className="pixel-office panel" aria-label="픽셀 사무실" data-office-state={state}>
    <div className="office-heading">
      <div><span className="eyebrow">OUR LITTLE WORKPLACE</span><h2>픽셀 사무실 <span className="office-headcount">직원 {agents.filter(agent => agent.assignmentStatus === undefined || agent.assignmentStatus === 'ACTIVE').length}명</span></h2><p>계획하고, 만들고, 검토하는 지금의 모습.</p></div>
      <button type="button" className="button secondary office-graphics-toggle" onClick={() => setGraphics(value => !value)}>{graphics ? '그래픽 끄기' : '그래픽 켜기'}</button>
    </div>
    <div className={`office-sync ${live ? 'is-live' : 'is-stale'}`} role="status">
      <span><i aria-hidden="true" />{live ? '실제 서버 상태와 연결됨' : '연결 복구 중 · 마지막 확인 상태'}</span>
      <small>{syncedAt ? `마지막 확인 ${formatTime(syncedAt)} KST` : '직원 상태를 확인하고 있습니다.'}</small>
    </div>
    <div className={`office-visual ${state === 'ready' ? 'is-ready' : ''}`}>
      <div className="office-plan">
        <div ref={mount} className="office-canvas" data-office-style="original-v4" aria-hidden="true" />
        {state === 'ready' && <div className="office-room-labels" aria-hidden="true">{OFFICE_ROOM_LABELS.map(room => <span className="office-room-label" key={room.name} style={{ left: `${room.x / 896 * 100}%`, top: `${room.y / 512 * 100}%` }}>{room.name}</span>)}</div>}
      </div>
      {state !== 'ready' && <div className="office-fallback" role="status"><span className="office-fallback-mark" aria-hidden="true">▦</span><strong>{state === 'loading' ? '사무실 문을 여는 중…' : state === 'off' ? '직원 상태를 텍스트로 보고 있어요' : '직원 목록으로 계속 확인할 수 있어요'}</strong><p>{!hasAgents ? '서버의 직원 상태를 확인하고 있습니다.' : '업무 실행과 결과는 아래 직원 상세에서 확인하세요.'}</p>{state === 'fallback' && hasAgents && <button type="button" className="button secondary" onClick={() => setRetry(value => value + 1)}>그래픽 다시 불러오기</button>}</div>}
      <div className="office-caption"><span>직원 상태는 아래 목록에서도 확인할 수 있어요</span><a href="/office-licenses.txt" target="_blank" rel="noopener noreferrer">그래픽·라이선스</a></div>
    </div>
    {selected && <div className="office-selection-speech" role="note" aria-label="선택 직원 현재 활동"><strong className="office-selection-name">{selected.nameKo} · {stateNames[selected.state]}</strong><span className="office-selection-message">현재 작업 · {selected.activityKo}</span></div>}
    <fieldset className="office-team" aria-label="직원 목록">{officeRoles.map(role => {
      const agent = agents.find(item => item.id === role);
      return <button type="button" key={role} className={`office-person ${selectedId === role ? 'is-selected' : ''}`} aria-label={`${roleNames[role]} 직원 상세`} aria-pressed={selectedId === role} data-office-agent={role} data-agent-state={agent?.state ?? 'UNKNOWN'} data-run-stage={agent?.stage ?? ''} data-run-id={agent?.runId ?? ''} onClick={() => setSelectedId(role)}>
        <span className={`office-portrait role-${role.toLowerCase()}`} aria-hidden="true"><i /><b />{role === 'PM' ? 'P' : role === 'DEVELOPER' ? 'D' : 'Q'}</span>
        <span className="office-person-content"><strong>{agent?.nameKo ?? roleNames[role]} <small>{roleNames[role]} · {role === 'PM' ? '기획' : role === 'DEVELOPER' ? '개발' : '품질 검토'}</small></strong><span className={`office-state state-${agent?.state.toLowerCase() ?? 'unknown'}`}><i aria-hidden="true" />{agent ? stateNames[agent.state] : '상태 확인 필요'}</span><span className="office-activity">{agent?.activityKo ?? '서버의 직원 상태를 기다리고 있어요'}</span></span>
      </button>;
    })}</fieldset>
    <section className="office-detail" aria-labelledby="office-detail-title" aria-live="polite">
      <div className="office-detail-intro"><span className="eyebrow">EMPLOYEE DESK</span><h3 id="office-detail-title">{roleNames[selectedId]} 직원 상세</h3><p>{selected ? `${selected.nameKo} · ${locationNames[selected.location]} · ${selected.activityKo}` : '확인된 직원 상태가 아직 없습니다.'}</p>{selected && selected.activeAssignments > 1 && <small>관련 실행 {selected.activeAssignments}개 · 현재 업무 우선 표시</small>}</div>
      <div className="office-detail-body"><dl className="office-facts">
        <div><dt>직원 상태</dt><dd>{selected ? stateNames[selected.state] : '확인 필요'}</dd></div>
        <div><dt>업무 상태</dt><dd>{selected?.taskStatus ? taskNames[selected.taskStatus] ?? selected.taskStatus : '배정된 업무 없음'}</dd></div>
        <div><dt>실행 상태</dt><dd>{selected?.runStatus ? runNames[selected.runStatus] : '실행 없음'}</dd></div>
        <div><dt>현재 단계</dt><dd>{selected?.stage ? stageNames[selected.stage] : '—'}</dd></div>
      </dl>
      {selected?.taskId && <div className="office-current-task"><div><small>현재 표시 중인 업무</small><strong>{selected.taskTitle}</strong></div><button type="button" className="button secondary" onClick={() => onOpenTask(selected.taskId as string)}>업무 상세 열기 <span aria-hidden="true">↗</span></button></div>}
      {selected?.blockedReason && <p className="office-blocked">중단 사유: <code>{selected.blockedReason}</code></p>}
      {selected?.runId && <div className="office-evidence"><p>실행 ID <code>{selected.runId}</code> · 버전 {selected.version}</p><p>검증 SHA <code>{selected.evidenceSha ?? '아직 검증 근거 없음'}</code></p>{selected.usage && <p>완료된 응답 토큰 · 입력 {selected.usage.inputTokens.toLocaleString('ko-KR')} · 출력 {selected.usage.outputTokens.toLocaleString('ko-KR')}</p>}</div>}
      </div>
    </section>
    <p className="office-footnote">직원 이동은 현재 상태를 보여줍니다. 결과 수락은 업무 상세에서 확인해 주세요.</p>
  </section>;
}
