'use client';

import { useState } from 'react';
import { api, errorMessage, formatTime, type Session } from './api';
import type { MergeRequest, SlackCommandReceipt } from './collaboration-model';

const statusNames: Record<string, string> = { REQUESTED: '승인 요청', APPROVED: 'Owner 승인됨', QUEUED: '실행 대기', RUNNING: '실행 중', SUCCEEDED: 'merge 확인됨', FAILED: '실행 실패', UNKNOWN: '결과 불명', REVOKED: '철회됨', EXPIRED: '승인 만료', STALE: '범위 변경' };
const blockerNames: Record<string, string> = { RESULT_ACCEPTANCE_REQUIRED: '로컬 결과 수락이 필요합니다.', DRAFT_PULL_REQUEST: 'Draft PR을 검토 가능한 상태로 전환한 뒤 새 승인 범위를 요청하세요.', PULL_REQUEST_NOT_MERGEABLE: '원격 PR이 merge 가능한 상태가 아닙니다.', CURRENT_HEAD_CI_REQUIRED: '현재 head의 필수 CI 통과가 필요합니다.' };
type Perform = (path: string, value: unknown) => Promise<boolean>;
export function MergeApproval({ request, projectId, session, busy, perform }: { request: MergeRequest; projectId: string; session: Session; busy: boolean; perform: Perform }) {
  const [checked, setChecked] = useState(false), [ready, setReady] = useState(false), [checking, setChecking] = useState(false), [message, setMessage] = useState('');
  const scope = request.scope, expired = Date.parse(request.expiresAt) <= Date.now();
  const actionable = ['REQUESTED', 'APPROVED'].includes(request.status) && !expired && !!scope.remote;
  const path = `/projects/${encodeURIComponent(projectId)}/integrations/merges/${request.id}`;
  const payload = { expectedVersion: request.version, scopeHash: request.scopeHash };
  async function validate() {
    setChecking(true); setReady(false); setChecked(false); setMessage('');
    try {
      const result = await api<{ ready: boolean; blockers: string[] }>(`${path}/validate`, { method: 'POST', body: JSON.stringify(payload) }, session.csrfToken);
      setReady(result.ready); setMessage(result.ready ? '원격 범위와 권한을 확인했습니다. 아직 merge하지 않았습니다.' : result.blockers.map(code => blockerNames[code] ?? code).join(' '));
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setChecking(false); }
  }
  return <li className="merge-approval" data-merge-request={request.id} aria-label={`PR ${scope.pullNumber} merge 승인`}>
    <div className="collaboration-section-heading"><h5>PR #{scope.pullNumber} · {scope.mergeMethod}</h5><span className="status-badge">{expired && ['REQUESTED','APPROVED'].includes(request.status) ? '승인 만료' : statusNames[request.status] ?? request.status}</span></div>
    <p><strong>{scope.branch}</strong> → <strong>{scope.base}</strong></p>
    <dl className="merge-scope"><dt>원격 head SHA</dt><dd><code>{scope.headSha}</code></dd><dt>대상 base SHA</dt><dd><code>{scope.baseSha ?? '재검증 필요'}</code></dd><dt>검증 후보 SHA</dt><dd><code>{scope.candidateSha}</code></dd><dt>검증 범위</dt><dd>설치 {scope.installationId} · 저장소 {scope.repositoryId} · 실행 v{scope.runVersion} · 정책 {scope.policyVersion}</dd><dt>필수 CI</dt><dd>{scope.requiredChecks.join(', ')} · {scope.remote?.ci.status ?? '재검증 필요'}</dd><dt>유효 기한</dt><dd>{formatTime(request.expiresAt)} KST</dd></dl>
    <details><summary>승인 범위 해시와 보호 정책</summary><p className="operation-reference">scope <code>{request.scopeHash}</code></p><p className="operation-reference">보호 정책 <code>{scope.remote?.protectionHash ?? '이전 형식 · 새 승인 요청 필요'}</code></p><p>브랜치 보호 {scope.remote ? scope.remote.protected ? '적용됨' : '미적용' : '확인 필요'} · {scope.remote?.draft ? 'Draft PR' : '일반 PR'} · {scope.remote?.mergeableState ?? '확인 필요'}</p></details>
    {!scope.remote && <p className="collaboration-note">이전 형식의 승인 요청입니다. 최신 원격 범위로 merge 요청을 새로 작성해 주세요.</p>}
    {actionable && <><p className="collaboration-note">결과 수락과 별개인 원격 변경입니다. 승인 후에도 실행 버튼을 따로 눌러야 합니다. SHA·CI·정책·권한이 바뀌면 차단됩니다.</p>
      <button type="button" className="button" onClick={() => void validate()} disabled={checking || busy}>{checking ? '원격 확인 중…' : 'merge 범위 재검증'}</button>
      <label className="collaboration-check"><input type="checkbox" checked={checked} disabled={!ready || checking || busy} onChange={event => setChecked(event.target.checked)} /><span>{request.status === 'APPROVED' ? '표시한 범위로 실제 merge 실행을 요청합니다.' : '표시한 저장소·PR·head/base SHA·방법·CI 범위를 승인합니다.'}</span></label>
      <button type="button" className="button primary" disabled={!ready || !checked || busy || checking} onClick={() => void perform(`${path}/${request.status === 'APPROVED' ? 'execute' : 'approve'}`, payload)}>{request.status === 'APPROVED' ? '승인 범위로 실제 merge 실행' : '이 범위의 merge 승인'}</button>
    </>}
    {['REQUESTED','APPROVED','QUEUED'].includes(request.status) && <button type="button" className="text-button" disabled={busy || checking} onClick={() => void perform(`${path}/revoke`, payload)}>merge 요청 철회</button>}
    {message && <p role="status" className="collaboration-note">{message}</p>}
    {request.errorCode && <p className="operation-reference">확인 코드 <code>{request.errorCode}</code></p>}
    {request.status === 'UNKNOWN' && <><p className="integration-unknown">원격 merge 여부가 불명확합니다. 자동으로 재실행하지 않습니다. GitHub 실제 결과를 확인해 주세요.</p><button type="button" className="text-button" disabled={busy} onClick={() => void perform(`${path}/reconcile`, payload)}>원격 merge 결과 다시 확인</button></>}
    {request.status === 'SUCCEEDED' && <p>GitHub 응답과 PR 재조회로 merge를 확인했습니다. 업무 수락 상태는 별도로 유지합니다.</p>}
  </li>;
}
export function SlackCommandHistory({ commands }: { commands: SlackCommandReceipt[] }) {
  return <section aria-label="Slack 명령 처리 기록"><h4>Slack 명령 처리</h4><p className="collaboration-note">지정 채널의 매핑된 Owner만 /ai-pixel 도움말·상태·업무 명령을 사용할 수 있습니다. 업무는 할 일로 등록되며 자동 실행·승인을 시작하지 않습니다.</p>
    {commands.length === 0 ? <p className="muted small">접수한 명령이 없습니다.</p> : <ol className="integration-operations">{commands.map(command => <li key={command.id}>
      <strong>{command.status === 'PROCESSED' ? '명령 처리 완료' : command.status === 'FAILED' ? '명령 처리 실패' : '명령 접수·처리 중'}</strong>
      <p className="merge-command-result">{command.result?.text ?? '처리 결과 대기 중'}</p><p className="muted small">채널 알림: {command.replyStatus === 'SENT' ? '전송 확인' : command.replyStatus === 'UNKNOWN' ? '전송 결과 불명 · 자동 재전송 없음' : command.replyStatus === 'FAILED' ? '전송 실패' : '전송 대기'} · {formatTime(command.createdAt)} KST</p>
      {command.errorCode && <p className="operation-reference">확인 코드 <code>{command.errorCode}</code></p>}
    </li>)}</ol>}
  </section>;
}
